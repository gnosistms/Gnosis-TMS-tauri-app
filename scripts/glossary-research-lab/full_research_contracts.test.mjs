import test from 'node:test';
import assert from 'node:assert/strict';
import {SAFEGUARDS,retirementGate,auditFrozen,auditSaved} from './full_research_contracts.mjs';
import {createResearchEngine} from './runs/2026-10-12/baseline-snapshot/glossary-research-engine.js';

test('every original step has named acceptance cases, a fault and required proof',()=>{
 assert.equal(SAFEGUARDS.length,20);assert.equal(new Set(SAFEGUARDS.map(s=>s.id)).size,20);
 for(const s of SAFEGUARDS){assert.ok(s.cases.length);assert.ok(s.fault);assert.ok(s.proof);}
});
const contract=SAFEGUARDS.find(s=>s.id==='proposal');
const passed=()=>({cases:Object.fromEntries(contract.cases.map(id=>[id,{criteriaFrozen:true,faultDetected:true,acceptableControlPassed:true,actualOutcome:'pass',reachesConsumer:true}])),noGlossaryComparisonComplete:true,confirmedNewMeaningErrors:0,randomRegressionComplete:true});
test('random wins cannot hide a missing historical or human-criterion case',()=>{const e=passed();delete e.cases['mundo-planet-not-lost'];e.randomNetGains=100;assert.equal(retirementGate(contract,e).status,'blocked');});
test('a test that accepts the injected mistake cannot establish retirement',()=>{const e=passed();e.cases['fatal-six-meanings'].faultDetected=false;assert.match(retirementGate(contract,e).blockers.join('\n'),/intended fault not detected/);});
test('false rejection of an acceptable alternative fails calibration',()=>{const e=passed();e.cases['vanidad-appearance-motive'].acceptableControlPassed=false;assert.equal(retirementGate(contract,e).status,'blocked');});
test('unresolved human judgments, no baseline or consumer loss block retirement',()=>{for(const change of [e=>{e.noGlossaryComparisonComplete=false;},e=>{e.cases['fatal-six-meanings'].reachesConsumer=false;},e=>{e.cases['vanidad-appearance-motive'].needsHumanReview=true;}]){const e=passed();change(e);assert.equal(retirementGate(contract,e).status,'blocked');}assert.equal(retirementGate(contract,passed()).status,'eligible-for-removal-experiment');});

test('real full-engine freeze replay detects lost sense metadata, even when the wording survives',()=>{
 const proposal={entries:[{id:'e1',kind:'word',sourceTerms:['fatal'],generalNote:'Choose by meaning.',variants:[{id:'v1',target:'harmful',note:'For harm.',partOfSpeech:'adjective',senses:['harmful'],corpusSense:'causing harm without requiring death'}]}]};
 const engine=createResearchEngine({settings:{term:'fatal',sourceLanguageCode:'es',targetLanguageCode:'en',seed:'test',spendingLimitUsd:4},store:{load:()=>undefined,save:()=>{}},model:{call:()=>{throw new Error('No model permitted in replay');}},corpus:{},dictionary:{},prices:{input:0,output:0}});
 const frozen=engine.freeze(proposal);const issues=auditFrozen(proposal,frozen);
 assert.ok(frozen.entries[0].variants.some(v=>v.target==='harmful'));
 assert.ok(issues.some(i=>i.kind==='lost-senses'));assert.ok(issues.some(i=>i.kind==='lost-corpusSense'));
 assert.equal(issues.some(i=>i.kind==='lost-partOfSpeech'),false);
 const preserved=structuredClone(frozen);Object.assign(preserved.entries[0].variants[0],{senses:['harmful'],corpusSense:'causing harm without requiring death'});assert.deepEqual(auditFrozen(proposal,preserved),[]);
});
test('footnote and narrowing controls fail when information is only displayed, and pass when serialized',()=>{
 const stages={footnotes:[{target:'afterworlds',note:'Imagined worlds beyond this one.'}],consistency:{narrowed:[{variantId:'v1',kept:['realm'],removed:['planet']}]}};
 const entry={entries:[{variants:[{id:'v1',target:'afterworlds',note:'Use by context.'}]}]};
 assert.deepEqual(auditSaved(stages,entry).map(i=>i.kind),['lost-reader-note','scope-change-not-serialized']);
 entry.entries[0].variants[0].readerNote=stages.footnotes[0].note;entry.entries[0].variants[0].selectionScope={kept:['realm'],removed:['planet']};assert.deepEqual(auditSaved(stages,entry),[]);
});
