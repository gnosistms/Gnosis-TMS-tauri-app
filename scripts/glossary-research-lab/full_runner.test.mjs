import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const here=path.dirname(new URL(import.meta.url).pathname);
const read=name=>fs.readFileSync(path.join(here,name),'utf8');
const lab=read('lab.mjs'),boundary="\ntry{\n if(command==='prepare')";
const prefix=lab.slice(0,lab.indexOf(boundary));
function syntax(source){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gnosis-full-runner-'));
 try{const file=path.join(dir,'runner.mjs');fs.writeFileSync(file,source);return spawnSync(process.execPath,['--check',file],{encoding:'utf8'});}
 finally{fs.rmSync(dir,{recursive:true});}
}
test('actual assembled full runner parses with the inherited lab helpers',()=>{
 assert.equal(lab.split(boundary).length,2);
 const r=syntax(prefix+'\n'+read('full_research_dispatch.mjs'));
 assert.equal(r.status,0,r.stderr);
});
test('syntax preflight detects the real duplicate-evaluate mutation',()=>{
 const s=read('full_research_dispatch.mjs').replaceAll('assessFull(index)','evaluate(index)');
 const r=syntax(prefix+'\n'+s);
 assert.notEqual(r.status,0);assert.match(r.stderr,/evaluate.*already been declared/);
});
test('additional challenge runner also parses with all actual inherited helpers',()=>{
 const full=read('full_research_dispatch.mjs');
 const r=syntax(prefix+'\n'+full.slice(0,full.indexOf('\ntry{\n if(phase==='))+'\n'+read('full_challenges_dispatch.mjs'));
 assert.equal(r.status,0,r.stderr);
});
test('actual neutral-draft path preserves completed frozen control bytes without inference',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gnosis-neutral-freeze-'));
 const module=path.join(here,`.neutral-freeze-test-${process.pid}.mjs`);
 try{
  fs.mkdirSync(path.join(dir,'terms/01'),{recursive:true});
  fs.mkdirSync(path.join(dir,'assessment-only'),{recursive:true});
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({seed:1,terms:[{source_terms:['Íntimo']}]}));
  fs.writeFileSync(path.join(dir,'assessment-only/criteria.json'),'{}');
  fs.writeFileSync(path.join(dir,'terms/01/evidence.json'),JSON.stringify({term:'Íntimo',evaluation:[{itemId:'ordinary-friend',text:'Un amigo íntimo.'}]}));
  const frozen='[\n  {"id":"ordinary-friend", "translation":"A close friend."}\n]\n';
  const file=path.join(dir,'terms/01/no-glossary.json');fs.writeFileSync(file,frozen);
  const full=read('full_research_dispatch.mjs');
  fs.writeFileSync(module,prefix+'\n'+full.slice(0,full.indexOf('\ntry{\n if(phase==='))+'\nawait draft(1);\n');
  const r=spawnSync(process.execPath,[module,'neutral','--run',dir,'--language','en'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  assert.equal(fs.readFileSync(file,'utf8'),frozen);
  assert.equal(fs.existsSync(path.join(dir,'requests.jsonl')),false);
 }finally{fs.rmSync(dir,{recursive:true});fs.rmSync(module,{force:true});}
});
