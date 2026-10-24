"""All original full stages, bounded candidate alternatives, and declared human requirements."""
import argparse,hashlib,os,subprocess
from full_research import HERE,ROOT,read,write

def main():
 p=argparse.ArgumentParser();p.add_argument('phase',choices=['research','compile','translate','evaluate','confirm']);p.add_argument('--language',choices=['vi','en'],default='vi');p.add_argument('--indices',default='');p.add_argument('--workers',type=int,default=3);p.add_argument('--method',default='full-budgeted');a=p.parse_args();assert a.method=='full-budgeted'
 run=ROOT/a.language;parent=read(run/'freeze.json')
 for name,h in parent['inputs'].items():assert hashlib.sha256((run/name).read_bytes()).hexdigest()==h,'Original frozen inputs changed'
 revision=run/'budgeted-freeze.json';names=['lab.mjs','full_research_dispatch.mjs','full_budgeted_dispatch.mjs','full_carrythrough_v2.mjs']
 if not revision.exists():write(revision,{'code':{n:hashlib.sha256((HERE/n).read_bytes()).hexdigest() for n in names},'design':'Every full stage retained. Propose one primary per operational meaning and additional alternatives only for documented contextual necessity. Apply supplied human/inferred requirements after independent source research. Carry requirements, source definitions, provenance and scope to the consumer.','baseline':'Exact same frozen no-glossary drafts','stageRemoval':False,'humanRequirementsAreResearchInputs':True})
 for name,h in read(revision)['code'].items():assert hashlib.sha256((HERE/name).read_bytes()).hexdigest()==h,'Register a revision for changed code'
 base=(HERE/'lab.mjs').read_text();base=base[:base.index("\ntry{\n if(command==='prepare')")]
 full=(HERE/'full_research_dispatch.mjs').read_text();full=full[:full.index('\ntry{\n if(phase===')]
 module=HERE/f'.full-budgeted-{os.getpid()}.mjs';module.write_text(base+'\n'+full+'\n'+(HERE/'full_budgeted_dispatch.mjs').read_text())
 try:
  subprocess.check_call(['node','--check',str(module)])
  subprocess.check_call(['node',str(module),a.phase,'--run',str(run),'--language',a.language,'--indices',a.indices,'--method',a.method,'--workers',str(a.workers),'--jobs',str(a.workers)])
 finally:module.unlink(missing_ok=True)

if __name__=='__main__':main()
