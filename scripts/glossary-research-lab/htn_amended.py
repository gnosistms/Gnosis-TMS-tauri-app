"""Execute a rubric-blind final check or independent frequency measurement."""
import argparse,os,subprocess,hashlib
from htn_runner import HERE,RUN
from efficient_design import read,write
p=argparse.ArgumentParser();p.add_argument('phase',choices=['blind-check','frequency']);p.add_argument('--indices',default='1,2,3,4,5,6,7');p.add_argument('--workers',type=int,default=2);a=p.parse_args()
base=(HERE/'lab.mjs').read_text();base=base[:base.index("\ntry{\n if(command==='prepare')")]
dispatch=(HERE/'htn_dispatch.mjs').read_text();dispatch=dispatch[:dispatch.rindex('\ntry{\n const auth=')]
for name,h in read(RUN/'freeze.json')['inputs'].items():assert hashlib.sha256((RUN/name).read_bytes()).hexdigest()==h
code={n:hashlib.sha256((HERE/n).read_bytes()).hexdigest() for n in ['htn_core.mjs','htn_dispatch.mjs','htn_amended_dispatch.mjs','htn_amended.py','lab.mjs','protocol.mjs']}
signature=hashlib.sha256(str(sorted(code.items())).encode()).hexdigest()
for n in code:
 dest=RUN/'code'/signature/n;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes((HERE/n).read_bytes())
write(RUN/'code'/signature/'manifest.json',code)
m=HERE/f'.htn-amended-{os.getpid()}.mjs';m.write_text(base+'\n'+dispatch+'\n'+(HERE/'htn_amended_dispatch.mjs').read_text())
try:
 subprocess.check_call(['node','--check',str(m)])
 subprocess.check_call(['node',str(m),a.phase,'--run',str(RUN),'--method','htn-v7','--indices',a.indices,'--workers',str(a.workers)])
finally:m.unlink(missing_ok=True)
