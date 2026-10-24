"""Bounded source-book provenance evidence; no Gnosis target glossary access."""
import argparse, json, re, subprocess
from pathlib import Path
from time import perf_counter
from urllib.parse import urlencode

parser=argparse.ArgumentParser()
parser.add_argument('--run',type=Path,required=True)
parser.add_argument('--indices',required=True)
args=parser.parse_args();here=Path(__file__).resolve().parent
method='compact12-provenance-precise-nodict';parent='compact12-diverse-precise-nodict'
prov=json.loads((args.run/'provenance.json').read_text());manifest=json.loads((args.run/'manifest.json').read_text())
worker=subprocess.Popen(['python3',str(here/'data_worker.py'),'/Users/hans/Desktop/AI-Projects/GlossaryGen',prov['db'],prov['languageRoot'],str(args.run/'evidence')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
sequence=0
def rpc(endpoint,params,index):
    global sequence
    sequence+=1;worker.stdin.write(json.dumps(dict(id=sequence,op='search',url='https://corpus.local'+endpoint+'?'+urlencode(params)))+'\n');worker.stdin.flush()
    row=json.loads(worker.stdout.readline())
    with (args.run/'local-operations.jsonl').open('a') as f: f.write(json.dumps(dict(phase='bounded-provenance',index=index,**row))+'\n')
    if row.get('error'): raise RuntimeError(row['error'])
    return row['result']
try:
    books=rpc('/api/sample/source-books',{},0)['books']
    for index in map(int,args.indices.split(',')):
        started=perf_counter();directory=args.run/'terms'/f'{index:02}';out=directory/method/'evidence.json'
        if out.exists(): raise RuntimeError('Evidence already frozen')
        evidence=json.loads((directory/parent/'evidence.json').read_text())
        forms=','.join(evidence['forms']);seed=f"{manifest['seed']}:provenance:{index}"
        response=rpc('/api/sample/original-terms',dict(forms=forms),index)
        pairs=sorted(response.get('pairs',[]),key=lambda p:(p.get('basis')!='printed_glossaries',-(p.get('original_count') or 0),p.get('title') or '',p.get('original_term') or ''))
        selected=[];seen=set();reserved=[' '.join(p['text'].split()) for p in evidence['evaluation']]
        for pair in pairs:
            book_id=pair.get('book_id')
            if not book_id or book_id in seen: continue
            seen.add(book_id)
            original=rpc('/api/original/sample',dict(book_id=book_id,forms=','.join([pair['original_term'],*pair.get('original_forms',[])]),seed=seed,n=2),index)
            if original.get('error') or not original.get('items'): continue
            book=next((b for b in books if b.get('doc_id')==pair.get('doc_id')), {})
            title=(pair.get('title') or '').split(' — ')[0]
            phrases=[re.sub(r'\s*\([^)]*\)\s*',' ',title).strip(),*re.findall(r'\(([^)]+)\)',title)]
            citations=rpc('/api/sample',dict(forms=','.join(p for p in phrases if len(p)>3),require=forms,n=8,seed=seed,kind='samael',context=0),index).get('items',[])
            clean=[p for p in citations if not any(t in ' '.join(p['text'].split()) or ' '.join(p['text'].split()) in t for t in reserved)]
            selected.append(dict(pair=pair,book=book,original_passages=[dict(text=p['text'],reference=p.get('reference'),clipped=p.get('clipped',False)) for p in original['items']],
                                 nonreserved_author_citation=[dict(text=p['text'],copies=p.get('copies',[])) for p in clean[:1]]))
            if len(selected)==3: break
        repair=dict(parent=parent,intervention='bounded source provenance',matching_pairs=len(pairs),books_read=len(selected),
                    original_passages=sum(len(s['original_passages']) for s in selected),seconds=round(perf_counter()-started,4),
                    no_gnosis_targets_or_notes=True,not_first_or_exclusive_origin_proof=True)
        value={**evidence,'sourceProvenance':selected,'repair':repair}
        out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps(dict(term=evidence['term'],**repair),ensure_ascii=False))
finally:
    worker.stdin.close();worker.wait()
