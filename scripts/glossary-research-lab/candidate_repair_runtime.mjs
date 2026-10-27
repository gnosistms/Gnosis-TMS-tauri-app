import {AUDIT_SCHEMA,proposalSchemaFor,bindProposalForms,validateProposal,serializeEntry,consumerHints,translationSchemaFor,validateTranslations,sortByUsage} from './htn_core.mjs';
import {DELIVERY_OBLIGATIONS_SCHEMA,CONTEXTUAL_CANDIDATE_RULES,AUDIT_DELIVERY_RULES,assertCandidateDelivery} from './candidate_contracts.mjs';
const input=read(`${run}/input.json`),record=read(`${run}/source-record.json`),source=read(`${run}/source.json`),phase=arg('phase','build'),integer={type:'integer'};
const auditSchema=structuredClone(AUDIT_SCHEMA);auditSchema.properties.issues.items.properties.kind.enum=auditSchema.properties.issues.items.properties.kind.enum.filter(k=>k!=='human_requirement');auditSchema.properties.deliveryObligations=DELIVERY_OBLIGATIONS_SCHEMA;auditSchema.required.push('deliveryObligations');
async function ask(stage,schema,instructions,content,role='research',effort='medium'){
 const request={term:input.term,method:'candidate-delivery-v2',stage,purpose:stage,schema,instructions,content:JSON.stringify(content),effort};
 write(`${run}/audit/${stage}.json`,{criterionAccess:false,role,keys:Object.keys(content),signature:hash(request)});
 let answer;
 for(let attempt=0;;attempt++)try{answer=await call(request,`${run}/calls/${stage}`,role);break;}catch(e){if(attempt>=2||!/429|Too Many Requests/.test(e.message))throw e;await new Promise(r=>setTimeout(r,[30000,60000][attempt]));}
 const result=JSON.parse(answer.text);write(`${run}/${stage}.json`,result);return result;
}
const witnesses=read(`${run}/witnesses.json`);
function compiled(proposal){
 const bound=bindProposalForms(record.inventory,record.provenance,proposal).proposal;
 validateProposal(input,record.inventory,record.provenance,bound);
 const saved=serializeEntry(input,record.inventory,record.provenance,bound,'en');
 assertCandidateDelivery({proposal:bound,savedByLanguage:{en:saved},obligations:read(`${run}/coverage-audit.json`).deliveryObligations,evidence:input.research});
 return {proposal:bound,saved};
}
const consumerRules=read(`${run}/consumer-rules.json`).rules;
const translationInstructions=`Translate only each complete Spanish source paragraph accurately and naturally into English, using its source neighbors for interpretation. Preserve all content, names, numbers and grammatical relations. Preserve the author's claims. Add no explanations or commentary. Return every id exactly once with its full translation. ${consumerRules}`;
async function translate(arm,rep,plural=false){
 const passages=[...(plural?read(`${run}/plural-regression.json`):source.passages)].sort((a,b)=>hash(`${rep}:${a.itemId}`).localeCompare(hash(`${rep}:${b.itemId}`)));
 const saved=arm==='no-glossary'?null:read(`${run}/${arm==='old-glossary'?'old-glossary':'saved-glossary'}.json`);
 const hints=saved?[...new Map(passages.flatMap(p=>consumerHints(saved,p.text)).map(h=>[h.sourceTerm.toLowerCase(),h])).values()]:[];
 const packet=passages.map(p=>({id:String(p.itemId),text:p.text,contextBefore:p.contextBefore,contextAfter:p.contextAfter}));
 const round=read(`${run}/repair-count.json`)?.round??0,stage=`translate-${arm}-${rep}${arm==='repaired-glossary'?'-round-'+round:''}${plural?'-plural':''}`;
 const answer=await ask(stage,translationSchemaFor(packet),translationInstructions,{passages:packet,glossary_info:hints},'translation','low');validateTranslations(answer.items,packet);
 write(`${run}/translations/${plural?'plural-':''}${arm}-${rep}.json`,answer.items);write(`${run}/translation-freeze/${plural?'plural-':''}${arm}-${rep}.json`,{criterionAccess:false,round,instructions:hash(translationInstructions),sourceOrder:packet.map(p=>p.id),glossary:saved?hash(saved):null});
}
const checkSchema=object({items:array(object({id:string,occurrences:array(object({occurrenceIndex:integer,rendered:string,status:{type:'string',enum:['preferred','acceptable','underused','overapplied','meaning_error','unknown']},reason:string}))})),issues:array(object({id:string,kind:{type:'string',enum:['candidate','note','meaning','unknown']},sourceQuote:string,problem:string})),summary:string});
async function verify(rep){
 const translations=[...read(`${run}/translations/repaired-glossary-${rep}.json`),...(read(`${run}/translations/plural-repaired-glossary-${rep}.json`)??[])],contracts=[...read(`${run}/source-expectations.json`),...(read(`${run}/source-expectations-plural.json`)??[])],round=read(`${run}/repair-count.json`)?.round??0;
 const tested=[...source.passages,...(read(`${run}/translations/plural-repaired-glossary-${rep}.json`)?read(`${run}/plural-regression.json`):[])];
 const packets=tested.map(p=>({id:String(p.itemId),text:p.text,before:p.contextBefore,after:p.contextAfter,occurrences:p.occurrences,sourcePreferences:contracts.filter(c=>c.id===String(p.itemId)),translation:translations.find(t=>t.id===String(p.itemId)).translation}));
 const checked=await ask(`runtime-check-${rep}-round-${round}`,checkSchema,`Check actual term selection against Spanish source and the source-derived preferences. These preferences were independently chosen before seeing any translation or glossary; they are provisional evidence, not human acceptance criteria. When two readings clearly agree on a preferred natural rendering, a broader faithful synonym can still be underused preference. Do not override a clear specific preference just because a broad synonym is understandable. When readings disagree, keep unknown instead of forcing a target. For passages without preferences judge source fidelity and target applicability independently, without inventing mandatory wording. Account for every zero-based source occurrence once and quote its actual rendered span verbatim from translation. Record overapplication, wrong meanings and wrong grammatical number as failures. Match each rendered span to its own source occurrence, not another occurrence of the same word. Return every id once. Any usage issue must quote actual supplied source.`,{entry:read(`${run}/saved-glossary.json`),passages:packets},'verification');
 checkIds(checked.items,packets.map(p=>p.id));
 for(const row of checked.items){const p=packets.find(p=>p.id===row.id);if(row.occurrences.length!==p.occurrences.length||new Set(row.occurrences.map(o=>o.occurrenceIndex)).size!==p.occurrences.length||row.occurrences.some(o=>o.occurrenceIndex<0||o.occurrenceIndex>=p.occurrences.length||!o.rendered.trim()||!p.translation.includes(o.rendered)))throw Error('Runtime check lost an occurrence or invented its rendered text');}
 write(`${run}/runtime-check-${rep}.json`,checked);
}
async function measure(){
 const saved=read(`${run}/unsorted-glossary.json`),term=saved.terms[0],sample=read(`${run}/sample.json`),schema=object({items:array(object({id:string,choices:array(object({occurrenceIndex:integer,variantIndex:integer,certainty:{type:'string',enum:['clear','ambiguous','unknown']},rendering:string}))}))});
 const variants=term.targetTerms.map((target,index)=>({index,target,note:term.targetVariantNotes[index]}));
 const rows=await Promise.all([1,2].map(j=>ask(`frequency-${j}`,schema,`Measure preferred candidate use from source. For each zero-based occurrence choose the applicable most natural candidate, respecting its contextual preference note; its original index is stable even though display order is arbitrary. Prefer a justified precise candidate to a broad fallback. Do not force narrower wording when category members or context exclude it. If none fits use -1 and unknown. Return every id and occurrence once. This measures use in this sample; zero-count targets remain retained.`,{term:input.term,candidates:[...variants].sort((a,b)=>hash(`${j}:${a.index}`).localeCompare(hash(`${j}:${b.index}`))),generalNote:term.notesToTranslators,passages:sample.map(p=>({id:String(p.itemId),text:p.text,before:p.contextBefore,after:p.contextAfter,occurrences:p.occurrences}))},'measurement')));
 for(const r of rows){checkIds(r.items,sample.map(p=>String(p.itemId)));for(const p of sample){const row=r.items.find(t=>t.id===String(p.itemId));if(row.choices.length!==p.occurrences.length||new Set(row.choices.map(c=>c.occurrenceIndex)).size!==p.occurrences.length||row.choices.some(c=>c.occurrenceIndex<0||c.occurrenceIndex>=p.occurrences.length||c.variantIndex<-1||c.variantIndex>=variants.length))throw Error('Frequency measurement lost an occurrence');}}
 const counts=variants.map(()=>0),unknown=[];
 for(const p of sample)for(let k=0;k<p.occurrences.length;k++){const choices=rows.map(r=>r.items.find(t=>t.id===String(p.itemId)).choices.find(c=>c.occurrenceIndex===k));if(choices.every(c=>c.certainty==='clear')&&choices[0].variantIndex===choices[1].variantIndex&&choices[0].variantIndex>=0)counts[choices[0].variantIndex]++;else unknown.push({id:p.itemId,occurrenceIndex:k,choices});}
 const sorted=sortByUsage(saved,counts);assertCandidateDelivery({proposal:read(`${run}/bound-proposal.json`),savedByLanguage:{en:sorted.saved},obligations:read(`${run}/coverage-audit.json`).deliveryObligations,evidence:input.research});
 write(`${run}/frequency.json`,{sample:sample.length,counts,order:sorted.order,sortedCounts:sorted.counts,unknown});write(`${run}/saved-glossary.json`,sorted.saved);
}
if(phase==='build'){
 const audit=await ask('coverage-audit',auditSchema,`Independently audit contextual target coverage from the Spanish meanings, witnesses and dictionary. The earlier proposal may be wrong. ${CONTEXTUAL_CANDIDATE_RULES} ${AUDIT_DELIVERY_RULES} Inspect all considered/rejected candidates and their actual supported applications; do not preserve a blanket rejection when its reason is only that a target does not fit some other application.`,{term:input.term,languages:input.languages,inventory:record.inventory,proposal:read(`${run}/old-proposal.json`),dictionary:input.dictionary,sourceWitnesses:witnesses});
 let proposal=await ask('candidate-repair',proposalSchemaFor(input,record.inventory),`Repair contextual target coverage and selection notes using actual source evidence. ${CONTEXTUAL_CANDIDATE_RULES} Render the headword contribution, leaving separately expressed modifiers to ordinary translation. Satisfy every delivery obligation in actual target text and usable positive/negative scope. Within a supported application prefer the precise natural translation rather than a broader understandable fallback; do not make a narrower translation a default outside its scope. Make this guidance concise and portable to unseen examples; do not restrict it to quoted witnesses. Resolve conflicting generic notes. Keep all other source meanings and valid candidates. sourceForms must be empty; compilation restores verified forms. There is no external test rubric or evaluator feedback.`,{term:input.term,languages:input.languages,inventory:record.inventory,provenance:record.provenance,proposal:read(`${run}/old-proposal.json`),audit,sourceWitnesses:witnesses,dictionary:input.dictionary});
 let result;
 try{result=compiled(proposal);}catch(e){
  if(!e.message.startsWith('Unresolved candidate delivery:'))throw e;
  proposal=await ask('candidate-closure',proposalSchemaFor(input,record.inventory),`Close only the compiler-reported candidate-delivery defects. Every candidate marked kept for a supported meaning must be an actual selectable target with a source-supported scope. Acknowledging validity or saying another word is broader cannot replace delivery. Preserve all existing valid variants, notes and meaning identities. Do not absorb modifiers or invent meanings. Revise prior dispositions only with source evidence. sourceForms must be empty. This is the one bounded closure retry; unresolved defects will be reported.`,{term:input.term,languages:input.languages,inventory:record.inventory,provenance:record.provenance,proposal,deliveryError:e.message,audit,sourceWitnesses:witnesses});
  result=compiled(proposal);
 }
 write(`${run}/bound-proposal.json`,result.proposal);write(`${run}/unsorted-glossary.json`,result.saved);write(`${run}/repair-count.json`,{round:1,max:2,closureRetries:read(`${run}/candidate-closure.json`)?1:0});write(`${run}/research-frozen.json`,{criterionAccess:false,coveragePassed:true,signature:hash(result),obligations:audit.deliveryObligations});
}else if(phase==='plural-source'){
 const cases=read(`${run}/plural-regression.json`),schema=object({items:array(object({id:string,occurrences:array(object({occurrenceIndex:integer,meaningSpanish:string,preferredEnglish:string,certainty:{type:'string',enum:['clear','ambiguous','unknown']},evidenceQuote:string,reason:string}))}))});
 const readings=[];
 for(const j of [1,2]){const answer=await ask(`plural-source-reading-${j}`,schema,`Read each source occurrence independently, before any glossary, existing translation or English candidate list. Identify its contextual meaning in Spanish and the most specifically justified natural English wording for the researched word's contribution. Preserve author claims and actual category members. Treat separately expressed modifiers separately; respect whole idioms and source number. Mark genuine ambiguity rather than forcing a narrow word. Cite a verbatim source quote. Account for every zero-based occurrence and every id once.`,{term:input.term,passages:cases.map(p=>({id:String(p.itemId),text:p.text,before:p.contextBefore,after:p.contextAfter,occurrences:p.occurrences}))},'source-analysis','high');checkIds(answer.items,cases.map(p=>String(p.itemId)));readings.push(answer.items);}
 const contracts=[];for(const p of cases)for(let k=0;k<p.occurrences.length;k++){const rs=readings.map(rows=>rows.find(r=>r.id===String(p.itemId)).occurrences.find(o=>o.occurrenceIndex===k));if(rs.some(r=>!r))throw Error('Unaccounted plural source occurrence');contracts.push({id:String(p.itemId),occurrenceIndex:k,readings:rs,agreement:rs.every(r=>r.certainty==='clear')&&rs[0].preferredEnglish.toLowerCase()===rs[1].preferredEnglish.toLowerCase()});}write(`${run}/source-expectations-plural.json`,contracts);
}else if(phase==='detector-calibrate'){
 const controls=read(`${run}/detector-controls.json`),requestFile=fs.readdirSync(`${run}/calls/runtime-check-1-round-2`,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>`${run}/calls/runtime-check-1-round-2/${d.name}/request.json`).find(f=>fs.existsSync(f));
 const instructions=read(requestFile).instructions,answer=await ask('detector-fault-check',checkSchema,instructions,{entry:read(`${run}/saved-glossary.json`),passages:controls.map(c=>c.packet)},'verification');checkIds(answer.items,controls.map(c=>c.packet.id));
 const failures=[];for(const c of controls){const row=answer.items.find(r=>r.id===c.packet.id);for(const e of c.expected){const got=row.occurrences.find(o=>o.occurrenceIndex===e.occurrenceIndex);if(!got||!e.allowed.includes(got.status))failures.push({id:c.packet.id,occurrenceIndex:e.occurrenceIndex,allowed:e.allowed,actual:got?.status,reason:got?.reason});}}
 write(`${run}/detector-calibration.json`,{passed:!failures.length,presentations:controls.length,failures});
}else if(phase==='metamorphic'){
 const original=read(`${run}/plural-regression.json`),saved=read(`${run}/saved-glossary.json`);
 const cases=original.map(p=>({id:hash('new-identity:'+p.itemId).slice(0,16),text:p.text.replaceAll('Hercólubus','Orvantis'),contextBefore:p.contextBefore.map(t=>t.replaceAll('Hercólubus','Orvantis')),contextAfter:p.contextAfter.map(t=>t.replaceAll('Hercólubus','Orvantis')),originalId:String(p.itemId)}));
 write(`${run}/metamorphic-source.json`,cases);
 for(const rep of [1,2]){
  const packet=cases.map(({originalId,...p})=>p),hints=[...new Map(packet.flatMap(p=>consumerHints(saved,p.text)).map(h=>[h.sourceTerm.toLowerCase(),h])).values()];
  const answer=await ask(`metamorphic-translation-${rep}`,translationSchemaFor(packet),translationInstructions,{passages:packet,glossary_info:hints},'translation','low');validateTranslations(answer.items,packet);write(`${run}/metamorphic-translations-${rep}.json`,answer.items);
 }
}else if(phase==='plural'){
 const jobs=['no-glossary','old-glossary','repaired-glossary'].flatMap(a=>[1,2].map(r=>[a,r]));let at=0;
 await Promise.all(Array.from({length:workers},async()=>{while(at<jobs.length){const [arm,rep]=jobs[at++];await translate(arm,rep,true);}}));
}else if(phase==='measure')await measure();
else if(phase==='baseline'||phase==='translate'){
 const jobs=phase==='baseline'?['no-glossary','old-glossary'].flatMap(a=>[1,2].map(r=>[a,r])):[['repaired-glossary',1],['repaired-glossary',2]];let at=0;
 await Promise.all(Array.from({length:workers},async()=>{while(at<jobs.length){const [arm,rep]=jobs[at++];await translate(arm,rep);}}));
}else if(phase==='verify'){
 await Promise.all([1,2].map(verify));write(`${run}/runtime-frozen.json`,{criterionAccess:false,round:read(`${run}/repair-count.json`).round,glossary:hash(read(`${run}/saved-glossary.json`))});
}else if(phase==='repair-notes'){
 const state=read(`${run}/repair-count.json`),round=state.round;if(round>=2)throw Error('Repair budget exhausted; report unresolved failures');
 const saved=read(`${run}/saved-glossary.json`),checks=[1,2].map(r=>read(`${run}/runtime-check-${r}.json`)),tested=[...source.passages,...read(`${run}/plural-regression.json`)];
 const schema=object({proposal:proposalSchemaFor(input,record.inventory),editEvidence:array(object({target:string,evidenceId:string,quote:string})),unresolved:array(string)});
 const answer=await ask('usage-note-repair',schema,`Repair independently detected term-selection failures from source evidence. Distinguish an available target being bypassed because its note lacks selection priority from a genuinely missing contextual target. For an available target search for conflicting defaults, referent-versus-headword confusion, and notes that describe validity without saying when to prefer it. Write a concise positive conditional preference overriding broader defaults and frequency within that scope; preserve fallback conditions and all named category members. Missing natural targets may be added only when the source supports a useful distinction, with source meaning IDs and scope. Do not mechanically enforce an arbitrary stylistic synonym; decide whether the preferred wording contributes useful precision or naturalness. Keep all existing candidates, source meanings, forms, names and reader explanations. Render the headword rather than absorbing modifiers. Do not make narrower wording a global default. Return sourceForms empty; the compiler restores them. Give actual source quotes for every changed or added target note. This is the final conditional consumer repair; unresolved issues are reported. No human criteria or external grading is available.`,{entry:saved,proposal:read(`${run}/bound-proposal.json`),inventory:record.inventory,provenance:record.provenance,checks,sourceWitnesses:tested.map(p=>({id:String(p.itemId),text:p.text}))});
 const result=compiled(answer.proposal),prior=saved.terms[0];
 for(const target of prior.targetTerms)if(!result.saved.terms[0].targetTerms.some(t=>t.toLowerCase()===target.toLowerCase()))throw Error('Consumer repair dropped an existing candidate');
 const available=[...input.research,...tested];
 for(const [index,target] of result.saved.terms[0].targetTerms.entries()){
  const old=prior.targetTerms.findIndex(t=>t.toLowerCase()===target.toLowerCase());if(old>=0&&prior.targetVariantNotes[old]===result.saved.terms[0].targetVariantNotes[index])continue;
  const proof=answer.editEvidence.filter(e=>e.target.toLowerCase()===target.toLowerCase());
  if(!proof.some(e=>available.some(p=>String(p.itemId)===e.evidenceId&&p.text.includes(e.quote)&&e.quote.trim())))throw Error('Changed candidate note lacks actual supplied source evidence: '+target);
 }
 write(`${run}/bound-proposal.json`,result.proposal);write(`${run}/saved-glossary.json`,result.saved);write(`${run}/unsorted-glossary.json`,result.saved);write(`${run}/repair-count.json`,{round:round+1,max:2,closureRetries:state.closureRetries??0,unresolved:answer.unresolved});
}
