"""Confirm emitted whole source forms mechanically; preserve original outputs."""
import argparse, json, subprocess
from pathlib import Path
from urllib.parse import urlencode

parser=argparse.ArgumentParser();parser.add_argument('--run',type=Path,required=True)
parser.add_argument('--method',default='adaptive-v1');parser.add_argument('--validated-method')
args=parser.parse_args();run=args.run.resolve();here=Path(__file__).resolve().parent
read=lambda p:json.loads(p.read_text());provenance=read(run/'provenance.json')
worker=subprocess.Popen(['python3',str(here/'data_worker.py'),'/Users/hans/Desktop/AI-Projects/GlossaryGen',provenance['db'],provenance['languageRoot'],str(run/'evidence')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
rows=[];sequence=0
try:
    for directory in sorted((run/'terms').iterdir()):
        evidence=read(directory/'evidence.json');file=directory/args.method/'entry.json'
        if not file.exists():continue
        entry=read(file);counts={}
        for form in sorted(set(s for row in entry['entries']for s in row['sourceTerms'])):
            sequence+=1;worker.stdin.write(json.dumps({'id':sequence,'op':'search','url':'https://corpus.local/api/sample?'+urlencode({'forms':form,'n':0,'kind':'samael'})})+'\n');worker.stdin.flush()
            result=json.loads(worker.stdout.readline())
            if result.get('error'):raise RuntimeError(result['error'])
            counts[form]=result['result']['population_distinct']
            rows.append(dict(index=int(directory.name),term=evidence['term'],sourceForm=form,corpusPassages=counts[form],lookupSeconds=result['seconds'],cached=result['cached']))
        if args.validated_method:
            output=directory/args.validated_method/'entry.json'
            if output.exists():raise RuntimeError('Validated output already frozen')
            entries=[{**row,'sourceTerms':[form for form in row['sourceTerms']if counts[form]>0]}for row in entry['entries']]
            value={**entry,'entries':[row for row in entries if row['sourceTerms']],
                   'validation':{'parent':args.method,'removedZeroHitSourceForms':[f for f,n in counts.items()if n==0],'noTargetOrNoteChanges':True,'noNewModelCalls':True}}
            output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
finally:worker.stdin.close();worker.wait()
result={'method':args.method,'rows':rows,'unsupported':[r for r in rows if r['corpusPassages']==0],'notResearchInput':True}
(run/'source-form-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'forms_checked':len(rows),'unsupported':result['unsupported']},ensure_ascii=False))
