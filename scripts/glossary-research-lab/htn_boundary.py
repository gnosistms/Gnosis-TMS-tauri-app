import argparse,os,subprocess
from htn_runner import HERE,RUN
p=argparse.ArgumentParser();p.add_argument('--method',default='htn-v3');a=p.parse_args()
base=(HERE/'lab.mjs').read_text();base=base[:base.index("\ntry{\n if(command==='prepare')")]
dispatch=(HERE/'htn_dispatch.mjs').read_text();dispatch=dispatch[:dispatch.rindex('\ntry{\n const auth=')]
m=HERE/f'.htn-boundary-{os.getpid()}.mjs';m.write_text(base+'\n'+dispatch+'\n'+(HERE/'htn_boundary_dispatch.mjs').read_text())
try:
 subprocess.check_call(['node','--check',str(m)])
 subprocess.check_call(['node',str(m),'boundary','--run',str(RUN),'--method',a.method,'--workers','1'])
finally:m.unlink(missing_ok=True)
