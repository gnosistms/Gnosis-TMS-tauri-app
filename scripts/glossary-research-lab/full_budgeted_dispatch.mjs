import {preserveFullFindings as preserveBudgeted,consumerGuide as budgetedGuide} from './full_carrythrough_v2.mjs';
const rawBudgeted='full-budgeted-raw',beforeBudgetedCall=call;
const candidateBudget=`Use one primary rendering per distinct operational meaning. Another rendering is allowed only when a specific source context needs a materially different wording or the primary cannot express an attested collocation naturally; explain that context in the note. Different spellings, styles, and merely synonymous wording do not need separate groups. Preserve every evidenced dictionary/corpus meaning and every applicable supplied human requirement, including rare meanings. A cap on synonyms is not a cap on meanings. Keep a verified technical designation as a name; put its definition in guidance, not in place of the name. Keep source forms together when they share meanings; a plural or attached pronoun alone does not justify a separate entry. Where a form has an extra meaning, limit that meaning's note to the appropriate use rather than forbidding the shared meanings for that form. Supplied requirements are declared inputs, not new discoveries: distinguish explicit human criteria from inferred historical criteria, and report an unresolved evidence conflict rather than hiding it.`;
call=async(request,dir,role='research')=>{
 if(request.method===rawBudgeted){
  const requirement=criteria[request.term]?.[language];
  if(request.stage==='candidates')request={...request,instructions:request.instructions.replace(/- One rendering per group,[^\n]*/u,'- '+candidateBudget)};
  if(request.stage==='proposal')request={...request,instructions:request.instructions.replace(/- VARIANTS\.[^\n]*/u,'- VARIANTS. '+candidateBudget)};
  if(['candidates','proposal'].includes(request.stage)&&requirement)request={...request,content:request.content+'\n\n## Supplied project requirements (apply to supported source meanings)\n'+JSON.stringify(requirement)};
  if(['counting','consistency'].includes(request.stage))request={...request,instructions:request.instructions+'\nA grammatical adaptation of a listed rendering still selects that variant when it retains its lexical meaning. Use other only for a genuinely different lexical rendering or a meaning the entry cannot cover. Do not force an incompatible rendering into the sentence.'};
 }
 return beforeBudgetedCall(request,dir,role);
};
async function researchBudgeted(index){
 const dir=d(index),preconditions=['dictionary','forms','family','familyChoice','sample','sources','parts'];
 const available=preconditions.every(n=>read(`${dir}/baseline/stages/${n}.json`));
 if(available&&!read(`${dir}/${rawBudgeted}/stages/candidates.json`)){
  fs.mkdirSync(`${dir}/${rawBudgeted}/stages`,{recursive:true});
  for(const name of preconditions)if(!read(`${dir}/${rawBudgeted}/stages/${name}.json`))write(`${dir}/${rawBudgeted}/stages/${name}.json`,read(`${dir}/baseline/stages/${name}.json`));
  write(`${dir}/${rawBudgeted}/reuse.json`,{parent:'baseline',stages:preconditions,reason:'Same full engine, word, language, corpus, seed and independent source-only tasks. Target requirements begin after these stages. Inherited work must be included in effective cost.',throughPartModifiedAt:fs.statSync(`${dir}/baseline/stages/parts.json`).mtime.toISOString()});
 }
 await research(index,rawBudgeted);
}
function compileBudgeted(index){
 const dir=d(index),entry=read(`${dir}/${rawBudgeted}/entry.json`);if(!entry)throw new Error('Budgeted full research not ready');
 const stages={};for(const name of fs.readdirSync(`${dir}/${rawBudgeted}/stages`).filter(n=>n.endsWith('.json')))stages[name.slice(0,-5)]=read(`${dir}/${rawBudgeted}/stages/${name}`);
 const fixed=preserveBudgeted(stages,entry),guide=budgetedGuide(fixed);
 if(criteria[read(`${dir}/evidence.json`).term]?.[language])guide.humanRequirements=criteria[read(`${dir}/evidence.json`).term][language];
 write(`${dir}/${method}/entry.json`,guide);write(`${dir}/${method}/preservation.json`,fixed.preservation);
 write(`${dir}/${method}/input-freeze.json`,{rawEntry:hash(entry),stages:hash(stages),humanRequirementsAreInputs:!!guide.humanRequirements});
}
if(phase==='compile'){for(const index of indices.length?indices:manifest.terms.map((_,i)=>i+1))compileBudgeted(index);}
else{
 const auth=spawnSync('codex',['login','status'],{encoding:'utf8'});if(!`${auth.stdout}${auth.stderr}`.includes('Logged in using ChatGPT'))throw new Error('Subscription authentication required');
 if(['evaluate','confirm'].includes(phase)&&(read(`${run}/calibration/result.json`)?.passed!==true||read(`${run}/extra-calibration/result.json`)?.passed!==true))throw new Error('Both calibrated fault checks required');
 if(phase==='research')startWorker();
 try{await concurrent(indices.length?indices:manifest.terms.map((_,i)=>i+1),async index=>{
  if(phase==='research')await researchBudgeted(index);else if(phase==='translate')await translation(index);else if(phase==='evaluate')await assessFull(index);else if(phase==='confirm')await confirm(index);else throw new Error('Unknown phase');
 });}finally{if(worker)worker.stdin.end();}
}
