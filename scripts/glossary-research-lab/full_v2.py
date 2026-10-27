"""Second preservation candidate; same original full research and neutral controls."""
import argparse,hashlib,os,subprocess
from full_research import HERE,ROOT,read,write

def main():
    p=argparse.ArgumentParser();p.add_argument('phase',choices=['compile','translate','evaluate','confirm']);p.add_argument('--language',choices=['vi','en'],default='vi');p.add_argument('--indices',default='');p.add_argument('--workers',type=int,default=2);p.add_argument('--method',default='full-preserved-v2');a=p.parse_args()
    assert a.method=='full-preserved-v2'
    run=ROOT/a.language;parent=read(run/'freeze.json')
    for name,h in parent['inputs'].items():assert hashlib.sha256((run/name).read_bytes()).hexdigest()==h,'Original frozen input changed'
    revision=run/'v2-freeze.json';codeNames=['lab.mjs','full_research_dispatch.mjs','full_v2_dispatch.mjs','full_carrythrough_v2.mjs']
    if not revision.exists():write(revision,{'code':{n:hashlib.sha256((HERE/n).read_bytes()).hexdigest() for n in codeNames},'change':'Verified specialized noun designations cover their checked meaning; do not restore their definitions as new meanings. Carry verified original-term evidence and omit optional unknown fields. No research steps or calls removed.'})
    for name,h in read(revision)['code'].items():assert hashlib.sha256((HERE/name).read_bytes()).hexdigest()==h,'Register another revision for changed code'
    base=(HERE/'lab.mjs').read_text();base=base[:base.index("\ntry{\n if(command==='prepare')")]
    full=(HERE/'full_research_dispatch.mjs').read_text();full=full[:full.index('\ntry{\n if(phase===')]
    module=HERE/f'.full-v2-{os.getpid()}.mjs';module.write_text(base+'\n'+full+'\n'+(HERE/'full_v2_dispatch.mjs').read_text())
    try:
        subprocess.check_call(['node','--check',str(module)])
        subprocess.check_call(['node',str(module),a.phase,'--run',str(run),'--language',a.language,'--indices',a.indices,'--method',a.method,'--workers',str(a.workers),'--jobs',str(a.workers)])
    finally:module.unlink(missing_ok=True)

if __name__=='__main__':main()
