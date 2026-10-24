"""Copy raw evidence only into a criteria-free runtime directory."""
import hashlib,json,re
from pathlib import Path
from htn_prepare import RUN as OLD,TERMS,compact
from efficient_design import Corpus,read,write
RUN=OLD.parent/'2026-10-14-htn-blind'
def main():
 RUN.mkdir(parents=True,exist_ok=True);c=Corpus(RUN)
 try:
  for i,(term,languages) in enumerate(TERMS,1):
   d=RUN/'terms'/f'{i:02}';old=read(OLD/'terms'/f'{i:02}'/'input.json')
   if (d/'source.json').exists():continue
   recall=c.get('/api/search/forms',{'q':term,'kind':'samael','candidate_n':40})
   candidates=list(dict.fromkeys([term,*[p['form'] for p in recall.get('candidates',[])]]))
   witnesses=[]
   for form in candidates:
    if form.casefold()==term.casefold():continue
    sample=c.get('/api/sample',{'forms':form,'kind':'samael','n':1,'seed':f'blind-form:{i}:{form}','context':1})
    witnesses.extend(compact(p) for p in sample.get('items',[]))
   normalize=lambda s:re.sub(r'\W+','',s.casefold())
   confirmationTexts={normalize(p['text']) for p in old['test'] if p['role']=='confirmation'}
   development=[p for p in old['test'] if p['role']=='development']
   research=list({str(p['itemId']):p for p in [*development,*old['research'],*witnesses] if normalize(p['text']) not in confirmationTexts}.values())
   # A raw witness may be relevant even if formerly selected as an acceptance passage.
   # Never import interpretations, candidates, rubric or judgments.
   source={'index':i,'term':term,'languages':languages,'dictionary':old['dictionary'],'research':research,'test':[], 'candidateForms':candidates,'formRetrieval':recall,'originals':old['originals'],'originalPairs':old['originalPairs'],'formsHint':old['formsHint']}
   write(d/'source.json',source)
   dev=[p for p in old['test'] if p['role']=='development']
   safe=[{k:p[k] for k in ['itemId','text','occurrences','contextBefore','contextAfter','reference']} for p in dev]
   write(d/'development.json',{'passages':safe,'baseline':{lang:[p for p in read(OLD/'terms'/f'{i:02}'/'context-baseline'/lang/'no-glossary.json') if p['id'] in {str(s['itemId']) for s in safe}] for lang in languages}})
   print(json.dumps({'term':term,'rawResearch':len(research),'candidateForms':len(candidates),'sourceOnlyDevelopment':len(safe)},ensure_ascii=False),flush=True)
 finally:c.close()
 # A directly inspected edition witness is evidence; the project-prescription claim is excluded.
 supplement=read(OLD/'provenance-supplement.json') or {}
 for i,(term,_) in enumerate(TERMS,1):
  if term in supplement:write(RUN/'terms'/f'{i:02}'/'edition-witness.json',{k:supplement[term][k] for k in ['book','url','page','quote']})
 rules=read(OLD/'consumer-rules-frequency.json');write(RUN/'consumer-rules.json',{'rules':rules['rules'],'contract':'Source-derived glossary, measured sample usage order, one generic source-selection contract. No acceptance criteria or target requirements.'})
 write(RUN/'manifest.json',{'modelId':'gpt-6.1-sol','terms':[{'source_terms':[t],'languages':ls} for t,ls in TERMS],'design':'fully-blind-htn-v1','maxResearchTasksPerWord':7,'maxRepairRounds':1})
 files=[RUN/'manifest.json',RUN/'consumer-rules.json',*RUN.glob('terms/*/source.json'),*RUN.glob('terms/*/development.json'),*RUN.glob('terms/*/edition-witness.json')]
 write(RUN/'freeze.json',{'inputs':{str(p.relative_to(RUN)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files},'excludes':['Acceptance file and per-term criteria','Earlier inventories/proposals/notes/repairs','Source labels/evaluator outputs','Prior preferred-use judgments'],'rawImports':str(OLD),'note':'Source selection and evidence acquisition were informed by prior human cases; runtime interpretations, targets and decisions are fresh. Source-only no-glossary outputs may be reused.'})
if __name__=='__main__':main()
