"""Acquire and freeze the human seven-term HTN experiment, without target glossary access."""
import json,hashlib,re,sys,time,shutil
from pathlib import Path
from urllib.parse import urlencode
from efficient_design import Corpus,read,write
HERE=Path(__file__).resolve().parent
RUN=HERE/'runs/2026-10-14-htn'
TERMS=[('mundo',['en','vi']),('sensible',['en','vi']),('vanidad',['vi']),('Hooltanpanas',['en']),('hasnamuss',['en']),('fatal',['en','vi']),('Íntimo',['en','vi'])]
RULES={
'mundo':'Prefer planet / hành tinh whenever that interpretation is plausible. Make that the default while preserving world/realm/society/idioms and categories containing the Sun/stars where planet does not fit. Test both under-selection and over-application.',
'sensible':'Perceptible, accessible to the senses must not become English sensible (reasonable). Distinguish emotional/sensitive and borrowed feeling-center uses where evidenced. Identify genuine related derivatives such as suprasensible and propose related research, not merged hits or automatic recursive studies.',
'vanidad':'Vietnamese must express concern about physical appearance, public image or how others judge us in applicable contexts; bare phù phiếm usually fails this criterion. Do not reduce every use to physical beauty if source scope is broader. Identify related vanidoso/vanidosos. Genuine futility/transience contexts may differ.',
'Hooltanpanas':'Canonical untranslated target Hooltanpanas. Retain Hooltampanas and Hooltanpanas as searchable source forms. General notes identify Gurdjieff as source. Verify canonical designation in the source work; definition must not replace the name.',
'hasnamuss':'Canonical untranslated name Hasnamuss, plural Hasnamussen. Identify Gurdjieff in general notes. Verify original spelling and plural; include all attested correct/incorrect author spellings as source forms. A definition must not replace the designation; do not invent unobserved author variants.',
'fatal':'Distinguish baleful, evil, harmful, inevitable, fated and actual deadly meanings. English fatal/deadly/mortal must not replace mere harm or inevitability. Preserve rare supported branches and natural collocations. Vietnamese preserves the same distinctions.',
'Íntimo':'Specialized noun: Innermost (English), Đấng Nội Tại (Vietnamese), borrowed from The Dayspring of Youth. Verify the link through original/source-book evidence and carry it in general notes. Ordinary adjectives inner/private/internal/intimate and close friendship stay separate. Capitalization alone does not decide grammatical role.'}
# Source-only diagnostic query conditions; deliberately cover mechanisms humans identified.
DIAGNOSTICS={
'mundo':['planeta','Sol','estrellas','mundo interior','mundo de','todo el mundo','mundos superiores','mundos suprasensibles'],
'sensible':['perceptible','sentidos','centro sensible','cerebro sensible','mundo sensible','sensibles','dolor'],
'vanidad':['apariencia','vanidos','vanidades','orgullo','belleza','personalidad','imagen'],
'Hooltanpanas':['Hooltampanas','Hooltanpanas'],
'hasnamuss':['hasnam','hassnam','hasnamussen'],
'fatal':['inevitable','destino','muerte','daño','fatal error','fatal resultado','fatal accidente','triángulo fatal'],
'Íntimo':['amigo íntimo','vida íntima','íntima','el Íntimo','Dios','íntimos']}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def compact(p):
 r=p.get('representative',{})
 return {'itemId':p.get('itemId',p.get('item_id')),'text':p['text'],'occurrences':p.get('occurrences',[]),'reference':{'title':r.get('title'),'chapter':r.get('chapter_title'),'paragraph':r.get('n'),'url':r.get('reader_url'),'docId':r.get('doc_id')},'copies':p.get('copies',[]),'contextBefore':p.get('context_before',[]),'contextAfter':p.get('context_after',[])}
def main():
 RUN.mkdir(parents=True,exist_ok=True)
 if (RUN/'freeze.json').exists():print('Frozen acquisition already complete');return
 desktop=Path('/Users/hans/Desktop/GLOSSARY RESEARCH SPANISH TEST TERMS')
 shutil.copyfile(desktop,RUN/'human-criteria.txt')
 write(RUN/'manifest.json',{'seed':26101417,'source_language':'es','target_language':'multi','terms':[{'source_terms':[t],'languages':ls} for t,ls in TERMS],'criteriaSource':str(desktop),'criteriaSha256':sha(desktop),'design':'htn-v1','modelId':'gpt-6.1-sol'})
 write(RUN/'requirements.json',RULES)
 write(RUN/'execution-authorization.json',{'approved':True,'source':'Hans explicitly authorized subscription tests including source excerpts and criteria, then requested this seven-term HTN system and tests.','subscriptionOnly':True,'at':time.time()})
 c=Corpus(RUN)
 try:
  for index,(term,languages) in enumerate(TERMS,1):
   d=RUN/'terms'/f'{index:02}';d.mkdir(parents=True,exist_ok=True)
   forms=c.get('/api/sample/forms',{'q':term});seed=[term]+[p['form'] for p in forms.get('forms',[])]
   if term=='Hooltanpanas':seed+=['Hooltampanas']
   near=c.get('/api/sample/near-forms',{'forms':','.join(seed),'kind':'samael','n':30})
   if term=='hasnamuss':
    seed+=['hasnamus','hasnamussen','hassnamuss','hassnamussen']
    near=c.get('/api/sample/near-forms',{'forms':','.join(seed),'kind':'samael','n':40})
   candidates=list(dict.fromkeys(seed+[p['form'] for p in near.get('near',[])]))
   sample=c.get('/api/sample',{'forms':','.join(candidates),'n':192,'seed':f'htn:{index}:pool','kind':'samael','context':1})
   pool={p.get('itemId',p.get('item_id')):compact(p) for p in sample.get('items',[])}
   groups=[]
   for q in DIAGNOSTICS[term]:
    a=c.get('/api/sample',{'forms':','.join(candidates),'require':q,'n':3,'seed':f'htn:{index}:{q}','kind':'samael','context':1})
    ids=[]
    for p in a.get('items',[]):pid=p.get('itemId',p.get('item_id'));pool[pid]=compact(p);ids.append(pid)
    groups.append({'query':q,'ids':ids,'hits':a.get('meta',{}).get('distinct')})
   orig=c.get('/api/sample/original-terms',{'forms':','.join(candidates)})
   # source work is acquired even when sparse. Printed and aligned pairs remain fallible.
   provenance=[]
   pairs=sorted(orig.get('pairs',[]),key=lambda p:(p.get('basis')!='printed_glossaries',-(p.get('original_count') or 0)))
   books=set()
   for pair in pairs:
    book=pair.get('book_id')
    if not book or book in books:continue
    books.add(book)
    a=c.get('/api/original/sample',{'book_id':book,'forms':','.join([pair['original_term'],*pair.get('original_forms',[])]),'n':3,'seed':f'htn:{index}:original'})
    provenance.append({'pair':pair,'passages':[{k:p.get(k) for k in ['text','reference','clipped']} for p in a.get('items',[])],'error':a.get('error')})
    if len(books)>=3:break
   # Reuse only dictionary evidence from original full source stage; no target answers.
   dictEvidence=None;dictOrigin=None
   old=HERE/'runs/2026-10-13-full-preservation'
   for lang in ['en','vi']:
    m=read(old/lang/'manifest.json')
    for j,t in enumerate(m['terms'],1):
     if t['source_terms'][0].casefold() in {term.casefold(),'hooltampanas' if term=='Hooltanpanas' else term.casefold()}:
      f=old/lang/'terms'/f'{j:02}'/'baseline/stages/dictionary.json'
      if f.exists():dictEvidence=read(f);dictOrigin={'path':str(f),'sha256':sha(f)};break
    if dictEvidence is not None:break
   # Diagnostics + random sample, frozen before source labels/proposals. Reserved split by source locations.
   selected=[]
   for g in groups:
    for pid in g['ids'][:2]:
     if pid not in selected:selected.append(pid)
   for pid in sorted(pool,key=lambda x:hashlib.sha256(f'htn:{index}:{x}'.encode()).hexdigest()):
    if pid not in selected:selected.append(pid)
    if len(selected)>=24:break
   selected=selected[:24]
   fromLocation=lambda p:(p.get('reference',{}).get('url','').split('?')[0],p.get('reference',{}).get('chapter',''),p.get('reference',{}).get('paragraph'))
   test=[pool[x] for x in selected]
   locations={fromLocation(p) for p in test}
   testTexts=[p['text'].strip().lower() for p in test]
   research=[p for p in pool.values() if fromLocation(p) not in locations and not any(p['text'].strip().lower() in t or t in p['text'].strip().lower() for t in testTexts)]
   sparse=not research
   if sparse:research=test
   # Confirmation status assigned to disjoint source-location groups.
   sortedTest=sorted(test,key=lambda p:hashlib.sha256(f'reserve:{p["itemId"]}'.encode()).hexdigest())
   confirmLoc={fromLocation(p) for p in sortedTest[::2]}
   for p in test:p['role']='confirmation' if fromLocation(p) in confirmLoc else 'development'
   value={'index':index,'term':term,'languages':languages,'formsHint':forms,'nearForms':near,'candidateForms':candidates,'population':{k:sample.get(k) for k in ['population_distinct','population_rows','corpus_version','population_fingerprint']},'research':research,'test':test,'diagnosticGroups':groups,'sparseOverlap':sparse,'dictionary':dictEvidence or {'status':'unknown','text':'','notes':['No reusable lexical article; retrieval not attempted in acquisition.']},'dictionaryImported':dictOrigin,'originals':provenance,'originalPairs':orig,'limitations':['Pool of at most 192 uniform plus diagnostic results does not establish exhaustive sense coverage.','Human-requested correct spellings are search candidates until independently verified.']}
   write(d/'input.json',value)
   print(json.dumps({'index':index,'term':term,'forms':candidates,'research':len(research),'test':len(test),'originalBooks':len(provenance),'overlap':sparse}),flush=True)
 finally:c.close()
 files=[RUN/'manifest.json',RUN/'requirements.json',RUN/'human-criteria.txt',*RUN.glob('terms/*/input.json')]
 write(RUN/'freeze.json',{'at':time.time(),'inputs':{str(p.relative_to(RUN)):sha(p) for p in files}})
if __name__=='__main__':main()
