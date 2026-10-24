"""Standalone source-only meaning/binding feasibility calls; no evaluator import."""
import argparse,hashlib,json,os,subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent
RUN=HERE/'runs/2026-10-14-meaning-binding'
p=argparse.ArgumentParser();p.add_argument('phase',choices=['direct','classify','map','translate','translate-direct','review','refine','classify-refined','map-refined']);p.add_argument('--workers',type=int,default=2);a=p.parse_args()
freeze=json.loads((RUN/'freeze.json').read_text())
assert hashlib.sha256((RUN/'source.json').read_bytes()).hexdigest()==freeze['sourceSha256']
lab=(HERE/'lab.mjs').read_text();transport=lab[lab.index('const ledgerFile='):lab.index('\nconst object=')];locks=lab[lab.index('async function exclusive('):lab.index('\nlet jobFailures=')]
prefix="""import fs from 'node:fs';import path from 'node:path';import {spawn,spawnSync} from 'node:child_process';import {createInterface} from 'node:readline';import {hash,checkIds} from './protocol.mjs';
const args=process.argv.slice(2);function arg(n,d){const i=args.indexOf('--'+n);return i<0?d:args[i+1];}
const run=path.resolve(arg('run','')),workers=Number(arg('workers','2')),modelId='gpt-6.1-sol',provenance=null;
const write=(f,v)=>{fs.mkdirSync(path.dirname(f),{recursive:true});const t=f+'.tmp-'+process.pid;fs.writeFileSync(t,JSON.stringify(v,null,2));fs.renameSync(t,f);};const read=f=>fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):null;
const object=p=>({type:'object',properties:p,required:Object.keys(p),additionalProperties:false}),string={type:'string'},array=items=>({type:'array',items});
"""
assembled=prefix+locks+'\n'+transport+'\n'+(HERE/'meaning_probe_runtime.mjs').read_text()
signature=hashlib.sha256(assembled.encode()).hexdigest();snapshot=RUN/'code'/signature;snapshot.mkdir(parents=True,exist_ok=True)
for n in ['meaning_probe.py','meaning_probe_runtime.mjs','meaning_binding.mjs','protocol.mjs','lab.mjs']:(snapshot/n).write_bytes((HERE/n).read_bytes())
m=HERE/f'.meaning-probe-{os.getpid()}.mjs';m.write_text(assembled)
try:
 subprocess.check_call(['node','--check',str(m)])
 subprocess.check_call(['node',str(m),'--run',str(RUN),'--phase',a.phase,'--workers',str(a.workers)])
finally:m.unlink(missing_ok=True)
