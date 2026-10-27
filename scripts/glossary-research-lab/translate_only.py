"""Queue frozen controlled translations without waiting for full reference research.

Reuse the exact frozen lab functions in a temporary sibling module, replacing
only its command dispatch. Research functions, translation requests, cache keys,
authentication and usage logging are unchanged. No research command is exposed.
"""
import argparse, datetime, hashlib, json, os, subprocess, time
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--run',type=Path,required=True)
parser.add_argument('--workers',type=int,default=6)
parser.add_argument('--jobs',type=int,default=6)
args=parser.parse_args();run=args.run.resolve();here=Path(__file__).resolve().parent
source=(here/'lab.mjs').read_text();source_hash=hashlib.sha256(source.encode()).hexdigest()
freeze=json.loads((run/'policy-freeze.json').read_text())
assert source_hash==freeze['codeHashes']['lab.mjs'],'Frozen lab changed'
boundary='\ntry{\n if(command===\'prepare\')'
assert source.count(boundary)==1,'Frozen dispatch boundary changed'
prefix=source[:source.index(boundary)]
dispatch="""
try {
 if(command!=='evaluate'||evaluationMode!=='controlled')throw new Error('Translation-only adapter requires controlled evaluation');
 const auth=spawnSync('codex',['login','status'],{encoding:'utf8'});
 if(!`${auth.stdout}${auth.stderr}`.includes('Logged in using ChatGPT'))throw new Error('ChatGPT authentication required; API fallback forbidden');
 const methods=arg('methods','adaptive-v1').split(',');
 if(methods.some(m=>!registeredMethods.has(m)))throw new Error('Unknown method');
 const indices=manifest.terms.map((_,i)=>i+1);
 for(const method of methods)await concurrent(indices,i=>exclusive(`translate:${evaluationMode}:${i}:${method}`,()=>translate(i,method)));
} catch(error) {console.error(error);process.exitCode=1;}
"""
module=here/f'.translation-only-{os.getpid()}.mjs'
started=time.monotonic();stamp=datetime.datetime.now(datetime.timezone.utc).isoformat()
module.write_text(prefix+dispatch)
record={'startedAt':stamp,'frozenLabSha256':source_hash,'sharedFunctionsSha256':hashlib.sha256(prefix.encode()).hexdigest(),
        'dispatchSha256':hashlib.sha256(dispatch.encode()).hexdigest(),'researchPolicyUnchanged':True,
        'purpose':'Generate the same controlled neutral and adaptive translations early; later evaluations reuse identical checkpoints.',
        'workers':args.workers,'jobs':args.jobs}
path=run/'translation-only-phase.json';path.write_text(json.dumps(record,indent=2)+'\n')
try:
    status=subprocess.call(['node',str(module),'evaluate','--run',str(run),'--methods','adaptive-v1',
                            '--evaluation-mode','controlled','--workers',str(args.workers),'--jobs',str(args.jobs)],cwd=here.parent.parent)
finally:module.unlink(missing_ok=True)
record.update(seconds=round(time.monotonic()-started,3),endedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),exitCode=status)
path.write_text(json.dumps(record,indent=2)+'\n')
raise SystemExit(status)
