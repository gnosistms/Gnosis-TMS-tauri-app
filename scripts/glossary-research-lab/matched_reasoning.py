"""Run matched workflows or a separate external evaluator via subscription inference."""
import argparse,hashlib,json,os,subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent
RUN=HERE/'runs/2026-10-14-equal-compute'
p=argparse.ArgumentParser();p.add_argument('phase',choices=['workflows','evaluate']);p.add_argument('--workers',type=int,default=2);p.add_argument('--cohort',choices=['primary','budgeted'],default='primary');a=p.parse_args()
for name,value in json.loads((RUN/'freeze.json').read_text())['inputs'].items():assert hashlib.sha256((RUN/name).read_bytes()).hexdigest()==value
lab=(HERE/'lab.mjs').read_text();transport=lab[lab.index('const ledgerFile='):lab.index('\nconst object=')];locks=lab[lab.index('async function exclusive('):lab.index('\nlet jobFailures=')]
prefix="""import fs from 'node:fs';import path from 'node:path';import {spawn,spawnSync} from 'node:child_process';import {createInterface} from 'node:readline';import {hash,checkIds} from './protocol.mjs';
const args=process.argv.slice(2);function arg(n,d){const i=args.indexOf('--'+n);return i<0?d:args[i+1];}
const run=path.resolve(arg('run','')),workers=Number(arg('workers','2')),modelId='gpt-6.1-sol',provenance=null;
const write=(f,v)=>{fs.mkdirSync(path.dirname(f),{recursive:true});const t=f+'.tmp-'+process.pid;fs.writeFileSync(t,JSON.stringify(v,null,2));fs.renameSync(t,f);};const read=f=>fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):null;
const object=p=>({type:'object',properties:p,required:Object.keys(p),additionalProperties:false}),string={type:'string'},array=items=>({type:'array',items});
"""
runtime='matched_reasoning_runtime.mjs' if a.phase=='workflows' else 'matched_reasoning_evaluator.mjs'
assembled=prefix+locks+'\n'+transport+'\n'+(HERE/runtime).read_text();signature=hashlib.sha256(assembled.encode()).hexdigest()
snapshot=RUN/'code'/signature;snapshot.mkdir(parents=True,exist_ok=True)
for name in ['matched_reasoning.py',runtime,'matched_reasoning_checks.mjs','protocol.mjs','lab.mjs']:(snapshot/name).write_bytes((HERE/name).read_bytes())
m=HERE/f'.matched-reasoning-{os.getpid()}.mjs';m.write_text(assembled)
try:
 subprocess.check_call(['node','--check',str(m)])
 subprocess.check_call(['node',str(m),'--run',str(RUN),'--workers',str(a.workers),'--cohort',a.cohort])
finally:m.unlink(missing_ok=True)
