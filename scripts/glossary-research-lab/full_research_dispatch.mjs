/** Appended to the frozen lab prefix. Full engine sequence remains intact. */
import {preserveFullFindings,consumerGuide} from './full_carrythrough.mjs';
import {gradeEffect,confirmedEffect} from './efficient_design.mjs';
const language=arg('language','vi'),phase=command,method=arg('method','full-preserved');
const indices=arg('indices','').split(',').filter(Boolean).map(Number);
const originalModules=modules;
modules=async()=>{const [engine,...rest]=await originalModules();return [{...engine,createResearchEngine:deps=>engine.createResearchEngine({...deps,settings:{...deps.settings,researchProcedure:'full',targetLanguageCode:language,targetLanguageName:language==='en'?'English':'Vietnamese'}})},...rest];};
const criteria=read(`${run}/assessment-only/criteria.json`);
const schema=object({items:array(object({id:string,accuracyA:{type:'string',enum:['faithful','material_error','uncertain']},accuracyB:{type:'string',enum:['faithful','material_error','uncertain']},
 policyA:{type:'string',enum:['pass','fail','not_applicable','uncertain']},policyB:{type:'string',enum:['pass','fail','not_applicable','uncertain']},
 naturalnessA:{type:'string',enum:['natural','clear_problem','uncertain']},naturalnessB:{type:'string',enum:['natural','clear_problem','uncertain']},
 renderingA:string,renderingB:string,criterionIds:array(string),reason:string}))});
const rubric=`Apply the frozen human/inferred criteria to the actual researched occurrences. You do not define new success criteria. No research, method identities, previous grades or expected answers are shown. Grade each translation independently. Faithful means same source ideas; material_error requires an actual wrong sense, lost defining condition, substantive invention or erasure. Acceptable alternatives and debatable readings cannot earn a winner. Project preferred terminology, canonical spelling and ordinary-reader wording are policy requirements: an understandable translation may fail policy without a semantic error. Naturalness clear_problem requires visibly unidiomatic, broken or confusing prose, not preference. Ignore unrelated draft errors or changes; assess only the researched occurrence and necessary grammar. Do not judge the author's beliefs. Quote the actual target rendering, not an unrelated matching word. Return the applicable supplied criterion ids only (empty if no specific criterion applies). Identical bad translations both remain errors and earn no gain; identical good and acceptable alternatives tie. If human evidence is insufficient, grade uncertain. Explain concretely.`;
const originalCall=call;
call=async(request,dir,role='research')=>originalCall(language==='en'?{...request,instructions:request.instructions.replaceAll('Vietnamese','English')}:request,dir,role);
const d=index=>`${run}/terms/${String(index).padStart(2,'0')}`;
async function fullResearch(index){await research(index,'baseline');}
function compile(index){
 const dir=d(index),base=read(`${dir}/baseline/entry.json`);if(!base)throw new Error('Full baseline not ready');
 const stages={};for(const f of fs.readdirSync(`${dir}/baseline/stages`).filter(f=>f.endsWith('.json')))stages[f.slice(0,-5)]=read(`${dir}/baseline/stages/${f}`);
 const preserved=preserveFullFindings(stages,base);write(`${dir}/full-preserved/entry.json`,consumerGuide(preserved));write(`${dir}/full-preserved/preservation.json`,preserved.preservation);
 write(`${dir}/full-original/entry.json`,consumerGuide(base));
}
async function draft(index){
 const dir=d(index),e=read(`${dir}/evidence.json`),out=`${dir}/no-glossary.json`;
 const existing=read(out)??[],known=new Map(existing.map(p=>[p.id,p]));
 const missing=e.evaluation.filter(p=>!known.has(String(p.itemId)));
 if(!missing.length){checkIds(existing,e.evaluation.map(p=>String(p.itemId)));return existing;}
 for(let at=0;at<missing.length;at+=10){
  const passages=missing.slice(at,at+10).map(p=>({id:String(p.itemId),text:p.text}));
  const rows=JSON.parse((await call({term:e.term,method:'no-glossary',stage:'neutral',purpose:'translate without glossary or research',effort:'low',schema:translationSchema,instructions:`Translate these full Spanish passages accurately and naturally into ${language==='en'?'English':'Vietnamese'}. Preserve all source content and distinctions. No glossary or research is provided. No explanations. Every id once.`,content:JSON.stringify({passages})},`${dir}/neutral-calls`,'evaluation')).text).items;
  checkIds(rows,passages.map(p=>p.id));for(const row of rows)known.set(row.id,row);
 }
 const rows=e.evaluation.map(p=>known.get(String(p.itemId)));checkIds(rows,e.evaluation.map(p=>String(p.itemId)));write(out,rows);return rows;
}
async function translation(index){
 const dir=d(index),e=read(`${dir}/evidence.json`),guide=read(`${dir}/${method}/entry.json`),out=`${dir}/${method}/translations.json`;
 if(read(out))return read(out);if(!guide)throw new Error('Final glossary guide not ready');
 const base=await draft(index),b=new Map(base.map(p=>[p.id,p.translation])),rows=[];
 for(let at=0;at<e.evaluation.length;at+=10){
  const passages=e.evaluation.slice(at,at+10).map(p=>({id:String(p.itemId),source:p.text,occurrences:p.occurrences,draft:b.get(String(p.itemId))}));
  const answer=JSON.parse((await call({term:e.term,method,stage:'apply',purpose:'apply the final full-procedure glossary to the exact neutral draft',effort:'low',schema:translationSchema,
   instructions:`Apply this glossary to the researched occurrences in the ${language==='en'?'English':'Vietnamese'} drafts using the Spanish meaning and grammar. Change only the researched wording and necessary grammar; retain unrelated draft wording exactly. Source-meaning definitions explain the meaning, sourceSenseIds refer to those definitions, and selectionScope restricts a choice to kept meanings and excludes removed meanings. Verified designations remain names rather than definitions. Use guidance conditionally: a proposed subtype must fit the source category's actual members; do not force a separate literal word into an idiomatic expression. Reader notes are separate first-occurrence explanations; do not insert them into the source passage as new content. Missing metadata is not permission to invent it. Return each full passage and id once.`,content:JSON.stringify({term:e.term,guide,passages})},`${dir}/${method}/translation-calls`,'evaluation')).text).items;
  checkIds(answer,passages.map(p=>p.id));rows.push(...answer);
 }
 write(out,rows);return rows;
}
function rules(term){return criteria[term]?.[language]??{origin:'generic regression criterion',rules:'Preserve every source meaning, lexical contrast and named concept. Do not invent facts or initials. No project target wording prescribed.'};}
async function assessPackets(term,packets,dir,stage){
 const rows=[];
 for(let at=0;at<packets.length;at+=10){
  const batch=packets.slice(at,at+10),answer=JSON.parse((await call({term,method,stage,purpose:'blind application of frozen criteria',effort:'medium',schema,instructions:rubric,
   content:JSON.stringify(batch)},dir,'judge')).text).items;
  checkIds(answer,batch.map(p=>p.id));rows.push(...answer);
 }
 return rows;
}
async function assessFull(index){
 const dir=d(index),e=read(`${dir}/evidence.json`),out=`${dir}/${method}/judgments.json`;if(read(out))return read(out);
 const base=await draft(index),candidate=await translation(index),b=new Map(base.map(p=>[p.id,p.translation])),c=new Map(candidate.map(p=>[p.id,p.translation]));
 const pairs=e.evaluation.map(p=>blindPair({id:String(p.itemId),text:p.text},b.get(String(p.itemId)),c.get(String(p.itemId)),`${manifest.seed}:${language}:${method}:${index}`));
 const packets=pairs.map(pair=>({...pair.public,term:e.term,language,criteria:rules(e.term),occurrences:e.evaluation.find(p=>String(p.itemId)===pair.public.id).occurrences}));
 const answer=await assessPackets(e.term,packets,`${dir}/${method}/judge-calls`,'blind-assessment');
 const rows=answer.map(r=>({...r,candidateSide:pairs.find(p=>p.public.id===r.id).candidateSide}));write(out,rows);return rows;
}
async function confirm(index){
 const dir=d(index),e=read(`${dir}/evidence.json`),out=`${dir}/${method}/confirmed.json`;if(read(out))return;
 const first=await assessFull(index),selected=first.filter(r=>['accuracy','policy','naturalness'].some(dim=>gradeEffect(r,dim)));
 const b=new Map(read(`${dir}/no-glossary.json`).map(p=>[p.id,p.translation])),c=new Map(read(`${dir}/${method}/translations.json`).map(p=>[p.id,p.translation]));
 const pairs=selected.map(r=>blindPair({id:r.id,text:e.evaluation.find(p=>String(p.itemId)===r.id).text},b.get(r.id),c.get(r.id),`${manifest.seed}:second:${language}:${method}:${index}`));
 const answer=await assessPackets(e.term,pairs.map(pair=>({...pair.public,term:e.term,language,criteria:rules(e.term),occurrences:e.evaluation.find(p=>String(p.itemId)===pair.public.id).occurrences})),`${dir}/${method}/confirm-calls`,'blind-confirmation');
 const seconds=new Map(answer.map(r=>[r.id,{...r,candidateSide:pairs.find(p=>p.public.id===r.id).candidateSide}]));
 write(out,first.map(r=>({id:r.id,first:r,second:seconds.get(r.id)??null,effects:Object.fromEntries(['accuracy','policy','naturalness'].map(dim=>[dim,confirmedEffect(r,seconds.get(r.id),dim)]))})));
}
async function calibrate(){
 const controls=read(`${run}/assessment-only/domain-controls.json`),dest=`${run}/calibration`,packets=controls.map(c=>c.packet);
 const rows=await assessPackets('domain-calibration',packets,`${dest}/calls`,'domain-mutation-control');
 write(`${dest}/judgments.json`,rows);
 const failures=[];
 for(const control of controls){const row=rows.find(r=>r.id===control.packet.id);for(const [field,expected] of Object.entries(control.expected))if(row[field]!==expected)failures.push({id:row.id,case:control.case,field,expected,actual:row[field],reason:row.reason});}
 write(`${dest}/result.json`,{presentations:rows.length,passed:failures.length===0,failures,limitation:'Manual expected judgments follow the recorded human criteria; unresolved domain judgments require human review. Calibration is not a glossary quality result.'});
 if(failures.length)throw new Error(`Domain evaluator failed ${failures.length} expected checks; optimization acceptance is blocked`);
}
try{
 if(phase==='compile'){for(const index of indices.length?indices:manifest.terms.map((_,i)=>i+1))compile(index);}
 else{
  const auth=spawnSync('codex',['login','status'],{encoding:'utf8'});if(!`${auth.stdout}${auth.stderr}`.includes('Logged in using ChatGPT'))throw new Error('Subscription authentication required');
  if(phase==='calibrate')await calibrate();
  else{
   if(['evaluate','confirm'].includes(phase)&&read(`${run}/calibration/result.json`)?.passed!==true)throw new Error('Domain fault-sensitivity controls must pass before quality assessment');
   if(phase==='research')startWorker();
   await concurrent(indices.length?indices:manifest.terms.map((_,i)=>i+1),async index=>{
    if(phase==='research')await fullResearch(index);else if(phase==='neutral')await draft(index);else if(phase==='translate')await translation(index);
    else if(phase==='evaluate')await assessFull(index);else if(phase==='confirm')await confirm(index);else throw new Error('Unknown phase');
   });
  }
 }
}finally{if(worker)worker.stdin.end();}
