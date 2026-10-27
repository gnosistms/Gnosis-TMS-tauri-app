"""Run a standalone criteria-free HTN. Evaluation is a separate process/directory."""
import argparse,os,subprocess,hashlib,json
from pathlib import Path
HERE=Path(__file__).resolve().parent
RUN=HERE/'runs/2026-10-14-htn-blind'
def read(p):return json.loads(p.read_text()) if p.exists() else None
def write(p,value):
 p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
p=argparse.ArgumentParser();p.add_argument('--run',type=Path,default=RUN);p.add_argument('--indices',default='1,2,3,4,5,6,7');p.add_argument('--workers',type=int,default=2);p.add_argument('--phase',choices=['research','final'],default='research');a=p.parse_args();RUN=a.run.resolve()
for name,h in read(RUN/'freeze.json')['inputs'].items():assert hashlib.sha256((RUN/name).read_bytes()).hexdigest()==h
lab=(HERE/'lab.mjs').read_text()
transport=lab[lab.index('const ledgerFile='):lab.index('\nconst object=')]
locks=lab[lab.index('async function exclusive('):lab.index('\nlet jobFailures=')]
prefix="""import fs from 'node:fs';import path from 'node:path';import {spawn,spawnSync} from 'node:child_process';import {createInterface} from 'node:readline';import {hash,checkIds} from './protocol.mjs';
const args=process.argv.slice(2);function arg(n,d){const i=args.indexOf('--'+n);return i<0?d:args[i+1];}
const run=path.resolve(arg('run','')),workers=Number(arg('workers','2')),modelId='gpt-6.1-sol',provenance=null;
const write=(f,v)=>{fs.mkdirSync(path.dirname(f),{recursive:true});const t=f+'.tmp-'+process.pid;fs.writeFileSync(t,JSON.stringify(v,null,2));fs.renameSync(t,f);};const read=f=>fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):null;
const object=p=>({type:'object',properties:p,required:Object.keys(p),additionalProperties:false}),string={type:'string'},array=items=>({type:'array',items});
"""
runtime=(HERE/'htn_blind_runtime.mjs').read_text();assembled=prefix+locks+'\n'+transport+'\n'+runtime
code={n:hashlib.sha256((HERE/n).read_bytes()).hexdigest() for n in ['htn_blind.py','htn_blind_prepare.py','htn_blind_runtime.mjs','htn_core.mjs','candidate_contracts.mjs','protocol.mjs','lab.mjs']};signature=hashlib.sha256(assembled.encode()).hexdigest()
for n in code:
 dest=RUN/'code'/signature/n;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes((HERE/n).read_bytes())
write(RUN/'code'/signature/'manifest.json',{'files':code,'assembledSha256':signature,'criterionAccess':'None; transport only, no research/evaluator dispatch import'})
m=HERE/f'.htn-blind-{os.getpid()}.mjs';m.write_text(assembled)
try:
 subprocess.check_call(['node','--check',str(m)])
 subprocess.check_call(['node',str(m),'--run',str(RUN),'--indices',a.indices,'--workers',str(a.workers),'--phase',a.phase])
finally:m.unlink(missing_ok=True)
