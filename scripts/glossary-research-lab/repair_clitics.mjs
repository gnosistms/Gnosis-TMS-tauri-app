#!/usr/bin/env node
/** Source-only, deterministic recall repair for Spanish attached-pronoun forms. */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {hash} from './protocol.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),args=process.argv.slice(2);
const arg=(key,value)=>args.includes(`--${key}`)?args[args.indexOf(`--${key}`)+1]:value;
const run=path.resolve(arg('run',`${here}/runs/2026-10-12-recent-app`)),index=Number(arg('index','5'));
const directory=`${run}/terms/${String(index).padStart(2,'0')}`,destination=`${directory}/compact12-clitics-precise-nodict/evidence.json`;
if(fs.existsSync(destination))throw new Error('Repair evidence is already frozen');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const evidence=read(`${directory}/evidence.json`),manifest=read(`${run}/manifest.json`),provenance=read(`${run}/provenance.json`);
if(!/(ar|er|ir)$/u.test(evidence.term.toLowerCase()))throw new Error('This bounded experiment requires a Spanish infinitive');
const candidates=new Set();
for(const form of evidence.forms){
 const word=form.normalize('NFC').toLowerCase();
 if(/(ar|er|ir)$/u.test(word))for(const ending of ['me','te','se','nos','os','lo','la','los','las'])candidates.add(word+ending);
 if(/ando$/u.test(word))for(const ending of ['ándome','ándote','ándose','ándonos','ándoos','ándolo','ándola','ándolos','ándolas'])candidates.add(word.slice(0,-4)+ending);
 if(/iendo$/u.test(word))for(const ending of ['iéndome','iéndote','iéndose','iéndonos','iéndoos','iéndolo','iéndola','iéndolos','iéndolas'])candidates.add(word.slice(0,-5)+ending);
}
const worker=spawn('python3',[`${here}/data_worker.py`,arg('corpus-project','/Users/hans/Desktop/AI-Projects/GlossaryGen'),provenance.db,provenance.languageRoot,`${run}/evidence`],{stdio:['pipe','pipe','inherit'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
let sequence=0;const pending=new Map();
createInterface({input:worker.stdout}).on('line',line=>{const response=JSON.parse(line),p=pending.get(response.id);pending.delete(response.id);fs.appendFileSync(`${run}/local-operations.jsonl`,JSON.stringify({phase:'clitic-expansion',index,seconds:response.seconds,cached:response.cached,error:response.error})+'\n');if(response.error)p?.reject(new Error(response.error));else p?.resolve(response.result);});
worker.on('exit',code=>{for(const p of pending.values())p.reject(new Error(`Worker exited ${code}`));pending.clear();});
const rpc=request=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});worker.stdin.write(JSON.stringify({...request,id})+'\n');});
try{
 const {createSamaelCorpus}=await import(pathToFileURL(`${run}/baseline-snapshot/glossary-research-corpus.js`));
 const corpus=createSamaelCorpus({baseUrl:'https://corpus.local',fetchImpl:async url=>({ok:true,status:200,json:()=>rpc({op:'search',url:String(url)})})});
 const confirmed=[];
 for(const form of candidates){const population=await corpus.population([form]);if(population.distinct>0)confirmed.push(form);}
 const forms=[...new Set([...evidence.forms,...confirmed])];
 const pool=await corpus.sample(forms,10000,`${manifest.seed}:clitics:${index}`);
 const normalized=text=>text.replace(/\s+/gu,' ').trim();
 const reserved=evidence.evaluation.map(item=>normalized(item.text));
 const clean=pool.items.filter(item=>{const text=normalized(item.text);return !reserved.some(heldout=>text.includes(heldout)||heldout.includes(text));});
 const unique=[...new Map([...evidence.research,...clean].map(item=>[hash(item.text),item])).values()];
 if(unique.length<12)throw new Error(`Only ${unique.length} independent raw passages available; do not leak reserved texts to fill the budget`);
 const initial=new Set(evidence.research.map(item=>hash(item.text)));
 unique.sort((a,b)=>(initial.has(hash(b.text))-initial.has(hash(a.text)))||hash(`${manifest.seed}:clitics:${a.text}`).localeCompare(hash(`${manifest.seed}:clitics:${b.text}`)));
 const repaired={...evidence,forms,research:unique.slice(0,12),repair:{kind:'mechanical attached-pronoun recall',confirmedForms:confirmed,candidateForms:[...candidates],availableNonreserved:unique.length,population:await corpus.population(forms),evaluationUnchanged:true,notProvided:'Human glossary, previous app entries, previous source aliases or loss-case texts'}};
 fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,JSON.stringify(repaired,null,2));
 console.log(JSON.stringify({term:evidence.term,confirmedForms:confirmed,originalResearch:evidence.research.length,repairedResearch:repaired.research.length,availableNonreserved:unique.length,expandedPopulation:repaired.repair.population.distinct}));
}finally{worker.stdin.end();}
