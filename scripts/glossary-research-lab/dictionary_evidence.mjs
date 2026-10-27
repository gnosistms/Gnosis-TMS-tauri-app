#!/usr/bin/env node
/** Freeze only published Spanish definitions; no target-language translations. */
import fs from 'node:fs';
import path from 'node:path';
import {hash} from './protocol.mjs';
const args=process.argv.slice(2),arg=(name,value)=>args.includes(`--${name}`)?args[args.indexOf(`--${name}`)+1]:value;
const run=path.resolve(arg('run','scripts/glossary-research-lab/runs/2026-10-12-focused')),index=Number(arg('index','2'));
const method=arg('method','compact12-spanishdict-precise'),parent=arg('parent','compact12-diverse-precise-nodict'),directory=`${run}/terms/${String(index).padStart(2,'0')}`;
const output=`${directory}/${method}/evidence.json`;if(fs.existsSync(output))throw new Error('Dictionary evidence is already frozen');
const evidence=JSON.parse(fs.readFileSync(`${directory}/${parent}/evidence.json`,'utf8'));
const lemma=arg('lemma',evidence.term);if(!evidence.forms.some(f=>f.toLowerCase()===lemma.toLowerCase()))throw new Error('Dictionary headword must be a corpus-confirmed form');
const url=new URL('https://es.wiktionary.org/w/api.php');url.search=new URLSearchParams({action:'parse',page:lemma,prop:'wikitext',format:'json'});
const started=Date.now();let response;
try{response=await fetch(url,{signal:AbortSignal.timeout(15000)});}
catch(error){fs.appendFileSync(`${run}/local-operations.jsonl`,JSON.stringify({phase:'spanish-dictionary',index,seconds:(Date.now()-started)/1000,url:String(url),status:'failed',error:error.message})+'\n');throw error;}
if(!response.ok)throw new Error(`Published dictionary request failed: ${response.status}`);
const raw=await response.json(),wikitext=raw.parse?.wikitext?.['*'];if(!wikitext)throw new Error('Dictionary supplied no page text');
const start=wikitext.search(/^==\s*\{\{lengua\|es\}\}\s*==/m);if(start<0)throw new Error('No explicit Spanish section');
const section=wikitext.slice(start).split(/\n==\s*\{\{lengua\|/u)[0].split(/\n====\s*Traducciones\s*====/u)[0];
if(!/;\d+/u.test(section))throw new Error('No published numbered meanings');
const operation={phase:'spanish-dictionary',index,seconds:(Date.now()-started)/1000,url:String(url),bytes:Buffer.byteLength(JSON.stringify(raw)),source_text_hash:hash(section),revision:raw.parse.revid??null,source_only:true};
fs.appendFileSync(`${run}/local-operations.jsonl`,JSON.stringify(operation)+'\n');
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(`${directory}/${method}/dictionary-http.json`,JSON.stringify(raw,null,2));
const dictionaryEvidence={text:`Published Spanish Wiktionary entry (CC BY-SA 4.0), ${new URL(`/wiki/${encodeURIComponent(lemma)}`,'https://es.wiktionary.org')}:\n${section}`,url:String(url),revision:operation.revision};
fs.writeFileSync(output,JSON.stringify({...evidence,dictionaryEvidence,repair:{parent,intervention:'published Spanish dictionary evidence only',...operation}},null,2));
console.log(JSON.stringify({term:evidence.term,seconds:operation.seconds,definitionCharacters:section.length,revision:operation.revision}));
