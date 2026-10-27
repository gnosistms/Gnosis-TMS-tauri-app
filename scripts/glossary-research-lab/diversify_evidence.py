"""Freeze representative, lexically diverse source-only contexts at the same cap."""
import argparse, hashlib, json, math, re, unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from time import perf_counter

parser=argparse.ArgumentParser()
parser.add_argument('--run',type=Path,required=True)
parser.add_argument('--indices',default='1,2')
parser.add_argument('--cap',type=int,default=12)
parser.add_argument('--method',default='compact12-diverse-precise-nodict')
args=parser.parse_args()
method=args.method
if args.cap not in (12,30): raise RuntimeError('Frozen experiment permits only caps 12 or 30')
normalize=lambda s:' '.join(s.split())
fold=lambda s:''.join(c for c in unicodedata.normalize('NFD',s.lower()) if not unicodedata.combining(c))
stop=set('que los las una unos unas del por para con sin como este esta estos estas ese esa esos esas entre sobre desde hasta cuando donde porque pero mas muy todo todos toda todas hay son ser fue era han sus nos les cual cuales cada tanto tambien mismo misma mucho muchos mucho algunas algunos nuestro nuestra ellos ellas nosotros vosotros usted ustedes esta estan siendo'.split())

for index in map(int,args.indices.split(',')):
    started=perf_counter();directory=args.run/'terms'/f'{index:02}'
    out=directory/method/'evidence.json'
    if out.exists(): raise RuntimeError(f'Frozen evidence already exists: {out}')
    evidence=json.loads((directory/'evidence.json').read_text())
    excluded=[normalize(p['text']) for p in evidence['evaluation']]
    pool=[p for p in evidence['research'] if not any(x in normalize(p['text']) or normalize(p['text']) in x for x in excluded)]
    if len(pool)<args.cap: raise RuntimeError('Diversity test requires enough nonreserved contexts')
    skip=stop | {fold(s) for s in evidence['forms']}
    tokens=[Counter(w for w in re.findall(r'[a-zñ]+',fold(p['text'])) if len(w)>2 and w not in skip) for p in pool]
    df=Counter(w for words in tokens for w in words)
    vectors=[];centroid=defaultdict(float)
    for words in tokens:
        vector={w:(1+math.log(n))*math.log(1+len(pool)/(1+df[w])) for w,n in words.items()}
        norm=math.sqrt(sum(v*v for v in vector.values())) or 1
        vector={w:v/norm for w,v in vector.items()};vectors.append(vector)
        for w,v in vector.items(): centroid[w]+=v/len(pool)
    norm=math.sqrt(sum(v*v for v in centroid.values())) or 1
    centroid={w:v/norm for w,v in centroid.items()}
    centrality=[sum(v*centroid[w] for w,v in vector.items()) for vector in vectors]
    tie=lambda i:hashlib.sha256(pool[i]['text'].encode()).hexdigest()
    selected=[max(range(len(pool)),key=lambda i:(centrality[i],tie(i)))];nearest=[0.]*len(pool)
    while len(selected)<args.cap:
        chosen=vectors[selected[-1]]
        for i,vector in enumerate(vectors):
            nearest[i]=max(nearest[i],sum(v*chosen.get(w,0) for w,v in vector.items()))
        remaining=set(range(len(pool)))-set(selected)
        selected.append(max(remaining,key=lambda i:((1-nearest[i])*math.sqrt(max(centrality[i],0)),tie(i))))
    repair=dict(parent='compact12-precise-nodict',intervention='source-context selection only',
                selector='TF-IDF cosine diversity weighted by square-root centroid similarity; representative first context; deterministic SHA256 ties',
                available_nonreserved=len(pool),selected=args.cap,seconds=round(perf_counter()-started,4),
                no_human_targets=True,no_expected_answer_keywords=True,full_text_containment_excluded_both_directions=True)
    value={**evidence,'research':[pool[i] for i in selected],'repair':repair}
    if args.cap==30:
        prior=json.loads((directory/'compact12-diverse-precise-nodict/evidence.json').read_text())
        assert [p['text'] for p in value['research'][:12]]==[p['text'] for p in prior['research']]
        dictionary=json.loads((directory/'compact12-spanishdict-precise/evidence.json').read_text())['dictionaryEvidence']
        value['dictionaryEvidence']=dictionary
        value['repair'].update(parent='compact12-spanishdict-precise',intervention='passage cap 12 to 30 only',first_twelve_unchanged=True,dictionary_unchanged=True)
    out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'term':evidence['term'],**repair},ensure_ascii=False))
