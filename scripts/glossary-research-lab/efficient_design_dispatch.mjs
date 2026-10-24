// Appended to a verified frozen lab prefix; use the existing subscription-only call runner.
import * as design from './efficient_design.mjs';
const phase=command,method=arg('method','lexical'),languages=arg('languages','').split(',').filter(Boolean);
const indices=arg('indices','').split(',').filter(Boolean).map(Number);
const aschema=object({items:array(object({id:string,meaningSpanish:string,
 accuracyA:{type:'string',enum:['faithful','material_error','uncertain']},accuracyB:{type:'string',enum:['faithful','material_error','uncertain']},
 policyA:{type:'string',enum:['pass','fail','not_applicable','uncertain']},policyB:{type:'string',enum:['pass','fail','not_applicable','uncertain']},
 naturalnessA:{type:'string',enum:['natural','clear_problem','uncertain']},naturalnessB:{type:'string',enum:['natural','clear_problem','uncertain']},
 reason:string}))});
const rubric=`Independently assess randomized Spanish-source translations into the requested language. You see no research, glossary, method identity or previous verdict. Assess only the researched term and necessary grammatical adjustments; unrelated errors cannot earn gains. Accuracy faithful means the same source ideas and distinctions; material_error requires a concrete wrong sense, erasure, invention, substantive addition/omission. Acceptable synonyms, small nuances, debatable meanings and uncertain interpretation cannot earn a preference. Do not assess whether the author's beliefs are true. Human criteria supplied below take precedence over generic model lexical preference, but apply only to the actual meaning/grammar of the marked term here. Grade project terminology/spelling adherence separately as policy: understandable broad wording can fail an explicit preferred-term rule while remaining semantically faithful. Conversely a broadly related word that omits an explicitly required defining psychological trait can be a semantic error. Judge the actual term rendering, not an unrelated matching word elsewhere. Ordinary adjective criteria do not apply to technical noun occurrences or vice versa. Naturalness clear_problem requires visibly broken, confusing or unidiomatic wording, not minor stylistic preferences. Give a specific reason naming actual renderings. Return every id once.`;
const outcome=design.gradeEffect;
const loc=index=>`${run}/terms/${String(index).padStart(2,'0')}`;
const readCriteria=()=>read(`${run}/assessment-only/criteria.json`);
async function proposeContract(index){
 const dir=loc(index),e=read(`${dir}/evidence.json`),input=read(`${dir}/source-only/input.json`);
 if(read(`${dir}/contract.json`))return;
 if(!input.coverage.available){write(`${dir}/contract.json`,{meanings:[],preferenceSpanish:'',provenanceSpanish:'',uncertainties:['No independent corpus research evidence'],status:'no-texts'});return;}
 const result=await call({term:e.term,method:design.DESIGN.version,stage:'one-integrated-proposal',purpose:'infer operational meanings, scoped wording and verified names in one artifact',effort:'medium',schema:design.SCHEMA,instructions:design.INSTRUCTIONS,content:JSON.stringify(input)},`${dir}/research-calls`,'research');
 const answer=JSON.parse(result.text);design.validateContract(answer,input);write(`${dir}/contract.json`,answer);
}
async function neutral(index,language){
 const dir=loc(index),e=read(`${dir}/evidence.json`),out=`${dir}/${language}/no-glossary.json`;
 if(read(out))return read(out);
 const rows=[];
 for(let at=0;at<e.evaluation.length;at+=10){
  const passages=e.evaluation.slice(at,at+10).map(p=>({id:String(p.itemId),text:p.text}));
  const answer=JSON.parse((await call({term:e.term,method:'no-glossary',stage:'neutral-'+language,purpose:'translate source without research or glossary',effort:'low',schema:translationSchema,
   instructions:`Translate each full Spanish passage into accurate natural ${language==='en'?'English':'Vietnamese'}. Preserve all content and distinctions without adding explanations. No glossary or research is supplied. Return every id exactly once.`,content:JSON.stringify({passages})},`${dir}/${language}/neutral-calls`,'evaluation')).text).items;
  checkIds(answer,passages.map(p=>p.id));rows.push(...answer);
 }
 write(out,rows);return rows;
}
async function translation(index,language){
 const dir=loc(index),e=read(`${dir}/evidence.json`),dest=`${dir}/${language}/${method}`,out=`${dest}/translations.json`;
 if(read(out))return read(out);
 const answer=read(`${dir}/contract.json`);if(!answer)throw new Error('Research contract is not ready');if(!answer.meanings.length){write(out,[]);return [];}
 const glossary=design.project(answer,language,method);write(`${dest}/entry.json`,glossary);
 const base=await neutral(index,language),byId=new Map(base.map(p=>[p.id,p.translation])),rows=[];
 for(let at=0;at<e.evaluation.length;at+=10){
  const batch=e.evaluation.slice(at,at+10).map(p=>({id:String(p.itemId),source:p.text,draft:byId.get(String(p.itemId))}));
  const result=JSON.parse((await call({term:e.term,method,stage:'apply-'+language,purpose:'apply the same inferred meanings to exact neutral drafts',effort:'low',schema:translationSchema,
   instructions:`Apply the terminology guide to the shared ${language==='en'?'English':'Vietnamese'} drafts, determining each researched occurrence's actual Spanish meaning and grammar first. Meaning cards explain source usage; use concise natural target wording that communicates their defining condition, even if a candidate word is too broad. Verified names remain names, not definitions or nearby equivalent concepts. Apply preferred meanings only while coherent with every relevant source member; broader source categories and whole-expression idioms retain suitable alternatives. A glossary is guidance, not a command to insert a separate word mechanically. Dictionary-only branches apply only to ordinary uses. Change only this researched term and necessary grammar; preserve all unrelated wording exactly. Do not add research explanations to sentences. Return full passages, every id exactly once.`,
   content:JSON.stringify({term:e.term,guide:glossary,passages:batch})},`${dest}/translation-calls`,'evaluation')).text).items;
  checkIds(result,batch.map(p=>p.id));rows.push(...result);
 }
 write(out,rows);return rows;
}
async function assess(index,language){
 const dir=loc(index),e=read(`${dir}/evidence.json`),dest=`${dir}/${language}/${method}`,out=`${dest}/judgments.json`;
 if(read(out))return;
 const base=await neutral(index,language),candidate=await translation(index,language);if(!candidate.length||!e.evaluation.length){write(out,[]);return;}
 const b=new Map(base.map(p=>[p.id,p.translation])),c=new Map(candidate.map(p=>[p.id,p.translation]));
 const pairs=e.evaluation.map(p=>blindPair({id:String(p.itemId),text:p.text},b.get(String(p.itemId)),c.get(String(p.itemId)),`${manifest.seed}:${index}:${language}:${method}`));
 const criteria=readCriteria()[e.term]?.[language]??{origin:'generic',rules:'Preserve every meaning, grammatical category, named concept and lexical distinction the source expresses. Do not invent expansions of initials or replace a name with a related concept. No specific project wording is prescribed.'};
 const rows=[];
 for(let at=0;at<pairs.length;at+=10){
  const batch=pairs.slice(at,at+10),answer=JSON.parse((await call({term:e.term,method,stage:'blind-'+language,purpose:'absolute accuracy, policy and naturalness grades with method identity hidden',effort:'medium',schema:aschema,instructions:rubric,
   content:JSON.stringify({term:e.term,targetLanguage:language,criteria,passages:batch.map(p=>p.public)})},`${dest}/judge-calls`,'judge')).text).items;
  checkIds(answer,batch.map(p=>p.public.id));rows.push(...answer.map(r=>({...r,candidateSide:batch.find(p=>p.public.id===r.id).candidateSide})));
 }
 write(out,rows);
}
async function confirm(index,language){
 const dir=loc(index),e=read(`${dir}/evidence.json`),dest=`${dir}/${language}/${method}`,out=`${dest}/confirmed.json`;
 if(read(out))return;await assess(index,language);
 const first=read(`${dest}/judgments.json`),selected=first.filter(r=>['accuracy','policy','naturalness'].some(d=>outcome(r,d)));
 const b=new Map((read(`${dir}/${language}/no-glossary.json`)??[]).map(p=>[p.id,p.translation])),c=new Map((read(`${dest}/translations.json`)??[]).map(p=>[p.id,p.translation]));
 const seconds=new Map(),criteria=readCriteria()[e.term]?.[language]??{origin:'generic',rules:'Preserve source meanings, grammar and lexical/name distinctions. No project target wording prescribed.'};
 for(let at=0;at<selected.length;at+=10){
  const pairs=selected.slice(at,at+10).map(r=>blindPair({id:r.id,text:e.evaluation.find(p=>String(p.itemId)===r.id).text},b.get(r.id),c.get(r.id),`${manifest.seed}:confirm:${index}:${language}:${method}`));
  const answer=JSON.parse((await call({term:e.term,method,stage:'confirm-'+language,purpose:'fresh blind confirmation of every claimed gain or harm',effort:'medium',schema:aschema,instructions:rubric,
   content:JSON.stringify({term:e.term,targetLanguage:language,criteria,passages:pairs.map(p=>p.public)})},`${dest}/confirm-calls`,'judge')).text).items;
  checkIds(answer,pairs.map(p=>p.public.id));for(const r of answer)seconds.set(r.id,{...r,candidateSide:pairs.find(p=>p.public.id===r.id).candidateSide});
 }
 write(out,first.map(r=>({id:r.id,first:r,second:seconds.get(r.id)??null,effects:Object.fromEntries(['accuracy','policy','naturalness'].map(d=>[d,design.confirmedEffect(r,seconds.get(r.id),d)]))})));
}
async function auditContract(index,language){
 const dir=loc(index),e=read(`${dir}/evidence.json`),out=`${dir}/${language}/entry-audit.json`,criteria=readCriteria()[e.term]?.[language];
 if(!criteria||read(out))return;
 const schema=object({checks:array(object({criterion:string,status:{type:'string',enum:['pass','partial','fail','uncertain']},evidence:string})),risks:array(string)});
 const answer=JSON.parse((await call({term:e.term,method:design.DESIGN.version,stage:'entry-audit-'+language,purpose:'assessment-only required-meaning and provenance audit',effort:'medium',schema,
  instructions:'Independently check whether this research artifact provides every supplied meaning/grammar/provenance requirement with correct definitions and usable target wording. Treat each criterion separately. A word that loses a required defining condition is not a pass merely because it is broadly related. Criteria are assessment evidence and were withheld from research. Do not rewrite the artifact or excuse missing meanings because this evaluation sample lacks them. Report uncertainty instead of inventing historical evidence.',content:JSON.stringify({term:e.term,language,criteria,artifact:read(`${dir}/contract.json`)})},`${dir}/${language}/audit-calls`,'acceptance-audit')).text);
 write(out,answer);
}
try{
 const auth=spawnSync('codex',['login','status'],{encoding:'utf8'});if(!`${auth.stdout}${auth.stderr}`.includes('Logged in using ChatGPT'))throw new Error('Subscription authentication required');
 await concurrent(indices.length?indices:manifest.terms.map((_,i)=>i+1),async index=>{
  if(phase==='research'){await proposeContract(index);return;}
  const langs=languages.length?languages:manifest.terms[index-1].languages;
  for(const language of langs){if(phase==='neutral')await neutral(index,language);else if(phase==='audit')await auditContract(index,language);
   else if(phase==='translate')await translation(index,language);else if(phase==='evaluate')await assess(index,language);else if(phase==='confirm')await confirm(index,language);else throw new Error('Unknown phase');}
 });
}finally{if(worker)worker.stdin.end();}
