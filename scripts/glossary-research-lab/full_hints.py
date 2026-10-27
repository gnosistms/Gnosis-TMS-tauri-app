"""Human requirements without researched glossary: secondary causal control."""
import argparse,hashlib,os,subprocess
from full_research import HERE,ROOT,read,write

def main():
 p=argparse.ArgumentParser();p.add_argument('phase',choices=['translate','evaluate','confirm']);p.add_argument('--language',choices=['vi','en'],default='vi');p.add_argument('--indices',default='');p.add_argument('--workers',type=int,default=2);a=p.parse_args();run=ROOT/a.language
 for name,h in read(run/'freeze.json')['inputs'].items():assert hashlib.sha256((run/name).read_bytes()).hexdigest()==h
 names=['lab.mjs','full_research_dispatch.mjs','full_hints_dispatch.mjs'];freeze=run/'hints-freeze.json'
 if not freeze.exists():write(freeze,{'code':{n:hashlib.sha256((HERE/n).read_bytes()).hexdigest() for n in names},'purpose':'Distinguish the benefit of supplied human/inferred requirements from additional researched glossary knowledge. Mandatory primary control remains the exact no-glossary draft.'})
 for name,h in read(freeze)['code'].items():assert hashlib.sha256((HERE/name).read_bytes()).hexdigest()==h
 base=(HERE/'lab.mjs').read_text();base=base[:base.index("\ntry{\n if(command==='prepare')")]
 full=(HERE/'full_research_dispatch.mjs').read_text();full=full[:full.index('\ntry{\n if(phase===')]
 module=HERE/f'.full-hints-{os.getpid()}.mjs';module.write_text(base+'\n'+full+'\n'+(HERE/'full_hints_dispatch.mjs').read_text())
 try:
  subprocess.check_call(['node','--check',str(module)])
  subprocess.check_call(['node',str(module),a.phase,'--run',str(run),'--language',a.language,'--indices',a.indices,'--method','human-requirements-only','--workers',str(a.workers),'--jobs',str(a.workers)])
 finally:module.unlink(missing_ok=True)

if __name__=='__main__':main()
