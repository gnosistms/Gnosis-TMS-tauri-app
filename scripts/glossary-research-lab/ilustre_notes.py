"""Frozen, subscription-only ilustre usage-note comparison; preserves live data."""
import argparse, hashlib, json, os, pathlib, re, subprocess
HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parents[1]
RUN=HERE/'runs/2026-10-19-ilustre-notes'
def read(p): return json.loads(pathlib.Path(p).read_text())
def write(p,v):
 p=pathlib.Path(p);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def digest(p): return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def prepare():
 if (RUN/'input.json').exists(): return
 manifest=pathlib.Path('/tmp/gnosis-ilustre-study-path.txt').read_text().strip()
 live=pathlib.Path(manifest); artifacts=live.with_suffix('')/'evidence'
 def resolve(v):
  if isinstance(v,dict):
   if '_studioArtifact' in v: return resolve(read(artifacts/(v['_studioArtifact']+'.json')))
   return {k:resolve(x) for k,x in v.items()}
  if isinstance(v,list): return [resolve(x) for x in v]
  return v
 s=read(live)
 term_path=pathlib.Path('/Users/hans/Library/Application Support/com.gnosis.tms/installations/installation-122906650/glossaries/gnosis-es-en-research/terms/01a1487b-2e12-77c3-9c37-dfb70a20bfbb.json')
 term=read(term_path);passages=resolve(s['passages']);tests=resolve(s['tests'])
 assert len(passages)==57 and term['target_terms']==['distinguished','enlighten']
 batches=[];by={p['id']:p for p in passages}
 for start in [0,15,30,45]:
  test=tests[f'9:{start}'];ids=[t['paragraphId'] for t in test['translations']]
  assert len(ids)==len(set(ids))
  batches.append([by[i] for i in ids])
 assert len({p['id'] for b in batches for p in b})==57
 rust=(ROOT/'src-tauri/src/ai/mod.rs').read_text()
 instructions={}
 for name in ['translation_register_rule','translation_glossary_rules','translation_batch_response_contract']:
  match=re.search(r'fn '+name+r'\(\) -> &\x27static str \{\s*("(?:[^"\\]|\\.)*")\s*\}',rust)
  assert match,name
  instructions[name]=json.loads(match[1])
 inputs={'createdBy':'ilustre_notes.py','studyId':s['id'],'revision':s['revision'],'model':s['model'],
  'term':term,'batches':batches,'instructions':instructions,'repetitions':2,
  'compactNotes':['For distinction, family standing, or respectful address. Does not itself imply moral goodness or noble birth.',
   'Verb form of ilustrar: giving understanding or illumination, as in «que nos ilustre» → «enlighten us».'],
  'liveFiles':{str(live):digest(live),str(term_path):digest(term_path)},
  'scope':'Only this entry; all saved source context; no correct meaning assignments or old translations supplied to translator.'}
 write(RUN/'input.json',inputs)
 write(RUN/'manifest.json',{'seed':191019,'terms':[{'source_terms':['ilustre']}],'source_language':'es','target_language':'en'})
 write(RUN/'freeze.json',{'code':{str(p.relative_to(ROOT)):digest(p) for p in [HERE/'lab.mjs',HERE/'ilustre_notes_dispatch.mjs',pathlib.Path(__file__),ROOT/'src-tauri/src/ai/mod.rs',ROOT/'src-ui/app/editor-glossary-highlighting.js',ROOT/'src-ui/app/editor-ai-batch-request.js']},'inputHash':digest(RUN/'input.json')})
def main():
 parser=argparse.ArgumentParser();parser.add_argument('phase',choices=['prepare','translate','judge','confirm','report']);a=parser.parse_args()
 prepare();frozen=read(RUN/'freeze.json')
 assert frozen['inputHash']==digest(RUN/'input.json')
 for name,h in frozen['code'].items(): assert digest(ROOT/name)==h, 'Frozen code changed: '+name
 if a.phase=='prepare':
  print(json.dumps({'run':str(RUN),'paragraphs':57,'translationCalls':16,'repetitions':2}));return
 base=(HERE/'lab.mjs').read_text();base=base[:base.index("\ntry{\n if(command==='prepare')")]
 module=HERE/f'.ilustre-notes-{os.getpid()}.mjs';module.write_text(base+'\n'+(HERE/'ilustre_notes_dispatch.mjs').read_text())
 try:
  subprocess.check_call(['node','--check',str(module)])
  subprocess.check_call(['node','--import',str(ROOT/'src-ui/test/register-raw-loader.mjs'),str(module),a.phase,'--run',str(RUN),'--workers','1'])
 finally: module.unlink(missing_ok=True)
if __name__=='__main__':main()
