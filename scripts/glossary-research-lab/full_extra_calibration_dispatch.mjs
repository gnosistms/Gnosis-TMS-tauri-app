const extraCalibration=`${run}/extra-calibration`,extraControls=read(`${extraCalibration}/controls.json`),extraRows=[];
const wholeRubric=rubric.replace('Ignore unrelated draft errors or changes; assess only the researched occurrence and necessary grammar.',
 'Assess the entire source passage for material errors introduced by changed wording, including numbers, entities, negation, and omitted content outside the researched word. Do not penalize an unchanged preexisting draft error as a new error. Source facts must be preserved even when you disagree with the author. The researched word and its policy criteria are assessed separately from new errors elsewhere.');
for(const whole of [false,true]){
 const controls=extraControls.filter(c=>c.whole===whole);if(!controls.length)continue;
 const items=JSON.parse((await call({term:'extra-domain-calibration',method:'full-preserved',stage:whole?'whole-passage-mutation-control':'positive-policy-control',purpose:'verify uncovered failure detection before acceptance',effort:'medium',schema,instructions:whole?wholeRubric:rubric,content:JSON.stringify(controls.map(c=>c.packet))},`${extraCalibration}/calls`,'judge')).text).items;
 checkIds(items,controls.map(c=>c.packet.id));extraRows.push(...items);
}
const extraFailures=[];
for(const c of extraControls){const row=extraRows.find(r=>r.id===c.packet.id);for(const [field,expected] of Object.entries(c.expected))if(row[field]!==expected)extraFailures.push({id:row.id,case:c.case,field,expected,actual:row[field],reason:row.reason});}
write(`${extraCalibration}/result.json`,{presentations:extraRows.length,passed:!extraFailures.length,failures:extraFailures,judgments:extraRows});
if(extraFailures.length)throw new Error('Additional fault sensitivity failed; affected conclusions require review');
