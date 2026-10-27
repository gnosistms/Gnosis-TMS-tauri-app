"""Run the frozen confirmation study; all model work goes through the subscription lab."""
import argparse, datetime, hashlib, json, subprocess, time
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--run',type=Path,required=True)
args=parser.parse_args();run=args.run.resolve();here=Path(__file__).resolve().parent
read=lambda p:json.loads(p.read_text())
write=lambda p,v:p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
freeze=read(run/'policy-freeze.json');manifest=read(run/'manifest.json')
assert all(hashlib.sha256((here/f).read_bytes()).hexdigest()==h for f,h in freeze['codeHashes'].items()),'Frozen code changed'
entries=[run/'terms'/f'{i:02}'/'adaptive-v1/entry.json' for i in range(1,len(manifest['terms'])+1)]
assert all(p.exists()for p in entries),'Adaptive outputs must finish before human extraction'
optimized=run/'optimized-freeze.json'
if not optimized.exists():
    write(optimized,{'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'entries':{str(p.relative_to(run)):hashlib.sha256(p.read_bytes()).hexdigest() for p in entries}})
for p in entries:
    initial=p.parent/'initial.json'
    if initial.exists():
        value=read(initial);target=p.parent.parent/'adaptive-initial-only';target.mkdir(exist_ok=True)
        output=target/'entry.json'
        if not output.exists():write(output,{'entries':value['entries'],'risks':value['risks'],'status':'done','reuses':'adaptive-v1 initial proposal; no new research call'})
logs=run/'controller-logs';logs.mkdir(exist_ok=True)
timings=read(run/'phase-timings.json')if(run/'phase-timings.json').exists()else[]
def phase(name,command):
    started=time.monotonic();stamp=datetime.datetime.now(datetime.timezone.utc).isoformat()
    logfile=logs/f'{len(timings):02}-{name}.log'
    with logfile.open('w')as output:
        child=subprocess.Popen(command,stdout=output,stderr=subprocess.STDOUT,cwd=here.parent.parent)
        write(run/'controller-status.json',{'phase':name,'startedAt':stamp,'pid':child.pid,'log':str(logfile)})
        print(json.dumps({'phase':name,'status':'running','pid':child.pid}),flush=True)
        status=child.wait()
    timings.append({'phase':name,'startedAt':stamp,'endedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'seconds':round(time.monotonic()-started,3),'exitCode':status,'log':str(logfile)})
    write(run/'phase-timings.json',timings)
    print(json.dumps({'phase':name,'status':'complete'if status==0 else'failed','seconds':timings[-1]['seconds']}),flush=True)
    if status:raise SystemExit(status)

lab=['node',str(here/'lab.mjs')];common=['--run',str(run),'--workers','6','--jobs','6','--quiet-report']
phase('seed',lab+['seed']+common)
phase('seed-audit',lab+['seed-audit']+common)
phase('baseline-human',lab+['research','--methods','baseline-human']+common)
quality=['--methods','adaptive-v1','--reference-method','baseline-human','--evaluation-mode','controlled']
phase('evaluate',lab+['evaluate']+quality+common)
phase('verify',lab+['verify']+quality+common)
phase('completeness',lab+['completeness']+quality+common)
routed=[str(i)for i in range(1,len(entries)+1)if(read(run/'terms'/f'{i:02}'/'adaptive-v1/route.json')if(run/'terms'/f'{i:02}'/'adaptive-v1/route.json').exists()else{}).get('branch')in('coverage','dictionary')]
if routed:
    benefit=['--methods','adaptive-v1','--reference-method','adaptive-initial-only','--evaluation-mode','controlled','--indices',','.join(routed)]
    phase('routing-benefit-evaluate',lab+['evaluate']+benefit+common)
    phase('routing-benefit-verify',lab+['verify']+benefit+common)
    phase('routing-benefit-completeness',lab+['completeness']+benefit+common)
phase('exposure-audit',['python3',str(here/'audit_exposure.py'),str(run)])
assert all(hashlib.sha256((run/p).read_bytes()).hexdigest()==h for p,h in read(optimized)['entries'].items()),'Frozen adaptive entries changed'
write(run/'controller-status.json',{'phase':'complete','at':datetime.datetime.now(datetime.timezone.utc).isoformat()})
print(json.dumps({'study':'complete','run':str(run)}),flush=True)
