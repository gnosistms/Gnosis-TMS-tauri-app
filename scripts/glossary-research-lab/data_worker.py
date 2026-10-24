"""Read-only RPC bridge to the canonical corpus sampler and cached language data."""
import gzip, hashlib, json, math, random, re, sqlite3, sys, time
from pathlib import Path
from urllib.parse import urlparse, parse_qs

gen, database, data_root, cache_root = map(Path, sys.argv[1:5])
sys.path.insert(0, str(gen))
import serve_search as api
from build_search_db import preload_lemmas
con = sqlite3.connect(f'file:{database}?mode=ro', uri=True)
preload_lemmas(str(database))
cur = con.cursor()
glossary = api.GlossaryStore(str(gen / 'glossary.db'))
policy = api.BibliographicalReaderPolicy(str(gen / 'bibliographical_reader_policy.json'))
manifest = json.loads((data_root / 'manifest.json').read_text())
frequencies, sentences, lower_sentences = {}, {}, {}
cache_root.mkdir(parents=True, exist_ok=True)

def language(code):
    entry = manifest['languages'][code]
    if code not in frequencies:
        file = data_root / entry['frequency']['file']
        if hashlib.sha256(file.read_bytes()).hexdigest() != entry['frequency']['sha256']:
            raise ValueError('frequency file hash mismatch')
        with gzip.open(file, 'rt') as f:
            frequencies[code] = {w: float(z) for line in f if '\t' in line for w,z in [line.rstrip().split('\t',1)]}
    return entry

def general(code, forms, limit=100, seed='1'):
    entry = language(code)
    if code not in sentences:
        file = data_root / entry['sentences']['file']
        if hashlib.sha256(file.read_bytes()).hexdigest() != entry['sentences']['sha256']:
            raise ValueError('sentence file hash mismatch')
        with gzip.open(file, 'rt') as f:
            sentences[code] = [s.rstrip() for s in f]
        lower_sentences[code] = [s.lower() for s in sentences[code]]
    forms = sorted(set(w.lower().strip() for w in forms if w.strip()),key=len,reverse=True)
    if not forms: return {'hits':0,'sample':[]}
    pattern = re.compile(r'(?<!\w)(?:'+'|'.join(re.escape(w) for w in forms)+r')(?!\w)',re.I)
    # C substring searches cheaply reject nonmatches; the original Unicode regex
    # still decides eligibility. This changes bridge speed, not corpus results.
    hits = [s for s,lower in zip(sentences[code],lower_sentences[code])
            if any(form in lower for form in forms) and pattern.search(s)]
    info = entry['sentences']
    return {'hits':len(hits),'sample':random.Random(str(seed)).sample(hits,min(limit,len(hits))),
            'corpusTokens':info.get('tokens'),'corpus':info['corpus'],'zipfOffset':info.get('zipfOffset')}

def execute(req):
    op = req['op']
    if op == 'search':
        u = urlparse(req['url']); p = parse_qs(u.query)
        handlers = {
            '/api/sample':lambda:api.api_sample(cur,p,policy),
            '/api/sample/forms':lambda:api.api_sample_forms(cur,p),
            '/api/sample/collocations':lambda:api.api_sample_collocations(cur,p,policy),
            '/api/sample/source-books':lambda:api.api_sample_source_books(cur,glossary),
            '/api/sample/original-terms':lambda:api.api_sample_original_terms(cur,p,glossary),
            '/api/sample/near-forms':lambda:api.api_sample_near_forms(cur,p),
            '/api/search/forms':lambda:api.api_search_forms(cur,p),
            '/api/sample/earliest':lambda:api.api_sample_earliest(cur,p,policy),
            '/api/original/sample':lambda:api.api_original_sample(p,glossary),
        }
        if u.path not in handlers: raise ValueError('unsupported corpus endpoint '+u.path)
        return handlers[u.path]()
    code=req['code']
    entry=language(code)
    if op == 'ensure':return {'available':True,'sentences':entry['sentences']['sentences']}
    if op == 'zipf':return [frequencies[code].get(w.lower().strip(),0) for w in req['words']]
    if op == 'sentences':return general(code,req['forms'],req['limit'],req['seed'])
    if op == 'corpusZipf':
        rows=[]
        for phrase in req['phrases']:
            g=general(code,[phrase],0)
            z=math.log10(g['hits'])+g['zipfOffset'] if g['hits'] and g.get('zipfOffset') is not None else 0
            rows.append({'phrase':phrase,'hits':g['hits'],'zipf':z})
        return rows
    raise ValueError('unknown operation')

for line in sys.stdin:
    started=time.monotonic()
    try:
        req=json.loads(line); key=hashlib.sha256(json.dumps({k:v for k,v in req.items() if k != 'id'},sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        file=cache_root/f'{key}.json'
        cached=file.exists()
        if cached: result=json.loads(file.read_text())
        else:
            result=execute(req);file.write_text(json.dumps(result,ensure_ascii=False))
        response={'id':req['id'],'result':result,'seconds':time.monotonic()-started,'cached':cached}
    except Exception as e:
        response={'id':req.get('id'),'error':f'{type(e).__name__}: {e}'}
    print(json.dumps(response,ensure_ascii=False),flush=True)
