import {applyUsagePatch,sortByUsage} from './htn_core.mjs';
const integer={type:'integer'},quoteSchema=object({evidenceId:string,quote:string});
const usagePatchSchema=object({order:array(integer),variantNotes:array(object({index:integer,note:string,evidenceId:string,quote:string})),additionalGeneralNote:string,generalEvidence:array(quoteSchema)});
const endCheckSchema=object({languages:array(object({language:string,status:{type:'string',enum:['no_change','proposed','unknown']},analysis:string,patch:usagePatchSchema})),unresolved:array(string)});
const useCountSchema=object({items:array(object({id:string,choices:array(object({occurrenceIndex:integer,variantIndex:integer,rendering:string,certainty:{type:'string',enum:['clear','ambiguous','unassigned']},reason:string}))}))});
function clearRubric(saved){const clean=structuredClone(saved);for(const t of clean.terms)t.notesToTranslators=t.notesToTranslators.replace(/^MANDATORY PROJECT CONSTRAINTS[^\n]*\n/,'');return clean;}
function sourceWitnesses(input){
 const inventory=loadStage(input.index,'inventory'),selected=new Map();
 for(const s of inventory.senses){const p=input.research.find(p=>s.evidenceIds.includes(String(p.itemId)));if(p)selected.set(String(p.itemId),p);}
 return [...selected.values()];
}
async function blindEndCheck(i){
 const input=inp(i),out=`${dir(i)}/blind-end-check.json`;if(read(out))return;
 const development=input.test.filter(p=>p.role==='development'),witnesses=sourceWitnesses(input);
 const evidence=[...development,...witnesses];
 for(const p of [...evidence])for(const [side,texts] of [['before',p.contextBefore??[]],['after',p.contextAfter??[]]])for(const [n,text] of texts.entries())evidence.push({itemId:`${p.itemId}:${side}:${n}`,text});
 const entries=input.languages.map(language=>({language,entry:clearRubric(read(`${dir(i)}/htn-v4/${language}/saved-glossary.json`))}));
 const pairs=input.languages.map(language=>({language,passages:development.map(p=>({id:String(p.itemId),source:p.text,contextBefore:p.contextBefore,contextAfter:p.contextAfter,withoutGlossary:read(`${dir(i)}/context-baseline/${language}/no-glossary.json`).find(r=>r.id===String(p.itemId)).translation,withGlossary:read(`${dir(i)}/htn-v4/${language}/htn.json`).find(r=>r.id===String(p.itemId)).translation}))}));
 const content={term:input.term,entries,sourceEvidence:evidence.map(p=>({id:String(p.itemId),text:p.text})),dictionary:input.dictionary,originals:input.originals,pairs};
 const requestAudit={withheld:['Human acceptance rubric','Evaluator verdicts/reasons','Source-judge labels','Confirmation passages/translations'],inputKeys:Object.keys(content),developmentIds:development.map(p=>String(p.itemId)),sourceEvidenceIds:evidence.map(p=>String(p.itemId)),context:'Fresh ephemeral subscription execution; tools, plugins, memory and shell disabled. Existing glossary guidance is visible, but verbatim rubric blocks are removed.',exposure:'Development-only final check. Prior benchmark exposure remains disclosed.'};
 write(`${dir(i)}/blind-end-check-input-audit.json`,requestAudit);
 const result=await ask(i,'rubric-blind-end-check',endCheckSchema,`You are the final linguistic check for a glossary entry. Independently compare the actual Spanish sources and translation outputs. There is no external test rubric or expected answer. Determine whether the entry causes a meaning, grammar, name/string-mention, naturalness or applicability error. A synonym difference alone is not an error. You may propose one repair of usage notes or ordering; do not change targets, source forms, names, provenance, reader notes or supported meaning coverage. Preserve all existing candidates exactly once in order as their original zero-based indices. Frequency measurement later sets final order, so notes must express meaning applicability independently of position. Edit a variant note only with a direct quote from a supplied source evidence id. Any additional general note also needs a supplied quote. Quotes must be verbatim substrings. Do not invent source conditions or patch unrelated translation defects. If no note/order repair is supported, return no_change, identity order, empty edits and empty general note. If forms, meanings or candidates need research rather than a note repair, return unknown and explain the unresolved question. A no_change/unknown result must not silently edit the entry. This is the single permitted proposal; do not speculate about hidden scoring criteria. Return every requested language once.`,content,'research','medium');
 if(result.languages.length!==input.languages.length||new Set(result.languages.map(l=>l.language)).size!==input.languages.length||result.languages.some(l=>!input.languages.includes(l.language)))throw Error('End check lost/repeated languages');
 for(const l of result.languages){const prior=read(`${dir(i)}/htn-v4/${l.language}/saved-glossary.json`);if(l.status!=='proposed'&&(l.patch.variantNotes.length||l.patch.additionalGeneralNote||l.patch.order.some((n,j)=>n!==j)))throw Error('Unproposed repair attempted edits');const saved=applyUsagePatch(prior,l.patch,evidence);write(`${dir(i)}/htn-v7/${l.language}/unsorted-glossary.json`,saved);}
 write(out,result);
}
async function frequencyStudy(i){
 const input=inp(i),sample=read(`${dir(i)}/frequency-input.json`);if(!read(`${dir(i)}/blind-end-check.json`))throw Error('Blind final check not ready');
 for(const language of input.languages){
  const file=`${dir(i)}/htn-v7/${language}/frequency.json`;if(read(file))continue;
  const saved=read(`${dir(i)}/htn-v7/${language}/unsorted-glossary.json`),term=saved.terms[0],variants=term.targetTerms.map((target,index)=>({index,target,note:term.targetVariantNotes[index]})),judgments=[];
  for(const judge of [1,2]){
   const rows=[];
   for(const [at,batch] of batches(sample.sample,24).entries()){
    const packet={term:input.term,language,candidates:[...variants].sort((a,b)=>hash(`${judge}:${a.index}`).localeCompare(hash(`${judge}:${b.index}`))),generalGuidance:clearRubric(saved).terms[0].notesToTranslators,passages:batch.map(p=>({...sourcePacket([p],true)[0],occurrences:p.occurrences.map((o,occurrenceIndex)=>({...o,occurrenceIndex}))}))};
    const result=await ask(i,`frequency-${language}-judge-${judge}-batch-${at}`,useCountSchema,`Measure preferred use of the supplied target variants in this independently sampled source data. For EVERY listed researched-word occurrence choose a natural meaning-preserving rendering in ${language==='en'?'English':'Vietnamese'} and its original candidate index. Candidate presentation order is arbitrary, not frequency or preference. Interpret each occurrence from source and context, distinguishing lexical meaning, grammar and string mention. A source's other words must not determine the headword's rendering. Prefer an applicable natural candidate rather than adding stylistic synonyms. If none fits, use -1 and unassigned; if genuinely ambiguous, mark ambiguous and do not force a choice. Return one choice for every zero-based occurrence index exactly once and every passage id once. A rendering is the word/phrase contribution, not a full passage. This estimates preferred candidate-use frequency in this sample, not correctness or exhaustive corpus prevalence. No human acceptance rubric or evaluator verdicts is provided.`,packet,'measurement','medium');
    checkIds(result.items,batch.map(p=>String(p.itemId)));
    for(const r of result.items){const p=batch.find(p=>String(p.itemId)===r.id);if(r.choices.length!==p.occurrences.length||new Set(r.choices.map(c=>c.occurrenceIndex)).size!==p.occurrences.length||r.choices.some(c=>c.occurrenceIndex<0||c.occurrenceIndex>=p.occurrences.length||c.variantIndex<-1||c.variantIndex>=variants.length))throw Error('Unaccounted or invalid frequency occurrence');}
    rows.push(...result.items);
   }
   judgments.push(rows);
  }
  const counts=variants.map(()=>0),unsettled=[];let total=0;
  for(const p of sample.sample)for(let k=0;k<p.occurrences.length;k++){total++;const a=judgments[0].find(r=>r.id===String(p.itemId)).choices.find(c=>c.occurrenceIndex===k),b=judgments[1].find(r=>r.id===String(p.itemId)).choices.find(c=>c.occurrenceIndex===k);if(a.certainty==='clear'&&b.certainty==='clear'&&a.variantIndex===b.variantIndex&&a.variantIndex>=0)counts[a.variantIndex]++;else unsettled.push({id:String(p.itemId),occurrenceIndex:k,first:a,second:b});}
  const sorted=sortByUsage(saved,counts);
  write(`${dir(i)}/htn-v7/${language}/saved-glossary.json`,sorted.saved);
  write(file,{sampleParagraphs:sample.sample.length,totalOccurrences:total,confirmedAssigned:counts.reduce((a,b)=>a+b,0),unsettled,countsBeforeSort:counts,order:sorted.order,sortedCounts:sorted.counts,judgments,sparseOverlap:sample.sparseOverlap,meaning:sample.countMeaning,signature:decisionSignature({saved:sorted.saved,sample,counts})});
 }
}
if(phase==='blind-check')await pool(indices,blindEndCheck);
else if(phase==='frequency')await pool(indices,frequencyStudy);
else throw Error('Unknown amended phase');
if(worker)worker.stdin.end();
