"""Subscription-only candidate repair; external assessment has separate code/data."""
import argparse,hashlib,json,os,subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent
RUN=HERE/'runs/2026-10-14-candidate-delivery'
p=argparse.ArgumentParser();p.add_argument('phase',choices=['baseline','build','measure','translate','verify','repair-notes','plural','plural-source','metamorphic','detector-calibrate','evaluate']);p.add_argument('--workers',type=int,default=2);a=p.parse_args()
for name,h in json.loads((RUN/'freeze.json').read_text())['inputs'].items():assert hashlib.sha256((RUN/name).read_bytes()).hexdigest()==h
lab=(HERE/'lab.mjs').read_text();transport=lab[lab.index('const ledgerFile='):lab.index('\nconst object=')];locks=lab[lab.index('async function exclusive('):lab.index('\nlet jobFailures=')]
prefix="""import fs from 'node:fs';import path from 'node:path';import {spawn,spawnSync} from 'node:child_process';import {createInterface} from 'node:readline';import {hash,checkIds} from './protocol.mjs';
const args=process.argv.slice(2);function arg(n,d){const i=args.indexOf('--'+n);return i<0?d:args[i+1];}
const run=path.resolve(arg('run','')),workers=Number(arg('workers','2')),modelId='gpt-6.1-sol',provenance=null;
const write=(f,v)=>{fs.mkdirSync(path.dirname(f),{recursive:true});const t=f+'.tmp-'+process.pid;fs.writeFileSync(t,JSON.stringify(v,null,2));fs.renameSync(t,f);};const read=f=>fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):null;
const object=p=>({type:'object',properties:p,required:Object.keys(p),additionalProperties:false}),string={type:'string'},array=items=>({type:'array',items});
"""
runtime='candidate_repair_evaluator.mjs' if a.phase=='evaluate' else 'candidate_repair_runtime.mjs'
assembled=prefix+locks+'\n'+transport+'\n'+(HERE/runtime).read_text();dependencies={n:hashlib.sha256((HERE/n).read_bytes()).hexdigest() for n in ['candidate_contracts.mjs','htn_core.mjs','protocol.mjs','lab.mjs']};signature=hashlib.sha256((assembled+json.dumps(dependencies,sort_keys=True)).encode()).hexdigest()
for n in ['candidate_repair.py',runtime,'candidate_contracts.mjs','htn_core.mjs','protocol.mjs','lab.mjs']:
 d=RUN/'code'/signature/n;d.parent.mkdir(parents=True,exist_ok=True);d.write_bytes((HERE/n).read_bytes())
m=HERE/f'.candidate-repair-{os.getpid()}.mjs';m.write_text(assembled)
try:
 subprocess.check_call(['node','--check',str(m)])
 subprocess.check_call(['node',str(m),'--run',str(RUN),'--workers',str(a.workers),'--phase',a.phase])
finally:m.unlink(missing_ok=True)
