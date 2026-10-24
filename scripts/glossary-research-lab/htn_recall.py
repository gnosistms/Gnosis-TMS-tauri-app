"""Record acquisition correction before proposals/evaluation. Retain failed initial attempt."""
import json,hashlib,re,sqlite3,shutil,time
from pathlib import Path
from difflib import SequenceMatcher
from htn_prepare import RUN,TERMS,DIAGNOSTICS,compact
from efficient_design import Corpus,read,write
c=Corpus(RUN)
try:
 shutil.copyfile(RUN/'freeze.json',RUN/'freeze-initial-acquisition.json')
 books=c.get('/api/sample/source-books',{})['books']
 for index,(term,languages) in enumerate(TERMS,1):
  d=RUN/'terms'/f'{index:02}';old=read(d/'input.json');write(d/'input-initial.json',old)
  # Exact lemma forms determine samples; near candidates are independently examined in inventory.
  forms=list(dict.fromkeys([term]+[x['form'] for x in old['formsHint'].get('forms',[])]))
  if term=='Hooltanpanas':forms+=['Hooltampanas']
  if term=='hasnamuss':
   db=sqlite3.connect('file:/Users/hans/Desktop/AI-Projects/GlossaryGen/tmp/release_20261011/out/search.db?mode=ro',uri=True)
   db.execute("CREATE VIRTUAL TABLE temp.htn_forms USING fts5vocab(main,'lines_fts_exact','row')")
   possible=[w for w,n in db.execute("SELECT term,doc FROM htn_forms WHERE term LIKE 'ha%' OR term LIKE 'ja%'") if 7<=len(w)<=15 and max(SequenceMatcher(None,w,target).ratio() for target in [term,'hasnamussen'])>=0.65]
   db.close();forms=list(dict.fromkeys(forms+possible));old['candidateForms']=list(dict.fromkeys(old['candidateForms']+possible))
   old['recall']={'trigger':'zero author hits','method':'bounded lexical similarity to source headword and original plural; candidates require contextual identity','candidates':possible,'source':'corpus token vocabulary; not previous glossary answers'}
  a=c.get('/api/sample',{'forms':','.join(forms),'n':192,'seed':f'htn:{index}:pool-v2','kind':'samael','context':1})
  pool={p['item_id']:compact(p) for p in a.get('items',[])}
  groups=[]
  for q in DIAGNOSTICS[term]+(['hanasmussen','janasmussen','hanasmussiano'] if term=='hasnamuss' else []):
   b=c.get('/api/sample',{'forms':','.join(forms),'require':q,'n':3,'seed':f'htn:{index}:v2:{q}','kind':'samael','context':1})
   ids=[]
   for p in b.get('items',[]):pool[p['item_id']]=compact(p);ids.append(p['item_id'])
   groups.append({'query':q,'ids':ids,'hits':b.get('population_distinct')})
  if term in ['hasnamuss','Hooltanpanas']:
   originalForms=['Hasnamuss','Hasnamussen'] if term=='hasnamuss' else ['Hooltanpanas']
   b=c.get('/api/original/sample',{'book_id':'gurdjieff_relatos_belcebu','forms':','.join(originalForms),'n':12 if term=='hasnamuss' else 3,'seed':f'htn:{index}:verify'})
   source=c.get('/api/sample',{'forms':','.join(originalForms+(['hasnamusses'] if term=='hasnamuss' else [])),'n':3,'kind':'source','seed':f'htn:{index}:source'})
   pair={'title':'Relatos de Belcebú a su nieto — G. I. Gurdjieff','original_title':"Beelzebub's Tales to His Grandson",'original_author':'G. I. Gurdjieff','book_id':'gurdjieff_relatos_belcebu','original_term':originalForms[0],'original_forms':originalForms,'basis':'direct name search of original and Spanish edition; same conceptual identity must be verified'}
   old['originals']=[{'pair':pair,'passages':[{k:p.get(k) for k in ['text','clipped','paragraph_id','reader_url']} for p in b.get('items',[])],'spanishEdition':source.get('items',[]),'error':b.get('error')}]
  selected=[]
  for g in groups:
   for pid in g['ids'][:2]:
    if pid not in selected:selected.append(pid)
  for pid in sorted(pool,key=lambda x:hashlib.sha256(f'htn:{index}:{x}'.encode()).hexdigest()):
   if pid not in selected:selected.append(pid)
   if len(selected)>=24:break
  selected=selected[:24];test=[pool[x] for x in selected]
  loc=lambda p:(p['reference']['docId'],p['reference']['chapter'],p['reference']['paragraph'])
  locations={loc(p) for p in test};texts=[p['text'].strip().lower() for p in test]
  research=[p for p in pool.values() if loc(p) not in locations and not any(p['text'].strip().lower() in t or t in p['text'].strip().lower() for t in texts)]
  sparse=not research
  if sparse:research=test
  reserved={loc(p) for p in sorted(test,key=lambda p:hashlib.sha256(f'reserve:{p["itemId"]}'.encode()).hexdigest())[::2]}
  for p in test:p['role']='confirmation' if loc(p) in reserved else 'development'
  old.update(research=research,test=test,sparseOverlap=sparse,diagnosticGroups=groups,population={k:a.get(k) for k in ['population_distinct','population_rows','corpus_version','population_fingerprint']},samplingForms=forms)
  # Previously generated inventory cannot be reused after its evidence packet changes.
  for n in ['inventory','plan','failure-source-htn-v1']:
   p=d/(n+'.json')
   if p.exists():p.rename(d/(n+'-initial.json'))
  write(d/'input.json',old)
  print(json.dumps({'term':term,'samplingForms':forms,'population':a.get('population_distinct'),'test':len(test),'research':len(research)}),flush=True)
 files=[RUN/'manifest.json',RUN/'requirements.json',RUN/'human-criteria.txt',*RUN.glob('terms/*/input.json')]
 write(RUN/'freeze.json',{'at':time.time(),'revision':'acquisition-v2 before any proposal or trial translation','changes':'Exact-lemma sample boundaries; bounded zero-hit spelling recovery; direct original-edition verification fallback. Initial inference and acquisition retained as cost.','inputs':{str(p.relative_to(RUN)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}})
finally:c.close()
