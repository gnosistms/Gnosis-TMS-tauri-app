"""Approved subscription execution for the bounded HTN prototype."""
import argparse,hashlib,os,subprocess,time,json
from pathlib import Path
from efficient_design import read,write
HERE=Path(__file__).resolve().parent;RUN=HERE/'runs/2026-10-14-htn'
def main():
 p=argparse.ArgumentParser();p.add_argument('phase',choices=['source','labels','research','translate','calibrate','evaluate','repair','compile','report']);p.add_argument('--indices',default='1,2,3,4,5,6,7');p.add_argument('--workers',type=int,default=3);p.add_argument('--method',default='htn-v1');p.add_argument('--source-context',choices=['none','neighbors'],default='none');p.add_argument('--consumer-rules',default='consumer-rules.json');p.add_argument('--role',default='development',choices=['development','confirmation','all']);p.add_argument('--arms',default='human-hints-only,htn');a=p.parse_args()
 freeze=read(RUN/'freeze.json')
 for name,h in freeze['inputs'].items():assert hashlib.sha256((RUN/name).read_bytes()).hexdigest()==h,'Frozen source/criteria changed'
 base=(HERE/'lab.mjs').read_text();base=base[:base.index("\ntry{\n if(command==='prepare')")]
 names=['htn_core.mjs','htn_dispatch.mjs','htn_runner.py','lab.mjs','protocol.mjs']
 code={n:hashlib.sha256((HERE/n).read_bytes()).hexdigest() for n in names}
 signature=hashlib.sha256(json.dumps(code,sort_keys=True).encode()).hexdigest()
 snapshot=RUN/'code'/signature
 for n in names:
  dest=snapshot/n;dest.parent.mkdir(parents=True,exist_ok=True)
  if not dest.exists():dest.write_bytes((HERE/n).read_bytes())
 write(snapshot/'manifest.json',{'files':code,'phase':a.phase,'at':time.time(),'inputsSignature':hashlib.sha256((RUN/'freeze.json').read_bytes()).hexdigest()})
 dispatch=(HERE/'htn_dispatch.mjs').read_text();m=HERE/f'.htn-{os.getpid()}.mjs';m.write_text(base+'\n'+dispatch)
 try:
  subprocess.check_call(['node','--check',str(m)])
  code=subprocess.call(['node',str(m),a.phase,'--run',str(RUN),'--indices',a.indices,'--workers',str(a.workers),'--method',a.method,'--role',a.role,'--source-context',a.source_context,'--consumer-rules',a.consumer_rules,'--arms',a.arms])
 finally:m.unlink(missing_ok=True)
 write(RUN/f'phase-{a.phase}-{a.method}-{a.indices.replace(",","-")}-{os.getpid()}.json',{'started':time.time(),'exitCode':code})
 raise SystemExit(code)
if __name__=='__main__':main()
