/** Predeclared acceptance obligations; an AI preference cannot define these gates. */
export const SAFEGUARDS=Object.freeze([
 {id:'dictionary',cases:['fatal-six-meanings','intimo-ordinary-adjective'],fault:'Remove a required ordinary meaning or label a corpus-only meaning as dictionary-attested.',proof:'Entry inventory and actual applicable translations; published-source identity.'},
 {id:'forms',cases:['intimo-accent-number-gender','regenerar-attached-pronouns'],fault:'Omit attested spellings/reflexive forms, or include an unrelated homograph.',proof:'Read-only corpus recall and disambiguation, not target quality alone.'},
 {id:'family',cases:['sensible-family-distinction'],fault:'Omit a requested related study or merge different family meanings.',proof:'Family follow-up behavior and separate meaning/entry identities.'},
 {id:'sampling',cases:['alquimistas-adjective','devoto-ordinary-believer'],fault:'Select only ranked dominant passages or let duplicates inflate counts.',proof:'Seeded full-population sampler tests and minority-sense challenge translations.'},
 {id:'origins',cases:['intimo-innermost-dayspring','hooltampanas-canonical-source'],fault:'Drop the original designation/book, invent an origin, or replace a name by its definition.',proof:'Verified source evidence survives into the final glossary and noun translations.'},
 {id:'parts-source-frequency',cases:['sensible-perceptible','suprasensible-components'],fault:'Compare whole-word frequency while required senses differ, or treat a coinage as an ordinary word.',proof:'Sense-specific lexical/comprehension controls and recorded frequency evidence.'},
 {id:'candidates',cases:['intimo-whole-term-meaning','mundo-planet-not-lost'],fault:'Suppress a needed target before testing it or substitute a synonym/name of another concept.',proof:'Candidate identity, source meaning and documented disposition at every stage.'},
 {id:'candidate-checks',cases:['suprasensible-components'],fault:'Accept a compound because its spelling is plausible even when a part carries another meaning.',proof:'English comprehension/false-friend controls on actual corpus contexts.'},
 {id:'target-frequency',cases:['sensible-perceptible'],fault:'Let the common reasonable sense conceal the rare perceptible sense.',proof:'Target sense is actually understandable, not merely dictionary-listed or frequent as a word.'},
 {id:'discovery',cases:['fatal-collocation','intimo-discovery-candidates'],fault:'Force all contexts into a preframed list or silently discard recurrent free renderings.',proof:'Natural sentence checks and explicit kept/rejected dispositions for discoveries.'},
 {id:'proposal',cases:['mundo-planet-not-lost','fatal-six-meanings','vanidad-appearance-motive'],fault:'Drop passed findings or shorten a definition until it loses its defining condition.',proof:'Inventory continuity and human-criterion contextual translations.'},
 {id:'existing-comparison',cases:['intimo-no-glossary-anchoring'],fault:'Treat the current human entry as an independent discovery.',proof:'Research input inspection and post-proposal-only comparison; no leaked targets.'},
 {id:'shared-translations',cases:['sensible-family-distinction','extasis-samadhi-label'],fault:'Erase a source contrast by assigning both lexical labels the same target.',proof:'Contrasted same-sentence cases; legitimate equivalent labels are negative controls.'},
 {id:'review',cases:['astral-via-human-rejection'],fault:'Accept a widespread learned mistranslation despite the supplied human criterion.',proof:'Human-criterion translation and review/edit behavior; generic model agreement is insufficient.'},
 {id:'freeze',cases:['scope-survives-freeze','edits-invalidate-counts'],fault:'Lose meanings/grammar when freezing, or retain judgments for an edited proposal.',proof:'Replay real freeze/versioning helpers; meaningful scope must reach the consuming guide.'},
 {id:'counting',cases:['fatal-collocation','vm-unassigned-occurrences'],fault:'Choose a target without natural sentence fit or report missing/unassigned responses as agreement.',proof:'Every occurrence accounted for; no-glossary sentence comparison and exception accounting.'},
 {id:'second-judge',cases:['judge-side-symmetry','domain-fault-sensitivity'],fault:'Count a one-sided or disputed preference as verified quality.',proof:'Mirrored, domain-specific positive/negative controls; independent confirmation.'},
 {id:'consistency',cases:['world-planet-not-interchangeable','narrowing-reaches-consumer'],fault:'Merge world with planet, drop a word used by another meaning, or display a restriction without applying it.',proof:'Meaning-specific settling and saved/consumed selection constraints.'},
 {id:'rare-notes',cases:['ultramundos-reader-explanation'],fault:'Generate an opaque-term footnote but lose it during report/save.',proof:'Readable alternative or explanation is preserved through save and reader-note delivery.'},
 {id:'summary-report-save',cases:['supported-sense-not-pruned','narrowing-reaches-consumer','footnote-survives-save'],fault:'Let summary, rarity pruning or save serialization erase a surviving finding.',proof:'Final saved entry and actual translator prompt, not intermediate report text.'},
]);

/** Missing coverage and failed calibration block retirement even if random tests win. */
export function retirementGate(contract, evidence){
 const blockers=[];
 for(const id of contract.cases){
  const c=evidence.cases?.[id];
  if(!c){blockers.push(`${id}: missing case`);continue;}
  if(c.criteriaFrozen!==true)blockers.push(`${id}: criteria not frozen`);
  if(c.faultDetected!==true)blockers.push(`${id}: intended fault not detected`);
  if(c.acceptableControlPassed!==true)blockers.push(`${id}: acceptable alternative falsely rejected or untested`);
  if(c.actualOutcome!=='pass')blockers.push(`${id}: actual result ${c.actualOutcome??'missing'}`);
  if(c.reachesConsumer!==true)blockers.push(`${id}: finding not preserved to its consumer`);
  if(c.needsHumanReview&&c.humanReviewed!==true)blockers.push(`${id}: human judgment unresolved`);
 }
 if(evidence.noGlossaryComparisonComplete!==true)blockers.push('No-glossary comparison incomplete');
 if(evidence.confirmedNewMeaningErrors>0)blockers.push('Confirmed new meaning errors');
 if(evidence.randomRegressionComplete!==true)blockers.push('Random regression incomplete');
 return {id:contract.id,status:blockers.length?'blocked':'eligible-for-removal-experiment',blockers};
}

/** Declared metadata is counted as carried only if it actually survives serialization. */
export function auditFrozen(proposal,frozen){
 const issues=[];
 for(const entry of proposal.entries??[]){
  const saved=frozen.entries?.find(e=>e.id===entry.id);
  for(const variant of entry.variants??[]){
   const target=saved?.variants?.find(v=>v.id===variant.id);
   if(!target){issues.push({kind:'missing-variant',entryId:entry.id,variantId:variant.id});continue;}
   for(const field of ['senses','corpusSense','partOfSpeech','original']){
    const value=variant[field];
    if(value!=null&&(!(Array.isArray(value))||value.length)&&JSON.stringify(value)!==JSON.stringify(target[field]))
     issues.push({kind:'lost-'+field,entryId:entry.id,variantId:variant.id,target:variant.target});
   }
  }
 }
 return issues;
}

export function auditSaved(stages,entry){
 const issues=[];
 const variants=(entry.entries??[]).flatMap(e=>e.variants??[]);
 for(const note of stages.footnotes??[]){
  if(!note.note?.trim())continue;
  const row=variants.find(v=>v.target===note.target);
  if(row&&!JSON.stringify(entry).includes(note.note))issues.push({kind:'lost-reader-note',target:note.target});
 }
 for(const narrowed of stages.consistency?.narrowed??[]){
  const row=variants.find(v=>v.id===narrowed.variantId);
  if(row&&!row.selectionScope)issues.push({kind:'scope-change-not-serialized',variantId:row.id,target:row.target,kept:narrowed.kept,removed:narrowed.removed});
 }
 return issues;
}
