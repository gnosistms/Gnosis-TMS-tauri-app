"""Independent seeded source sample for preferred-use counts, excluding acceptance passages."""
import hashlib,json,re
from htn_prepare import RUN,TERMS,compact
from efficient_design import Corpus,read,write
norm=lambda s:re.sub(r'\W+','',s.casefold())
def main():
 c=Corpus(RUN)
 try:
  for i,(term,languages) in enumerate(TERMS,1):
   d=RUN/'terms'/f'{i:02}';dest=d/'frequency-input.json'
   if dest.exists():continue
   inp=read(d/'input.json');forms=read(d/'htn-v4'/languages[0]/'saved-glossary.json')['terms'][0]['sourceTerms']
   sample=c.get('/api/sample',{'forms':','.join(forms),'n':96,'seed':f'frequency-independent:261014:{i}','kind':'samael','context':1})
   allrows=[compact(p) for p in sample.get('items',[])];testids={str(p['itemId']) for p in inp['test']};texts={norm(p['text']) for p in inp['test']}
   kept=[p for p in allrows if str(p['itemId']) not in testids and norm(p['text']) not in texts][:48];overlap=False
   if not kept:kept=allrows;overlap=True
   value={'term':term,'forms':forms,'sample':kept,'populationMeta':sample.get('meta',{}),'sampling':'First 48 of a seeded uniform 96-paragraph draw, excluding acceptance ids/normalized texts. Sparse overlap explicitly allowed only when no other passage exists.','sparseOverlap':overlap,'countMeaning':'Preferred candidate usage per matched occurrence in this sample, not an exhaustive corpus count or correctness score.'}
   write(dest,value);print(json.dumps({'term':term,'paragraphs':len(kept),'occurrences':sum(len(p['occurrences']) for p in kept),'overlap':overlap}),flush=True)
 finally:c.close()
 rules=read(RUN/'consumer-rules.json');rules['rules']=rules['rules'].replace('sorted in order of preference, best first','sorted by measured frequency of use, most frequent first');rules['contract']+=' Frequency wording requested by Hans; source preferred-use counts determine ordering, project applicability is separate.'
 write(RUN/'consumer-rules-frequency.json',rules)
 write(RUN/'frequency-freeze.json',{str(p.relative_to(RUN)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [RUN/'consumer-rules-frequency.json',*RUN.glob('terms/*/frequency-input.json')]})
if __name__=='__main__':main()
