"""Uniformly sample active source entries; never export existing target data."""
import argparse, json, random, unicodedata
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--glossary',required=True,type=Path)
parser.add_argument('--run',required=True,type=Path)
parser.add_argument('--size',default=30,type=int)
parser.add_argument('--seed',type=int)
parser.add_argument('--exclude-run',action='append',default=[],type=Path)
args=parser.parse_args()
file=args.run/'manifest.json'
if file.exists():parser.error('manifest already exists; use a fresh run directory')
metadata=json.loads((args.glossary/'glossary.json').read_text())
langs=metadata.get('languages',{})
if langs.get('source',{}).get('code')!='es' or langs.get('target',{}).get('code')!='vi':parser.error('Expected an ES–VI glossary')
entries=[]
excluded_ids=set();excluded_forms=set()
normalize=lambda s: ''.join(c for c in unicodedata.normalize('NFD',s.lower().strip()) if not unicodedata.combining(c))
for prior in args.exclude_run:
    previous=json.loads((prior/'manifest.json').read_text())
    excluded_ids.update(t['entry_id'] for t in previous['terms'])
    excluded_forms.update(normalize(f) for t in previous['terms'] for f in t['source_terms'])
active=0
for path in sorted((args.glossary/'terms').glob('*.json')):
    row=json.loads(path.read_text())
    if row.get('lifecycle',{}).get('state','active')!='active':continue
    sources=row.get('source_terms',[])
    if sources:
        active+=1
        if row.get('term_id',path.stem) not in excluded_ids and not any(normalize(f) in excluded_forms for f in sources):
            entries.append({'entry_id':row.get('term_id',path.stem),'source_terms':sources})
if not 0<args.size<=len(entries):parser.error('Sample size exceeds active population')
seed=args.seed if args.seed is not None else random.SystemRandom().randrange(2**32)
manifest={'seed':seed,'glossary_path':str(args.glossary.resolve()),'population':len(entries),'active_population':active,
          'excluded_prior_runs':[str(p.resolve()) for p in args.exclude_run],'excluded_prior_ids':sorted(excluded_ids),
          'selection':'uniform sample of active entries; first source term is headword; other source forms withheld from research',
          'terms':random.Random(seed).sample(entries,args.size)}
args.run.mkdir(parents=True,exist_ok=True);file.write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print(json.dumps({'seed':seed,'population':len(entries),'sampled':args.size,'manifest':str(file.resolve())}))
