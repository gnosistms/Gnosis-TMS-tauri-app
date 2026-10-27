"""Isolate extra translation attention from research, preserving the no-glossary yardstick."""
import argparse, hashlib, json, os, subprocess, time
from pathlib import Path

parser=argparse.ArgumentParser();parser.add_argument('--run',type=Path,required=True)
parser.add_argument('--indices',required=True);parser.add_argument('--workers',type=int,default=2)
args=parser.parse_args();run=args.run.resolve();here=Path(__file__).resolve().parent
source=(here/'lab.mjs').read_text();frozen=json.loads((here/'runs/2026-10-13-adaptive/policy-freeze.json').read_text())
assert hashlib.sha256(source.encode()).hexdigest()==frozen['codeHashes']['lab.mjs'],'Frozen evaluator changed'
boundary='\ntry{\n if(command===\'prepare\')';assert source.count(boundary)==1
prefix=source[:source.index(boundary)]
dispatch="""
async function reviseWithoutResearch(index) {
 const dir=`${run}/terms/${String(index).padStart(2,'0')}`,e=read(`${dir}/evidence.json`);
 const method='no-glossary-revision',drafts=read(`${dir}/no-glossary/controlled/translations.json`);
 if(!drafts)throw new Error('Exact neutral drafts must exist first');
 const dest=evalPath(dir,method,'translations');if(read(dest))return;
 checkIds(drafts,e.evaluation.map(p=>String(p.itemId)));
 const map=new Map(drafts.map(p=>[p.id,p]));const output=[];
 for(let at=0;at<e.evaluation.length;at+=10) {
  const passages=e.evaluation.slice(at,at+10).map(p=>({id:String(p.itemId),text:p.text}));
  const result=await call({term:e.term,method,stage:'evaluation-translate',purpose:'matched term-focused revision without any glossary or research',effort:'low',schema:translationSchema,
   instructions:'Recheck the researched word or phrase in each shared Vietnamese translation draft using only the Spanish source for meaning. If its translation is inaccurate, replace it with the most accurate, natural context-fitting translation. Retain accurate existing wording. Make only grammatical adjustments necessary for that replacement. Preserve the draft wording everywhere else exactly, including unrelated terms, names and sentence structure. Do not fix unrelated mistakes or improve unrelated style. Do not add explanations absent from the source. No glossary, suggested translations or research findings are supplied. Return the full resulting passage and every id exactly once.',
   content:JSON.stringify({term:e.term,passages,sharedDrafts:passages.map(p=>map.get(p.id))})},`${dir}/${method}/evaluation-calls`,'evaluation');
  const rows=JSON.parse(result.text).items;checkIds(rows,passages.map(p=>p.id));output.push(...rows);
 }
 write(dest,output);
 write(`${dir}/${method}/entry.json`,{entries:[],risks:[],status:'done',notAResearchedGlossary:true,sourceOnlyControl:true});
}
try {
 if(command!=='evaluate'||evaluationMode!=='controlled')throw new Error('Controlled evaluation required');
 const auth=spawnSync('codex',['login','status'],{encoding:'utf8'});
 if(!`${auth.stdout}${auth.stderr}`.includes('Logged in using ChatGPT'))throw new Error('ChatGPT authentication required');
 const indices=arg('indices','').split(',').map(Number);
 if(indices.some(i=>!Number.isInteger(i)||i<1||i>manifest.terms.length))throw new Error('Invalid indices');
 for(const index of indices) {
  await exclusive(`no-glossary-revision:${index}`,()=>reviseWithoutResearch(index));
  await exclusive(`evaluate:controlled:no-glossary:strict:${index}:no-glossary-revision`,()=>evaluate(index,'no-glossary-revision'));
  await exclusive(`verify:controlled:no-glossary:strict:${index}:no-glossary-revision`,()=>verify(index,'no-glossary-revision'));
 }
} catch(error) {console.error(error);process.exitCode=1;}
"""
module=here/f'.revision-control-{os.getpid()}.mjs';module.write_text(prefix+dispatch)
started=time.monotonic();record={'indices':args.indices,'frozenLabSha256':hashlib.sha256(source.encode()).hexdigest(),
    'sharedFunctionsSha256':hashlib.sha256(prefix.encode()).hexdigest(),'dispatchSha256':hashlib.sha256(dispatch.encode()).hexdigest(),
    'control':'Source and exact neutral drafts only; term-focused revision; no glossary/research; same translation and judgment model/settings.',
    'scope':'Exploratory control chosen after a glossary benefit was observed; not an automatic research router validation.'}
output=run/'revision-control-phase.json';output.write_text(json.dumps(record,indent=2)+'\n')
try:
    status=subprocess.call(['node',str(module),'evaluate','--run',str(run),'--evaluation-mode','controlled',
                            '--reference-method','no-glossary','--indices',args.indices,'--workers',str(args.workers)],cwd=here.parent.parent)
finally:module.unlink(missing_ok=True)
record.update(seconds=round(time.monotonic()-started,3),exitCode=status);output.write_text(json.dumps(record,indent=2)+'\n')
raise SystemExit(status)
