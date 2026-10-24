/** Experimental serialization of existing full-pipeline findings, with no new inference. */
const key=s=>String(s??'').normalize('NFC').toLowerCase().replace(/\s+/gu,' ').trim();
export function preserveFullFindings(stages,originalEntry){
 const result=structuredClone(originalEntry),proposal=stages.confirmedProposal??stages.proposal;
 if(!proposal||!result.entries)throw new Error('Full proposal and final entry required');
 const proposed=new Map(proposal.entries.flatMap(e=>e.variants.map(v=>[v.id,{...v,entry:e}])));
 const checks=stages.checks?.candidates??[];
 const meanings=stages.parts?.study?.senses??[];
 const dictionaryFound=stages.dictionary?.status==='found';
 const protectedSenses=new Set(meanings.filter(m=>m.usedByAuthor||dictionaryFound).map(m=>m.id));
 const candidateSenses=new Map();
 for(const check of checks){
  const k=key(check.target);if(!candidateSenses.has(k))candidateSenses.set(k,[]);
  candidateSenses.get(k).push(check);
 }
 const changes=[],unresolved=[];
 const rejected=(target)=>{const c=candidateSenses.get(key(target))??[];return c.length&&c.every(r=>r.verdict==='fail');};
 const idsOf=target=>[...new Set((candidateSenses.get(key(target))??[]).filter(c=>c.verdict!=='fail').map(c=>c.senseId).filter(Boolean))];
 const normalizedMeaning=(label)=>{
  const variant=proposed.get(label);
  if(variant)return [...new Set([...(variant.senses??[]),variant.corpusSense].filter(Boolean))];
  return label?[label]:[];
 };
 for(const entry of result.entries){
  const p=proposal.entries.find(e=>e.id===entry.id||e.id===entry.id.split('~')[0]);
  if(!p){unresolved.push({entryId:entry.id,reason:'No matching proposal entry'});continue;}
  const split=entry.id!==p.id;
  const restoreHere=!split||entry.sourceTerms.some(f=>key(f)===key(p.sourceTerms[0]));
  const represented=new Set(entry.variants.flatMap(v=>idsOf(v.target)));
  // Counts may rank synonyms, but cannot eliminate every checked option of an
  // attested/source-dictionary meaning. Restore one original proposed option.
  for(const senseId of protectedSenses){
   if(represented.has(senseId))continue;
   if(!restoreHere){unresolved.push({entryId:entry.id,senseId,reason:'Split-form applicability unproven; do not copy the headword option into this sibling'});continue;}
   const choices=p.variants.filter(v=>idsOf(v.target).includes(senseId)&&!rejected(v.target));
   if(!choices.length){unresolved.push({entryId:entry.id,senseId,reason:'No checked proposal target for required research meaning'});continue;}
   const picked=choices.slice().sort((a,b)=>{
    const counts=stages.aggregate?.entries?.[p.id]?.variants??{};
    return (counts[b.id]?.occurrences??0)-(counts[a.id]?.occurrences??0)||p.variants.indexOf(a)-p.variants.indexOf(b);
   })[0];
   if(!entry.variants.some(v=>key(v.target)===key(picked.target)))entry.variants.push(structuredClone(picked));
   for(const id of idsOf(picked.target))represented.add(id);
   changes.push({kind:'restored-sole-sense-option',entryId:entry.id,senseId,variantId:picked.id,target:picked.target});
  }
  // A coarse source inventory can combine distinct operational meanings. Its
  // mere presence cannot stand in for every finer meaning the proposal found.
  const fineGroups=new Map();
  for(const v of p.variants){
   if(rejected(v.target)||!idsOf(v.target).some(id=>protectedSenses.has(id)))continue;
   for(const label of v.senses??[]){const k=key(label);if(!fineGroups.has(k))fineGroups.set(k,[]);fineGroups.get(k).push(v);}
  }
  const labelsOf=v=>{
   const before=proposed.get(v.id)??p.variants.find(pv=>key(pv.target)===key(v.target));
   const narrowing=stages.consistency?.narrowed?.find(n=>n.variantId===before?.id);
   return (narrowing?narrowing.kept.flatMap(normalizedMeaning):before?.senses??[]).map(key);
  };
  for(const [label,choices] of fineGroups){
   if(entry.variants.some(v=>labelsOf(v).includes(label)))continue;
   if(!restoreHere){unresolved.push({entryId:entry.id,meaning:label,reason:'Split-form applicability unproven; requires a source case for this form'});continue;}
   const settled=(stages.consistency?.standardised??[]).some(s=>s.meanings?.some(m=>normalizedMeaning(m).map(key).includes(label))&&entry.variants.some(v=>v.id===s.keep));
   if(settled)continue;
   const picked=choices[0];
   if(entry.variants.some(v=>key(v.target)===key(picked.target))){unresolved.push({entryId:entry.id,meaning:label,reason:'Retained word has lost this meaning through narrowing; requires an explicit disposition'});continue;}
   entry.variants.push(structuredClone(picked));
   changes.push({kind:'restored-sole-operational-meaning',entryId:entry.id,meaning:label,variantId:picked.id,target:picked.target});
  }
  for(const variant of entry.variants){
   const before=proposed.get(variant.id)??p.variants.find(v=>key(v.target)===key(variant.target));
   if(!before){unresolved.push({variantId:variant.id,reason:'No proposal identity for final target'});continue;}
   for(const field of ['senses','corpusSense','partOfSpeech','original'])if(before[field]!=null)variant[field]=structuredClone(before[field]);
   variant.sourceSenseIds=idsOf(variant.target);
   const narrowing=stages.consistency?.narrowed?.find(n=>n.variantId===before.id);
   if(narrowing){
    const kept=[...new Set(narrowing.kept.flatMap(normalizedMeaning))],removed=[...new Set(narrowing.removed.flatMap(normalizedMeaning))];
    variant.selectionScope={kept,removed};
    // Scope is explicit data for the consumer, not merely report commentary.
    variant.senses=kept;
    if(!kept.length)unresolved.push({variantId:variant.id,reason:'Consistency narrowing has no resolvable kept meaning'});
    changes.push({kind:'carried-consistency-scope',variantId:variant.id,kept,removed});
   }
   const notes=(stages.footnotes??[]).filter(n=>key(n.target)===key(variant.target)&&n.note?.trim()).map(n=>n.note);
   if(notes.length){variant.readerNotes=[...new Set(notes)];changes.push({kind:'carried-reader-note',variantId:variant.id,target:variant.target});}
  }
 }
 // Preserve the explanation once, with references from variants. Do not repeat
 // full passages, acquisition prose or all sense-frequency measurements in prompts.
 const used=new Set(result.entries.flatMap(e=>e.variants.flatMap(v=>v.sourceSenseIds??[])));
 result.sourceMeaningDefinitions=meanings.filter(m=>used.has(m.id)).map(m=>({id:m.id,definition:m.gloss,partOfSpeech:m.partOfSpeech??null,usedByAuthor:m.usedByAuthor===true}));
 result.preservation={researchCalls:0,changes,unresolved,
  limitation:'A checked source meaning is not automatically a human-approved target. Translation and calibrated domain tests must establish quality before adoption.'};
 return result;
}

/** The actual experimental consumer packet, omitting report-only diagnostics. */
export function consumerGuide(entry){
 return {sourceMeaningDefinitions:entry.sourceMeaningDefinitions??[],entries:entry.entries.map(e=>({id:e.id,kind:e.kind,sourceTerms:e.sourceTerms,generalNote:e.generalNote,
  variants:e.variants.map(v=>({id:v.id,target:v.target,note:v.note,partOfSpeech:v.partOfSpeech??null,sourceSenseIds:v.sourceSenseIds??[],
   meaningLabels:v.senses??[],corpusMeaning:v.corpusSense??null,selectionScope:v.selectionScope??null,original:v.original??null,readerNotes:v.readerNotes??[]}))}))};
}
