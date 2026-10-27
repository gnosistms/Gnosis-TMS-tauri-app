import test from 'node:test';import assert from 'node:assert/strict';
import {agreeMappings,agreeClassifications,verifyBoundTranslation,eligiblePassages} from './meaning_binding.mjs';
const passages=[{itemId:'p',occurrences:[{start:0,end:5}]}],selections=[{id:'p',occurrenceIndex:0,senseId:'physical'}],bindings=[{senseId:'physical',targetId:'binding:physical',acceptedForms:['planet','planets']}];
const output=()=>[{id:'p',segments:[{text:'That ',occurrenceIndex:-1,senseId:'',targetId:''},{text:'planet',occurrenceIndex:0,senseId:'physical',targetId:'binding:physical'},{text:' is inhabited.',occurrenceIndex:-1,senseId:'',targetId:''}]}];
test('mechanical check accepts approved inflection and preserves the full rendered passage',()=>{const rows=output();rows[0].segments[1].text='planets';const v=verifyBoundTranslation(rows,passages,selections,bindings);assert.equal(v.passed,true);assert.equal(v.translations[0].translation,'That planets is inhabited.');assert.match(v.scope,/Does not certify/);});
test('a wrong literal rendering fails even when the model claims the correct meaning/target id',()=>{const rows=output();rows[0].segments[1].text='world';assert.ok(verifyBoundTranslation(rows,passages,selections,bindings).errors.some(e=>e.kind==='wrong_rendering'));});
test('missing and duplicate occurrences fail independently of word choice',()=>{let rows=output();rows[0].segments.splice(1,1);assert.ok(verifyBoundTranslation(rows,passages,selections,bindings).errors.some(e=>e.kind==='occurrence_coverage'));rows=output();rows[0].segments.push({...rows[0].segments[1]});assert.ok(verifyBoundTranslation(rows,passages,selections,bindings).errors.some(e=>e.kind==='occurrence_coverage'));});
test('a wrong source meaning or target identity fails even when the preferred word is present',()=>{const rows=output();rows[0].segments[1].senseId='realm';assert.ok(verifyBoundTranslation(rows,passages,selections,bindings).errors.some(e=>e.kind==='wrong_identity'));});
test('disputed preference cannot silently become a mandatory binding',()=>{const a={meanings:[{senseId:'x',preferredEnglish:'planet',acceptedForms:['planet'],status:'preferred'}]},b={meanings:[{senseId:'x',preferredEnglish:'world',acceptedForms:['world'],status:'preferred'}]};assert.equal(agreeMappings(a,b).bindings.length,0);b.meanings[0]={...a.meanings[0],status:'equivalent_alternatives'};assert.equal(agreeMappings(a,b).bindings.length,0);});
test('classification disagreements and unknowns remain unresolved',()=>{const a={items:[{id:'p',occurrences:[{occurrenceIndex:0,selectedSenseId:'physical',certainty:'clear'}]}]},b=structuredClone(a);b.items[0].occurrences[0].selectedSenseId='realm';assert.equal(agreeClassifications(a,b,passages).selected.length,0);assert.equal(agreeClassifications(a,a,passages).selected.length,1);});
test('two occurrences with one broad meaning retain different independently preferred bindings',()=>{
 const source=[{itemId:'p',occurrences:[{},{}]}],selected=[{id:'p',occurrenceIndex:0,senseId:'body',preferredTargetId:'precise'},{id:'p',occurrenceIndex:1,senseId:'body',preferredTargetId:'geographic'}],choices=[{senseId:'body',targetId:'precise',acceptedForms:['planet']},{senseId:'body',targetId:'geographic',acceptedForms:['world']}];
 const rows=[{id:'p',segments:[{text:'planet',occurrenceIndex:0,senseId:'body',targetId:'precise'},{text:'world',occurrenceIndex:1,senseId:'body',targetId:'geographic'}]}];
 assert.equal(verifyBoundTranslation(rows,source,selected,choices).passed,true);
 rows[0].segments[0]={text:'world',occurrenceIndex:0,senseId:'body',targetId:'geographic'};
 const errors=verifyBoundTranslation(rows,source,selected,choices).errors;
 assert.ok(errors.some(e=>e.kind==='wrong_identity'));assert.ok(errors.some(e=>e.kind==='wrong_rendering'));
});
test('a disputed occurrence cannot borrow another occurrences preferred target through a broad-meaning fallback',()=>{
 const source=[{itemId:'agreed',occurrences:[{}]},{itemId:'disputed',occurrences:[{}]}],selected=[{id:'agreed',occurrenceIndex:0,senseId:'body',preferredTargetId:'specific'},{id:'disputed',occurrenceIndex:0,senseId:'body'}],choices=[{senseId:'body',targetId:'specific',acceptedForms:['planet']}];
 assert.deepEqual(eligiblePassages(source,selected,choices,true).map(p=>p.itemId),['agreed']);
 assert.equal(eligiblePassages(source,selected,choices,false).length,2);
});
