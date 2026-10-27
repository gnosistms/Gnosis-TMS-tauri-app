import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {splitEvaluation,checkIds,blindPair,totals,needsLexicalAudit,enforceClearCorrectness,confirmJudgment} from './protocol.mjs';
test('disjoint holdout, exact duplicates removed, reproducible',()=>{
 const input=Array.from({length:100},(_,i)=>({id:i,text:String(i)}));input.push(input[0]);
 const a=splitEvaluation(input,1),b=splitEvaluation(input,1);
 assert.deepEqual(a,b);assert.equal(a.evaluation.length,40);assert.equal(a.research.length,60);
 assert.ok(!a.evaluation.some(i=>a.research.some(j=>i.text===j.text)));
});
test('sparse sample never pads, overlap is explicit',()=>{
 const a=splitEvaluation([{text:'a'},{text:'b'},{text:'a'}],1);
 assert.equal(a.evaluation.length,2);assert.equal(a.overlap,2);
});
test('evaluation rejects missing, duplicate and extra ids',()=>{
 checkIds([{id:'a'},{id:'b'}],['a','b']);
 for(const r of [[{id:'a'}],[{id:'a'},{id:'a'}],[{id:'a'},{id:'c'}]]) assert.throws(()=>checkIds(r,['a','b']));
});
test('blind judge packet carries no method metadata and private mapping resolves sides',()=>{
 const p=blindPair({id:'x',text:'source'},'base','candidate',42);
 assert.deepEqual(Object.keys(p.public),['id','source','A','B']);
 assert.equal(p.public[p.candidateSide],'candidate');
});
test('failed calls counted and missing usage stays unknown',()=>{
 const t=totals([{status:'failed',seconds:2},{status:'ok',seconds:3,usage:{input_tokens:10,cached_input_tokens:8,output_tokens:4}}]);
 assert.equal(t.calls,2);assert.equal(t.unknownUsage,1);assert.equal(t.input,10);
});
test('audit gate bypasses a single clear target and treats case spellings as one form',()=>{
 const row={sourceTerms:['Dag Dugpa','dag dugpa'],variants:[{target:'Dag Dugpa'}]};
 assert.equal(needsLexicalAudit({entries:[row]}),false);
 assert.equal(needsLexicalAudit({entries:[{...row,variants:[{target:'one'},{target:'two'}]}]}),true);
 assert.equal(needsLexicalAudit({entries:[row,{sourceTerms:['DAG DUGPA'],variants:[{target:'other meaning'}]}]}),true);
});
test('sampling is reproducible, excludes deleted entries and embargoes prior targets',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'glossary-lab-test-'));
 try{
  const glossary=path.join(root,'glossary');fs.mkdirSync(path.join(glossary,'terms'),{recursive:true});
  fs.writeFileSync(path.join(glossary,'glossary.json'),JSON.stringify({languages:{source:{code:'es'},target:{code:'vi'}}}));
  for(let i=0;i<8;i++)fs.writeFileSync(path.join(glossary,'terms',`${i}.json`),JSON.stringify({term_id:String(i),source_terms:[`source ${i}`],target_terms:['SECRET PRIOR TARGET'],note:'SECRET PRIOR NOTE',lifecycle:{state:i===7?'deleted':'active'}}));
  const sampler=fileURLToPath(new URL('./sample_terms.py',import.meta.url));
  const sample=run=>spawnSync('python3',[sampler,'--glossary',glossary,'--run',run,'--size','5','--seed','42'],{encoding:'utf8'});
  const a=path.join(root,'a'),b=path.join(root,'b');assert.equal(sample(a).status,0);assert.equal(sample(b).status,0);
  const text=fs.readFileSync(path.join(a,'manifest.json'),'utf8'),manifest=JSON.parse(text);
  assert.equal(manifest.population,7);assert.equal(manifest.terms.length,5);
  assert.deepEqual(manifest.terms,JSON.parse(fs.readFileSync(path.join(b,'manifest.json'),'utf8')).terms);
  assert.ok(!text.includes('SECRET'));assert.ok(!manifest.terms.some(x=>x.entry_id==='7'));
  assert.notEqual(sample(a).status,0);assert.equal(fs.readFileSync(path.join(a,'manifest.json'),'utf8'),text);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('strict rubric ties acceptable wording, keeps material errors, separates fluency',()=>{
 const good={accuracy:'A',naturalness:'B',winner:'A',accuracyA:'faithful',accuracyB:'minor_nuance',naturalnessA:'natural',naturalnessB:'minor_style'};
 assert.deepEqual([enforceClearCorrectness(good).accuracy,enforceClearCorrectness(good).naturalness,enforceClearCorrectness(good).winner],['tie','tie','tie']);
 const wrong={...good,accuracyB:'material_error'};assert.equal(enforceClearCorrectness(wrong).winner,'A');
 const fluency={...good,naturalnessA:'clear_problem'};assert.equal(enforceClearCorrectness(fluency).naturalness,'B');assert.equal(enforceClearCorrectness(fluency).winner,'tie');
 assert.equal(enforceClearCorrectness({...wrong,accuracyA:'uncertain'}).winner,'tie');
});

test('one-term CLI initialization needs no prior glossary and refuses replacement',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'glossary-lab-init-'));
 try{
  const cli=fileURLToPath(new URL('./lab.mjs',import.meta.url));
  const run=()=>spawnSync(process.execPath,[cli,'init','--term','new term','--run',root,'--seed','42'],{encoding:'utf8'});
  assert.equal(run().status,0);const text=fs.readFileSync(path.join(root,'manifest.json'),'utf8'),m=JSON.parse(text);
  assert.equal(m.glossary_path,null);assert.deepEqual(m.terms[0].source_terms,['new term']);
  assert.notEqual(run().status,0);assert.equal(fs.readFileSync(path.join(root,'manifest.json'),'utf8'),text);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('independent confirmation resolves swapped sides and reties disagreements',()=>{
 const first={accuracy:'A',naturalness:'tie',winner:'A',candidateSide:'A'};
 assert.equal(confirmJudgment(first,{accuracy:'B',naturalness:'tie',candidateSide:'B'}).winner,'A');
 assert.equal(confirmJudgment(first,{accuracy:'A',naturalness:'tie',candidateSide:'B'}).winner,'tie');
 assert.equal(confirmJudgment(first,{accuracy:'tie',naturalness:'tie',candidateSide:'B'}).judgeDisagreement,true);
 assert.equal(confirmJudgment({...first,accuracy:'tie',winner:'tie'},{accuracy:'B',naturalness:'tie',candidateSide:'B'}).winner,'tie');
});
test('cost accounting inherits the actual unseeded parent of truncation',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'glossary-lab-cost-'));
 try{
  const term='fixture term',dir=path.join(root,'terms/01');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'evidence.json'),JSON.stringify({term,population:{distinct:1},overlap:1,evaluation:[{text:'source'}]}));
  for(const method of ['baseline','baseline-human','no-count','curated-proposal']){
   fs.mkdirSync(path.join(dir,method),{recursive:true});fs.writeFileSync(path.join(dir,method,'entry.json'),JSON.stringify({status:'done'}));
  }
  fs.writeFileSync(path.join(dir,'baseline-human/reuse.json'),JSON.stringify({stages:['dictionary']}));
  const grade={id:'one',candidateSide:'A',winner:'tie',accuracy:'tie',naturalness:'tie',accuracyA:'faithful',accuracyB:'faithful',naturalnessA:'natural',naturalnessB:'natural'};
  for(const method of ['no-count','curated-proposal']){
   const location=path.join(dir,method,'controlled/vs-baseline-human/strict');fs.mkdirSync(location,{recursive:true});fs.writeFileSync(path.join(location,'judgments.json'),JSON.stringify([grade]));
  }
  const row=(method,stage,input)=>({term,role:'research',method,stage,purpose:'fixture',status:'ok',seconds:input/10,usage:{input_tokens:input,cached_input_tokens:0,output_tokens:input/10}});
  fs.writeFileSync(path.join(root,'requests.jsonl'),[row('baseline','dictionary',10),row('baseline','candidates',20),row('baseline','counting',30),row('baseline-human','candidates',1000),row('baseline-human','counting',2000),row('curated-proposal','curation',50)].map(JSON.stringify).join('\n'));
  const script=fileURLToPath(new URL('./analyze.py',import.meta.url));const result=spawnSync('python3',[script,root],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const analysis=JSON.parse(fs.readFileSync(path.join(root,'analysis.json'),'utf8'));
  assert.equal(analysis.methods['no-count'].effective_method_cost.input,30);
  assert.equal(analysis.methods['curated-proposal'].effective_method_cost.input,80);
  assert.equal(analysis.methods['no-count'].baseline_cost.input,3010);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
