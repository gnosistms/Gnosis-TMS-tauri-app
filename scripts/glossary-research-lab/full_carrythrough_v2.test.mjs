import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {preserveFullFindings as v1} from './full_carrythrough.mjs';
import {preserveFullFindings,consumerGuide} from './full_carrythrough_v2.mjs';
function load(relative){
 const dir=new URL(relative,import.meta.url),stages={};
 for(const name of fs.readdirSync(new URL('stages/',dir)).filter(n=>n.endsWith('.json')))stages[name.slice(0,-5)]=JSON.parse(fs.readFileSync(new URL('stages/'+name,dir)));
 return {stages,entry:JSON.parse(fs.readFileSync(new URL('entry.json',dir)))};
}
test('real Hooltanpanas negative control: different labels for a verified name and its definition do not create a second meaning',()=>{
 const x=load('./runs/2026-10-13-full-preservation/en/terms/13/baseline/');
 assert.ok(v1(x.stages,x.entry).entries[0].variants.some(v=>v.target==='complete range of cosmic color tones'));
 const fixed=preserveFullFindings(x.stages,x.entry);
 assert.deepEqual(fixed.entries[0].variants.map(v=>v.target),['Hooltanpanas']);
 const packet=consumerGuide(fixed);
 assert.equal(packet.verifiedOriginalTerms[0].term,'Hooltanpanas');
 assert.ok(packet.entries[0].variants[0].readerNotes.length);
 assert.ok(packet.sourceMeaningDefinitions.some(s=>s.definition.includes('5,764,801')));
});
test('real fatal positive control: protecting a name cannot erase the required finer inevitable branch',()=>{
 const x=load('./runs/2026-10-12-focused/terms/02/baseline-human/');
 const fixed=preserveFullFindings(x.stages,x.entry);
 assert.ok(fixed.entries.flatMap(e=>e.variants).some(v=>v.senses?.includes('inevitable')));
});
test('a source-origin adjective must not suppress its plain-language translation as though it were a name',()=>{
 const stages={parts:{study:{senses:[{id:'s1',gloss:'beyond the senses',usedByAuthor:true}]}},
 sources:{study:{senses:[{sense:'beyond the senses',partOfSpeech:'adjective',inDictionary:false,originalWord:{verified:true,term:'supersensible'}}]}},
 proposal:{entries:[{id:'e1',sourceTerms:['suprasensible'],variants:[{id:'v1',target:'supersensible',senses:[]},{id:'v2',target:'beyond the senses',senses:['beyond perception']}]}]},
 checks:{candidates:[{target:'supersensible',senseId:'s1',verdict:'pass'},{target:'beyond the senses',senseId:'s1',verdict:'pass'}]}};
 const entry={entries:[{id:'e1',sourceTerms:['suprasensible'],variants:[{id:'v1',target:'supersensible',note:''}]}]};
 assert.ok(preserveFullFindings(stages,entry).entries[0].variants.some(v=>v.target==='beyond the senses'));
});
test('compact packet keeps explicit empty kept-scope and populated notes; optional unknown fields are omitted',()=>{
 const packet=consumerGuide({entries:[{id:'e1',kind:'word',sourceTerms:['word'],generalNote:'',variants:[{id:'v1',target:'target',note:'',selectionScope:{kept:[],removed:['sense']},readerNotes:['explanation']}]}]});
 const v=packet.entries[0].variants[0];assert.deepEqual(v.selectionScope,{kept:[],removed:['sense']});assert.deepEqual(v.readerNotes,['explanation']);
 assert.equal('partOfSpeech' in v,false);assert.equal('original' in v,false);assert.equal('sourceMeaningDefinitions' in packet,false);
});
