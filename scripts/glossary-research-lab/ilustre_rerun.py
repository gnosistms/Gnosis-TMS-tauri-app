"""Fresh research through the updated production Studio, subscription-only."""
import argparse,hashlib,json,os,pathlib,subprocess
HERE=pathlib.Path(__file__).resolve().parent;ROOT=HERE.parents[1];RUN=HERE/'runs/2026-10-19-ilustre-rerun';PREVIOUS=HERE/'runs/2026-10-19-ilustre-notes'
def read(p):return json.loads(pathlib.Path(p).read_text())
def write(p,v):
 p=pathlib.Path(p);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def digest(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def prepare():
 if (RUN/'input.json').exists():return
 prior=read(PREVIOUS/'input.json');manifest=pathlib.Path('/tmp/gnosis-ilustre-study-path.txt').read_text().strip();m=pathlib.Path(manifest);s=read(m);pieces=m.with_suffix('')/'evidence'
 def resolve(x):
  if isinstance(x,dict):
   if '_studioArtifact'in x:return resolve(read(pieces/(x['_studioArtifact']+'.json')))
   return {k:resolve(v)for k,v in x.items()}
  if isinstance(x,list):return[resolve(v)for v in x]
  return x
 sources=[]
 for c in s['cache'].values():
  q=resolve(c['request'])
  if q.get('kind')in['corpus','dle','dictionary']:sources.append({'request':q,'value':resolve(c['value'])})
 source_data={'scope':{**s['scope'],'glossaryId':'isolated-ilustre-rerun','repoName':'isolated-comparison'},'model':s['model'],
 'referencePassages':[p for b in prior['batches']for p in b],'instructions':prior['instructions'],'sources':sources,
 'liveFiles':{str(m):digest(m),**{p:h for p,h in prior['liveFiles'].items() if '/terms/'in p}},
 'transport':'Codex subscription. Production Studio stages and tool builder. No existing AI findings or glossary entry provided.'}
 write(RUN/'input.json',source_data);write(RUN/'manifest.json',{'terms':[{'source_terms':['ilustre']}],'seed':1})
 files=[*list((ROOT/'src-ui/app').glob('glossary-research-studio*.js')),HERE/'lab.mjs',HERE/'ilustre_rerun_dispatch.mjs',pathlib.Path(__file__)]
 write(RUN/'freeze.json',{'code':{str(p.relative_to(ROOT)):digest(p)for p in files if not p.name.endswith('.test.js')},'inputHash':digest(RUN/'input.json')})
def main():
 p=argparse.ArgumentParser();p.add_argument('phase',choices=['prepare','stage','decision','inspect','final-translations']);p.add_argument('--step',default='');p.add_argument('--action',default='');p.add_argument('--definition',default='');p.add_argument('--meaning',default='');a=p.parse_args();prepare();freeze=read(RUN/'freeze.json')
 assert digest(RUN/'input.json')==freeze['inputHash']
 for n,h in freeze['code'].items():assert digest(ROOT/n)==h,'Frozen code changed: '+n
 if a.phase=='prepare':print(json.dumps({'run':str(RUN),'sources':len(read(RUN/'input.json')['sources']),'referenceParagraphs':57}));return
 base=(HERE/'lab.mjs').read_text();base=base[:base.index("\ntry{\n if(command==='prepare')")]
 # Research uses unstructured JSON text in the app too. Keep strict schemas for translations.
 base=base.replace("'--output-schema',schemaFile,'--json'","...(request.rawJson?[]:['--output-schema',schemaFile]),'--json'")
 module=HERE/f'.ilustre-rerun-{os.getpid()}.mjs';module.write_text(base+'\n'+(HERE/'ilustre_rerun_dispatch.mjs').read_text())
 try:
  subprocess.check_call(['node','--check',str(module)])
  subprocess.check_call(['node','--import',str(ROOT/'src-ui/test/register-raw-loader.mjs'),str(module),a.phase,'--run',str(RUN),'--workers','1','--step',a.step,'--action',a.action,'--definition',a.definition,'--meaning',a.meaning])
 finally:module.unlink(missing_ok=True)
if __name__=='__main__':main()
