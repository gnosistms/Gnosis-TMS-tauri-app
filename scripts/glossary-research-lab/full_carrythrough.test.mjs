import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {preserveFullFindings,consumerGuide} from './full_carrythrough.mjs';
const example=()=>({
 stages:{dictionary:{status:'found'},parts:{study:{senses:[{id:'s1',gloss:'harmful',usedByAuthor:true},{id:'s2',gloss:'inevitable',usedByAuthor:true}]}},
  proposal:{entries:[{id:'e1',kind:'word',sourceTerms:['fatal'],generalNote:'By context.',variants:[{id:'v1',target:'harmful',note:'Harm.',senses:['harm'],corpusSense:'harm without necessary death',partOfSpeech:'adjective'},{id:'v2',target:'inevitable',note:'Unavoidable.',senses:['inevitability'],partOfSpeech:'adjective'}]}]},
  checks:{candidates:[{target:'harmful',senseId:'s1',verdict:'pass'},{target:'inevitable',senseId:'s2',verdict:'pass'}]},aggregate:{entries:{e1:{variants:{v1:{occurrences:99},v2:{occurrences:0}}}}}},
 entry:{entries:[{id:'e1',kind:'word',sourceTerms:['fatal'],generalNote:'By context.',variants:[{id:'v1',target:'harmful',note:'Harm.'}]}]}});
test('detectable fatal mutation: zero count cannot erase the sole checked inevitable branch',()=>{const x=example();const fixed=preserveFullFindings(x.stages,x.entry);assert.ok(!x.entry.entries[0].variants.some(v=>v.target==='inevitable'));assert.ok(consumerGuide(fixed).entries[0].variants.some(v=>v.target==='inevitable'&&v.sourceSenseIds.includes('s2')));assert.equal(fixed.preservation.researchCalls,0);});
test('a failed candidate is never restored just to fill an inventory',()=>{const x=example();x.stages.checks.candidates[1].verdict='fail';const fixed=preserveFullFindings(x.stages,x.entry);assert.equal(fixed.entries[0].variants.some(v=>v.target==='inevitable'),false);assert.ok(fixed.preservation.unresolved.some(r=>r.senseId==='s2'));});
test('a retained documented synonym satisfies its meaning without resurrecting every discarded option',()=>{const x=example();x.stages.checks.candidates.push({target:'unavoidable',senseId:'s2',verdict:'pass'});const synonym={id:'v3',target:'unavoidable',note:'Cannot be avoided.',senses:['inevitability']};x.stages.proposal.entries[0].variants.push(synonym);x.entry.entries[0].variants.push(synonym);const fixed=preserveFullFindings(x.stages,x.entry);assert.equal(fixed.entries[0].variants.some(v=>v.target==='inevitable'),false);});
test('sense definitions survive once in the consumer rather than only in research metadata',()=>{const x=example(),packet=consumerGuide(preserveFullFindings(x.stages,x.entry));assert.ok(packet.sourceMeaningDefinitions.some(m=>m.id==='s2'&&m.definition==='inevitable'));assert.equal(JSON.stringify(packet).includes('preservation'),false);});
test('scope restriction is carried into the actual consumer and does not drop another meaning',()=>{const x=example();x.stages.consistency={narrowed:[{variantId:'v1',kept:['harm'],removed:['death']}]};const packet=consumerGuide(preserveFullFindings(x.stages,x.entry));assert.deepEqual(packet.entries[0].variants.find(v=>v.id==='v1').selectionScope,{kept:['harm'],removed:['death']});assert.ok(packet.entries[0].variants.some(v=>v.id==='v2'));});
test('reader note mutation fails in the original packet and is repaired in the consuming packet',()=>{const x=example();x.stages.footnotes=[{target:'harmful',note:'Meaning in this technical tradition.'}];assert.deepEqual(consumerGuide(x.entry).entries[0].variants[0].readerNotes,[]);const packet=consumerGuide(preserveFullFindings(x.stages,x.entry));assert.deepEqual(packet.entries[0].variants[0].readerNotes,['Meaning in this technical tradition.']);});
test('real fatal record: retained coarse fate/compulsion branch does not hide lost inevitability',()=>{
 const dir=new URL('./runs/2026-10-12-focused/terms/02/baseline-human/',import.meta.url);
 const stages={};for(const name of fs.readdirSync(new URL('stages/',dir)).filter(n=>n.endsWith('.json')))stages[name.slice(0,-5)]=JSON.parse(fs.readFileSync(new URL('stages/'+name,dir)));
 const original=JSON.parse(fs.readFileSync(new URL('entry.json',dir)));
 const proposed=(stages.confirmedProposal??stages.proposal).entries.flatMap(e=>e.variants).filter(v=>v.senses?.includes('inevitable'));
 assert.ok(proposed.length);assert.equal(original.entries.flatMap(e=>e.variants).some(v=>proposed.some(p=>p.id===v.id)),false);
 const fixed=preserveFullFindings(stages,original),guide=consumerGuide(fixed);
 assert.ok(guide.entries.flatMap(e=>e.variants).some(v=>v.meaningLabels.includes('inevitable')));
 assert.ok(fixed.preservation.changes.some(c=>c.kind==='restored-sole-operational-meaning'&&c.meaning==='inevitable'));
});
test('preservation must not undo a form split by copying headword targets into every sibling',()=>{
 const x=example();x.stages.proposal.entries[0].sourceTerms=['form','forms'];x.entry.entries=[{...x.entry.entries[0],id:'e1~1',sourceTerms:['form']},{...structuredClone(x.entry.entries[0]),id:'e1~2',sourceTerms:['forms']}];
 const fixed=preserveFullFindings(x.stages,x.entry);assert.ok(fixed.entries.find(e=>e.id==='e1~1').variants.some(v=>v.target==='inevitable'));
 assert.equal(fixed.entries.find(e=>e.id==='e1~2').variants.some(v=>v.target==='inevitable'),false);assert.ok(fixed.preservation.unresolved.some(r=>r.entryId==='e1~2'&&/Split-form/.test(r.reason)));
});
