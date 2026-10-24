"""External harness: supply raw application data; export frozen results to evaluator.

This process is never imported by the HTN runtime. Roles/criteria remain in the
external benchmark directory. The runtime sees source texts and occurrences only.
"""
import argparse,json,re,hashlib,subprocess
from pathlib import Path
from efficient_design import Corpus,read,write
HERE=Path(__file__).resolve().parent
OLD=HERE/'runs/2026-10-14-htn'
RUN=HERE/'runs/2026-10-14-htn-blind'
def compact(p):
 r=p.get('representative',{})
 return {'itemId':p.get('itemId',p.get('item_id')),'text':p['text'],'occurrences':p.get('occurrences',[]),'reference':{'title':r.get('title'),'chapter':r.get('chapter_title'),'paragraph':r.get('n'),'url':r.get('reader_url'),'docId':r.get('doc_id')},'contextBefore':p.get('context_before',[]),'contextAfter':p.get('context_after',[])}
def prepare(indices):
 c=Corpus(RUN)
 try:
  for i in indices:
   d=RUN/'terms'/f'{i:02}';old=read(OLD/'terms'/f'{i:02}'/'input.json');source=read(d/'source.json')
   write(d/'application.json',{'passages':[{k:p[k] for k in ['itemId','text','occurrences','contextBefore','contextAfter','reference']} for p in old['test']]})
   if (d/'frequency-input.json').exists():continue
   glossary=read(d/source['languages'][0]/'unsorted-glossary.json')
   if not glossary:continue
   forms=glossary['terms'][0]['sourceTerms']
   draw=c.get('/api/sample',{'forms':','.join(forms),'n':96,'seed':f'fully-blind-frequency:261014:{i}','kind':'samael','context':1})
   rows=[compact(p) for p in draw.get('items',[])]
   norm=lambda s:re.sub(r'\W+','',s.casefold())
   ids={str(p['itemId']) for p in old['test']};texts={norm(p['text']) for p in old['test']}
   kept=[p for p in rows if str(p['itemId']) not in ids and norm(p['text']) not in texts][:48]
   overlap=not kept
   if overlap:kept=rows
   write(d/'frequency-input.json',{'term':source['term'],'forms':forms,'sample':kept,'populationMeta':draw.get('meta',{}),'sampling':'First 48 of a seeded uniform 96-paragraph draw, excluding acceptance ids and normalized texts. Sparse overlap is explicit.','sparseOverlap':overlap,'countMeaning':'Preferred candidate usage per matched occurrence in this sample; not exhaustive corpus frequency or correctness.'})
   print(json.dumps({'index':i,'sample':len(kept),'occurrences':sum(len(p['occurrences']) for p in kept),'sparseOverlap':overlap}),flush=True)
 finally:c.close()
 files=[*RUN.glob('terms/*/application.json'),*RUN.glob('terms/*/frequency-input.json')]
 write(RUN/'application-freeze.json',{str(p.relative_to(RUN)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files})
def export(indices):
 for i in indices:
  d=RUN/'terms'/f'{i:02}';source=read(d/'source.json')
  assert read(d/'final-frozen.json'),'Final HTN results not frozen'
  for lang in source['languages']:
   dest=OLD/'terms'/f'{i:02}'/'htn-blind-v1'/lang
   for name,value in [('saved-glossary.json',read(d/lang/'saved-glossary.json')),('frequency.json',read(d/lang/'frequency.json')),('htn.json',read(d/f'final-translation-{lang}.json'))]:write(dest/name,value)
  write(d/'external-export.json',{'method':'htn-blind-v1','destination':str(OLD),'criterionAccess':'Evaluator only, after final freeze; no feedback into HTN'})
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('phase',choices=['prepare','export','evaluate']);p.add_argument('--indices',default='1,2,3,4,5,6,7');a=p.parse_args();indices=[int(x) for x in a.indices.split(',')]
 if a.phase=='prepare':prepare(indices)
 else:
  export(indices)
  if a.phase=='evaluate':subprocess.check_call(['python3',str(HERE/'htn_runner.py'),'evaluate','--indices',a.indices,'--workers','2','--method','htn-blind-v1','--source-context','neighbors','--consumer-rules','consumer-rules-frequency.json','--role','all','--arms','htn'])
