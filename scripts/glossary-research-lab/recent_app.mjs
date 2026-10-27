#!/usr/bin/env node
/** Compare fresh compact research with immutable saved Gnosis VN app results. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {hash} from './protocol.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2),command=args[0];
const option=(name,fallback)=>args.includes(`--${name}`)?args[args.indexOf(`--${name}`)+1]:fallback;
const run=path.resolve(option('run',`${here}/runs/2026-10-12-recent-app`));
const history=option('history','/Users/hans/Library/Application Support/com.gnosis.tms/installations/installation-125730441/research/51c51903-130e-4065-845f-098adea36e78');
const original=option('previous-run',`${here}/runs/2026-10-12`);
const read=p=>fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):null;
const write=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});const temp=`${p}.tmp-${process.pid}`;fs.writeFileSync(temp,JSON.stringify(v,null,2));fs.renameSync(temp,p);};
const fold=s=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim();
if(command==='freeze'){
 if(fs.existsSync(`${run}/manifest.json`))throw new Error('Manifest already frozen; use a fresh run directory');
 const groups=new Map();
 for(const name of fs.readdirSync(history)){
  const directory=path.join(history,name),meta=read(`${directory}/meta.json`);
  if(!meta||meta.sourceLanguage?.code!=='es'||meta.targetLanguage?.code!=='vi')continue;
  if(!read(`${directory}/proposal.json`)&&!read(`${directory}/frozen.json`))continue;
  const key=fold(meta.term),list=groups.get(key)??[];list.push({directory,meta});groups.set(key,list);
 }
 const chosen=[...groups.values()].map(list=>list.sort((a,b)=>(b.meta.status==='done')-(a.meta.status==='done')||b.meta.startedAt.localeCompare(a.meta.startedAt))[0]).sort((a,b)=>a.meta.startedAt.localeCompare(b.meta.startedAt));
 const manifest={seed:2026101208,population:chosen.length,glossary_path:'/Users/hans/Library/Application Support/com.gnosis.tms/installations/installation-125730441/glossaries/gnosis-es-vi-2',selection:'All distinct source terms with saved app research in Gnosis-VN ES–VI history; prefer latest completed run, otherwise latest proposal. Fixed method; new confirmation sample, not a random draw.',terms:chosen.map(({meta},i)=>({entry_id:`saved-app-${i+1}`,source_terms:[meta.term]})),development_indices:[],confirmation_indices:chosen.map((_,i)=>i+1),created:new Date().toISOString()};
 write(`${run}/manifest.json`,manifest);
 const prior=chosen.map(({directory,meta},i)=>({index:i+1,term:meta.term,directory,status:meta.status,modelId:meta.modelId,startedAt:meta.startedAt,finishedAt:meta.finishedAt??null,provisional:meta.status!=='done',hashes:Object.fromEntries(fs.readdirSync(directory).filter(n=>n.endsWith('.json')).map(n=>[n,hash(fs.readFileSync(path.join(directory,n),'utf8'))]))}));
 write(`${run}/previous-runs.json`,prior);
 fs.cpSync(`${original}/baseline-snapshot`,`${run}/baseline-snapshot`,{recursive:true});
 write(`${run}/provenance.json`,{...read(`${original}/provenance.json`),created:new Date().toISOString(),frozenFrom:original,comparison:'Saved native app results; unchanged compact12-precise-nodict prompt'});
 console.log(JSON.stringify({run,terms:prior.map(({term,status,modelId,provisional})=>({term,status,modelId,provisional}))}));
}else if(command==='import'){
 const {buildEntryDrafts}=await import(pathToFileURL(`${run}/baseline-snapshot/entry-drafts.js`));
 for(const previous of read(`${run}/previous-runs.json`)){
  const directory=`${run}/terms/${String(previous.index).padStart(2,'0')}`;
  if(!read(`${directory}/compact12-precise-nodict/entry.json`))throw new Error('Finish source-only compact research before importing saved targets');
  if(read(`${directory}/previous-app/entry.json`))continue;
  const stages={};
  for(const [name,expected] of Object.entries(previous.hashes)){
   const raw=fs.readFileSync(path.join(previous.directory,name),'utf8');
   if(hash(raw)!==expected)throw new Error(`Saved ${previous.term} stage changed after freezing: ${name}`);
   stages[name.slice(0,-5)]=JSON.parse(raw);
   fs.mkdirSync(`${directory}/previous-app/stages`,{recursive:true});fs.writeFileSync(`${directory}/previous-app/stages/${name}`,raw);
  }
  if(!stages.frozen){
   const proposal=stages.confirmedProposal??stages.proposal;
   if(!proposal?.entries?.length)throw new Error(`No previous entry proposal for ${previous.term}`);
   stages.frozen={entries:proposal.entries};
  }
  const drafts=buildEntryDrafts(stages,[]);
  const entries=Object.values(drafts).map(d=>({id:d.id,kind:d.kind,sourceTerms:d.sourceTerms,generalNote:d.generalNote??'',variants:d.variants.filter(v=>v.include).map(v=>({id:v.id,target:v.target,note:v.note??''}))}));
  if(!entries.length||entries.some(e=>!e.sourceTerms.length||!e.variants.length))throw new Error(`Empty imported entry: ${previous.term}`);
  write(`${directory}/previous-app/entry.json`,{entries,status:previous.provisional?'proposal-only':'done',native:previous,conflicts:Object.values(drafts).flatMap(d=>d.conflicts)});
  console.log(JSON.stringify({index:previous.index,term:previous.term,entries:entries.length,provisional:previous.provisional}));
 }
}else throw new Error('Usage: recent_app.mjs freeze | import [--run PATH]');
