"""Reuse exact neutral drafts as no-glossary controls; independently judge both methods."""
import argparse, datetime, json, subprocess, time
from pathlib import Path

parser=argparse.ArgumentParser();parser.add_argument('--run',type=Path,required=True)
parser.add_argument('--comparison',action='append',default=[],metavar='INDEX:METHOD',help='Restrict diagnostics to an existing method at a specific term; repeat as needed.')
args=parser.parse_args();run=args.run.resolve();here=Path(__file__).resolve().parent
read=lambda p:json.loads(p.read_text())if p.exists()else None
write=lambda p,v:(p.parent.mkdir(parents=True,exist_ok=True),p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n'))
manifest=read(run/'manifest.json')
if args.comparison:
    requested=[(int(value.split(':',1)[0]),value.split(':',1)[1])for value in args.comparison]
    if any(i<1 or i>len(manifest['terms'])or not m for i,m in requested):raise ValueError('Invalid comparison selection')
else:requested=[(i,m)for i in range(1,len(manifest['terms'])+1)for m in ['adaptive-v1','baseline-human']]
methods=list(dict.fromkeys(m for _,m in requested));selection=set(requested)
amendment=run/'evaluation-amendment-no-glossary.json'
if not amendment.exists():write(amendment,{'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'authorization':'User requested no-glossary translation baseline and paired differences between glossary effects.',
    'researchPolicyUnchanged':True,'baseline':'Exact shared neutral carrier drafts; no additional translation or empty-glossary editing pass.',
    'metrics':'Success requires improvement over no glossary. Each method vs the exact neutral drafts, then source-paired net correctness/naturalness contrasts; ties earn no credit; direct comparisons and completeness are explanatory diagnostics.'})
timings=read(run/'no-glossary-phase-timings.json')or[]
def materialize(directory,evidence):
    expected={str(p['itemId']):p['text']for p in evidence['evaluation']};items={}
    for result_file in(directory/'carrier-calls').glob('*.result.json'):
        request=read(result_file.parent/result_file.name.replace('.result.json','')/'request.json')
        if not request or request['stage']!='carrier-translate':continue
        payload=json.loads(request['content'])
        if any(expected.get(p['id'])!=p['text']for p in payload['passages']):raise RuntimeError('Neutral carrier source mismatch')
        for row in json.loads(read(result_file)['text'])['items']:
            if row['id']in items and items[row['id']]!=row:raise RuntimeError('Conflicting neutral drafts')
            items[row['id']]=row
    if set(items)!=set(expected):return False
    destination=directory/'no-glossary';destination.mkdir(exist_ok=True)
    output=destination/'controlled/translations.json';values=[items[str(p['itemId'])]for p in evidence['evaluation']]
    if output.exists():
        if read(output)!=values:raise RuntimeError('Frozen no-glossary translations changed')
    else:write(output,values)
    if not(destination/'entry.json').exists():write(destination/'entry.json',{'entries':[],'risks':[],'status':'done','reuses':'exact shared-carrier no-glossary translations; no model calls'})
    return True

while True:
    pending={m:[]for m in methods};verified={m:[]for m in methods};total=0;untestable=[]
    for i,_ in enumerate(manifest['terms'],1):
        term_methods=[m for m in methods if(i,m)in selection]
        if not term_methods:continue
        d=run/'terms'/f'{i:02}';e=read(d/'evidence.json')
        if e and not e['evaluation']:
            untestable.append(i)
            continue
        if not e or not materialize(d,e):total+=len(term_methods);continue
        for method in term_methods:
            p=d/method/'controlled/vs-no-glossary/strict'
            if not(p/'verified-judgments.json').exists():
                total+=1
                if(d/method/'entry.json').exists():
                    if(p/'judgments.json').exists():verified[method].append(i)
                    else:pending[method].append(i)
    write(run/'no-glossary-status.json',{'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'remainingMethodTerms':total,'untestableZeroHitIndices':untestable,'pending':pending,'verification':verified})
    if total==0:print(json.dumps({'no_glossary_study':'complete'}),flush=True);break
    did_work=False
    for method in methods:
        for command,indices in [('evaluate',pending[method]),('verify',verified[method])]:
            if not indices:continue
            did_work=True;started=time.monotonic();stamp=datetime.datetime.now(datetime.timezone.utc).isoformat()
            argv=['node',str(here/'lab.mjs'),command,'--run',str(run),'--methods',method,'--reference-method','no-glossary','--evaluation-mode','controlled',
                  '--indices',','.join(map(str,indices)),'--workers','2','--jobs','2','--quiet-report']
            logfile=run/'controller-logs'/f'no-glossary-{len(timings):02}-{method}-{command}.log';logfile.parent.mkdir(exist_ok=True)
            print(json.dumps({'no_glossary_phase':command,'method':method,'indices':indices}),flush=True)
            with logfile.open('w')as out:result=subprocess.run(argv,stdout=out,stderr=subprocess.STDOUT,cwd=here.parent.parent)
            timings.append({'phase':command,'method':method,'indices':indices,'startedAt':stamp,'seconds':round(time.monotonic()-started,3),'exitCode':result.returncode,'log':str(logfile)})
            write(run/'no-glossary-phase-timings.json',timings)
            if result.returncode:raise SystemExit(result.returncode)
    if not did_work:time.sleep(20)
