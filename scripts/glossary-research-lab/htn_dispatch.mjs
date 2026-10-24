import {POLICY,INVENTORY_SCHEMA,NORMALIZATION_SCHEMA,PROVENANCE_SCHEMA,PROPOSAL_SCHEMA,AUDIT_SCHEMA,ALIAS_SCHEMA,LABEL_SCHEMA,taskPlan,validateInventory,validateProposal,bindProposalForms,sanitizeProvenance,proposalSchemaFor,groundProposal,translationSchemaFor,validateTranslations,attachMandatoryConstraints,sourcePacket,serializeEntry,consumerHints,selectionEffect,allowRepair,decisionSignature} from './htn_core.mjs';
const phase=command,method=arg('method','htn-v1'),indices=arg('indices','1,2,3,4,5,6,7').split(',').map(Number),requirements=read(`${run}/requirements.json`);
const dir=i=>`${run}/terms/${String(i).padStart(2,'0')}`;
const inp=i=>read(`${dir(i)}/input.json`);
const emit=(i,n,v)=>write(`${dir(i)}/${n}.json`,v);
const loadStage=(i,n)=>read(`${dir(i)}/${n}.json`);
const frames=p=>({id:String(p.itemId),reference:p.reference,windows:p.occurrences.slice(0,3).map(o=>p.text.slice(Math.max(0,o.start-180),Math.min(p.text.length,o.end+220)))});
async function ask(i,stage,schema,instructions,content,role='research',effort='medium'){
 if(schema===translationSchema)schema=translationSchemaFor(content.passages);
 if(schema===PROPOSAL_SCHEMA){schema=proposalSchemaFor(inp(i),content.inventory);instructions+=' Source form identity is owned by the compiler: return sourceForms as an empty array for every language; the compiler restores all verified aliases. Use each requested language exactly once. Keep targets/scopes concise; group the same target across meanings where it fits, rather than repeating the same wording.';}
 for(let attempt=0;;attempt++){
  try{return JSON.parse((await call({term:inp(i).term,method,stage,purpose:stage,effort,schema,instructions,content:JSON.stringify(content)},`${dir(i)}/calls/${stage}`,role)).text);}
  catch(e){if(attempt>=2||!/429|Too Many Requests/.test(e.message))throw e;console.log(JSON.stringify({term:inp(i).term,stage,status:'rate-limit-backoff',attempt}));await new Promise(r=>setTimeout(r,[30000,60000][attempt]));}
 }

}
async function source(i){
 if(loadStage(i,'inventory'))return;
 const input=inp(i),passages=input.research.slice(0,POLICY.initialFullContexts).map(p=>({id:String(p.itemId),text:p.text,reference:p.reference}));
 const inventory=await ask(i,'source-inventory',INVENTORY_SCHEMA,`Establish the meanings of this Spanish expression independently of target translations. Read the corpus and lexical evidence openly. Do not propose English/Vietnamese targets. Create stable source sense ids, separating operational meanings, grammar, ordinary adjectives, named concepts, idioms and construction-specific senses. A definition of a name is not a second lexical meaning. No arbitrary six-sense cap. Cite supplied research passage ids for every author-attested sense; dictionary-only senses without author evidence are unresolved questions. Verify each candidate form: related derivatives are separate studies, unrelated look-alikes are excluded, variants require contextual identity. Propose justified related studies without recursively researching them. Do not accept original-book alignments as proof until passages are checked in the next task. Distinguish unresolved from absent.`,{term:input.term,dictionary:input.dictionary,formsHint:input.formsHint,nearForms:input.nearForms,candidateForms:input.candidateForms,passages,coverageFrames:input.research.slice(0,POLICY.scoutWindows).map(frames),originalPairs:input.originalPairs.pairs});
 validateInventory(input,inventory);emit(i,'inventory',inventory);emit(i,'plan',taskPlan(input,inventory,requirements[input.term]));
}
async function labels(i){
 const input=inp(i);
 for(const judge of [1,2]){
  const name=`source-labels-${judge}`;if(loadStage(i,name))continue;
  const result=await ask(i,name,LABEL_SCHEMA,`Independently interpret the actual researched Spanish occurrences in every source passage. No target candidates or trial translations are available. State meaning, grammar and a useful category (e.g. physical planet, realm, society, idiom; perceptible, emotional, feeling function; harmful, evil, inevitable, fated, deadly; named spiritual entity or ordinary adjective). Judge the headword itself, not a nearby word. Distinguish every materially different occurrence in meaningSpanish/category when there are several. Clear vs genuinely ambiguous vs insufficient: do not force a planet/realm distinction or lethal reading without evidence. Surrounding source context is evidence only. Return every id once.`,{term:input.term,dictionary:input.dictionary,passages:input.test.map(p=>({id:String(p.itemId),text:p.text,occurrences:p.occurrences,contextBefore:p.contextBefore,contextAfter:p.contextAfter}))},'source-label', 'medium');
  checkIds(result.items,input.test.map(p=>String(p.itemId)));emit(i,name,result.items);
 }
}
async function normalizeInventory(i){
 const input=inp(i),original=loadStage(i,'inventory-original')??loadStage(i,'inventory');
 if(loadStage(i,'construction-normalization'))return;
 const trigger=input.dictionary.status==='found'&&original.senses.some(s=>['designation','expression'].includes(s.kind));
 if(!trigger){emit(i,'construction-normalization',{activated:false,reason:'No ordinary-headword/compound conflation detected'});return;}
 const normalized=await ask(i,'headword-contribution',NORMALIZATION_SCHEMA,`Establish source meanings of the HEADWORD ITSELF, independently of target translations. The earlier inventory may confuse modifiers or subtypes with meanings of the headword. Normalize into operational lexical senses: separate genuine meanings and grammar, but a regular combination like mundo mental/astral/causal is not automatically a different meaning of mundo. What comes from the modifier stays in a construction record, not in the bare word. Likewise yo de la vanidad does not make vanidad mean an entire psychological aggregate; Cristo Íntimo does not make the adjective Íntimo mean the whole Christ designation. Retain legitimate idiomatic exceptions and the specialized standalone noun Íntimo. Do not merge genuinely different source meanings (e.g. harmful vs lethal, fated vs inevitable) simply to reduce size. No numerical sense cap. Account for EVERY original sense in mappings; nothing disappears silently. Each new operational sense needs supplied source evidence. Related studies should be independently lexical questions, not an automatic task for every modifier/subtype. If evidence is ambiguous preserve a named question, not an invented resolution.`,{term:input.term,dictionary:input.dictionary,originalInventory:original,sourceEvidence:input.research.slice(0,24).map(p=>({id:String(p.itemId),text:p.text}))});
 const oldIds=original.senses.map(s=>s.id),mapped=normalized.mappings.map(x=>x.originalSenseId);
 if(mapped.length!==oldIds.length||new Set(mapped).size!==oldIds.length||oldIds.some(id=>!mapped.includes(id)))throw Error('Normalization lost original meaning identities');
 // Grouping is a view, never a replacement for established source meanings.
 emit(i,'inventory-original',original);emit(i,'construction-normalization',{activated:true,...normalized,authority:'Advisory grouping; original inventory remains authoritative'});emit(i,'inventory',original);emit(i,'plan',taskPlan(input,original,requirements[input.term]));
 for(const name of ['provenance','proposal','audit','proposal-reviewed','research-complete']){const file=`${dir(i)}/${name}.json`;if(fs.existsSync(file))fs.renameSync(file,`${dir(i)}/${name}-before-normalization.json`);}
}
async function researchHTN(i){
 await source(i);await normalizeInventory(i);const input=inp(i),inventory=loadStage(i,'inventory'),plan=loadStage(i,'plan');
 const aliasProof=loadStage(i,'alias-proof')?.proof;
 if(aliasProof){for(const f of inventory.forms)if([aliasProof.observed.toLowerCase(),aliasProof.canonical.toLowerCase()].includes(f.form.toLowerCase())){f.include=true;f.relationship='spelling_variant';f.reasonSpanish='Identity verified by the independent numeric/unit/original-edition proof.';}emit(i,'inventory',inventory);}

 let provenance=loadStage(i,'provenance');
 if(!provenance){
  if(plan.find(x=>x.id==='verified-designation').status==='pending')provenance=await ask(i,'original-verification',PROVENANCE_SCHEMA,`Verify named designations against supplied original-edition passages. Map them only to appropriate source sense ids, distinguishing noun names from ordinary adjectives/definitions. Require direct quotation and contextual conceptual agreement; alignments and human requirements alone are not verification. Identify author/book and verified canonical spelling/plural. Never invent chronology, authorship, first coinage or expansions of M. A source quotation proves occurrence, not necessarily historical first use. If requested provenance/plural is not established, say unresolved.`,{inventory,authorPassages:input.research.slice(0,12).map(p=>({id:String(p.itemId),text:p.text})),originals:input.originals,supplement:read(`${run}/provenance-supplement.json`)?.[input.term]??null,requirements:requirements[input.term]});
  else provenance={verified:[],unresolved:[]};emit(i,'provenance',provenance);
 }
 provenance=sanitizeProvenance(input,inventory,provenance,read(`${run}/provenance-supplement.json`)?.[input.term]??{});emit(i,'provenance-sanitized',provenance);
 let proposal=loadStage(i,'proposal');
 if(!proposal){
  proposal=await ask(i,'sense-scoped-proposal',PROPOSAL_SCHEMA,`Build readable portable glossary entries for the HEADWORD, rendering only its contribution and preserving surrounding source modifiers. Do not add whole-compound source forms or targets unless the established sense is a genuine idiom and the scope explicitly says to render the whole idiom. Build readable portable glossary entries for each requested target language from the established Spanish meanings. Human project requirements below are authoritative wording constraints in their applicable meanings; keep ordinary senses separate. Prefer one natural target per operational meaning; add materially necessary collocation alternatives. Preserve all attested meanings including rare branches, with precise positive/negative selection scope. Do not replace a designation with its definition or another tradition's name. Canonical names remain unchanged and properly inflect by verified plural. Keep derivatives as proposed related studies. Every supplied meaning id must have a target, even if uncertain and flagged. Candidate dispositions must include every considered rejected/unknown wording with a specific reason. Explain opaque retained names separately in readerNote, without inserting explanations into translation body. Include verified originals/plurals as searchable forms alongside confirmed author variants. Never fabricate unverified forms. Notes in the requested target language; no 12-word cap that loses conditions. The first target is the default only within its scope; for mundo put planet/hành tinh first with the human priority and clear exclusions.`,{term:input.term,languages:input.languages,inventory,groupingSuggestion:loadStage(i,'construction-normalization'),provenance,humanRequirements:requirements[input.term],independentSourceContexts:input.research.slice(0,12).map(p=>({id:String(p.itemId),text:p.text}))});
  const grounded=groundProposal(inventory,proposal);emit(i,'excluded-unattested-targets',grounded.excluded);const binding=bindProposalForms(inventory,provenance,grounded.proposal);proposal=binding.proposal;emit(i,'proposal-form-binding',binding.changes);validateProposal(input,inventory,provenance,proposal);emit(i,'proposal',proposal);
 }
 let audit=loadStage(i,'audit');
 if(!audit){
  audit=await ask(i,'independent-candidate-audit',AUDIT_SCHEMA,`Independently check every candidate in every served meaning against source passages and human requirements. This entry matches the research headword/verified forms, not whole named compounds: a target must render the headword contribution without swallowing or duplicating surrounding source words. Do not bake modifiers into the bare default. For an idiom, scope may explicitly direct rendering the whole idiom with the component implicitly conveyed. Full compound targets require a separate measured phrase-entry study and cannot be silently mixed into this headword entry. Test reader comprehension of the actual meaning and constructed target parts: an archaic/rare dictionary sense of English sensible does not make perceptible readable. Check all senses, natural collocations, name vs definition, canonical spelling/plural, ordinary vs technical grammar, coverage of source forms and related-study obligations. Source discovery was independent; now candidate checks may use targets. Accept legitimate alternatives unless a human requirement prescribes wording. A consistent answer is not proof. Identify only evidence-supported repairs, not speculative extra research. Treat missing data as unknown; do not claim measured frequency.`,{input:{term:input.term,research:input.research.slice(0,18).map(p=>({id:String(p.itemId),text:p.text}))},inventory,groupingSuggestion:loadStage(i,'construction-normalization'),provenance,proposal,humanRequirements:requirements[input.term]});emit(i,'audit',audit);
 }
 if(audit.verdict==='repair'&&!loadStage(i,'proposal-reviewed')){
  const revised=await ask(i,'bounded-candidate-repair',PROPOSAL_SCHEMA,`Repair the specific independently evidenced issues. Preserve every established source sense id and verified source form; retain candidate disposition history. Meet human terminology requirements without projecting names onto ordinary adjectives or defining concepts. This is the single bounded research repair; unresolved conflicts remain explicit.`,{inventory,provenance,proposal,audit,requirements:requirements[input.term],languages:input.languages});const binding=bindProposalForms(inventory,provenance,revised);validateProposal(input,inventory,provenance,binding.proposal);emit(i,'proposal-reviewed',binding.proposal);emit(i,'reviewed-form-binding',binding.changes);proposal=binding.proposal;
 }else proposal=loadStage(i,'proposal-reviewed')??proposal;
 for(const l of input.languages){const saved=serializeEntry(input,inventory,provenance,proposal,l);write(`${dir(i)}/${method}/${l}/saved-glossary.json`,saved);}
 const updated=plan.map(t=>t.id==='verified-designation'?{...t,status:provenance.unresolved.length?'unknown':provenance.verified.length?'satisfied':t.status==='inapplicable'?'inapplicable':'unknown'}:['target-coverage','candidate-audit','delivery'].includes(t.id)?{...t,status:t.id==='candidate-audit'&&audit.verdict!=='pass'?'unknown':'satisfied'}:t);
 emit(i,'plan',updated);emit(i,'research-complete',{method,entrySignature:decisionSignature({inventory,provenance,proposal}),auditStatus:audit.verdict,provisional:true,unresolved:[...inventory.questions,...(loadStage(i,'construction-normalization')?.unresolved??[]),...provenance.unresolved,...proposal.languages.flatMap(l=>l.unresolved),...audit.unresolved]});
}
const gradeSchema=object({items:array(object({id:string,
 accuracyA:{type:'string',enum:['faithful','material_error','uncertain']},accuracyB:{type:'string',enum:['faithful','material_error','uncertain']},
 policyA:{type:'string',enum:['pass','fail','not_applicable','uncertain']},policyB:{type:'string',enum:['pass','fail','not_applicable','uncertain']},
 naturalnessA:{type:'string',enum:['natural','clear_problem','uncertain']},naturalnessB:{type:'string',enum:['natural','clear_problem','uncertain']},
 wholePassageA:{type:'string',enum:['faithful','material_error','uncertain']},wholePassageB:{type:'string',enum:['faithful','material_error','uncertain']},
 renderingA:string,renderingB:string,reason:string}))});
const gradeRubric=`Apply the fixed human requirements to the actual Spanish expression in context. Grade each side independently, even identical bad answers. Semantic adequacy, human project terminology/canonical spelling/reader comprehensibility, and naturalness are separate axes. For accuracy a materially wrong sense, lost defining condition, substantive invention, number/grammar mismatch or erasure is an error. Mere synonym preference cannot win. For policy apply the supplied human criteria in their actual scope; English world may convey a planet faithfully yet fail the explicit planet requirement. Hooltanpanas/Hasnamuss and Innermost are names; definitions may explain them but cannot replace required names. Ordinary adjective íntimo must not become a named divine entity. Interpret fatal from the source; do not infer death from mere harm/evil/inevitability. Distinguish sensory/perceptible from emotional/feeling uses of sensible. The specific plural project standard is Hasnamussen, even when another edition uses Hasnamusses. Accept genuine ambiguity and correct synonyms; don't invent labels or assume model agreement is truth. Source-only judgments are evidence, and disagreements remain visible. For wholePassage assess all meaning, numbers and content in the full translation, including unrelated changes; don't give glossary credit for fixing an unrelated draft error. In calibration only, renderingsOnly means A/B are candidate renderings of the named occurrence, so don't penalize omitted remainder of the passage. Quote the actual researched rendering and explain the criterion. No method identity, research, or previous grades is available.`;
function batches(passages,max=15){const result=[];let current=[],chars=0;for(const p of passages){if(current.length&&(current.length>=max||chars+p.text.length>14000)){result.push(current);current=[];chars=0;}current.push(p);chars+=p.text.length;}if(current.length)result.push(current);return result;}
async function translateSet(i,language,arm,passages,revision=method){
 const input=inp(i),out=`${dir(i)}/${revision}/${language}/${arm}.json`,prior=read(out);if(prior)return prior;
 const saved=arm==='htn'?read(`${dir(i)}/${revision}/${language}/saved-glossary.json`):null;
 if(arm==='htn'&&!saved)throw Error('Saved glossary not ready');
 const rows=[];const consumerRules=read(`${run}/${arg('consumer-rules','consumer-rules.json')}`).rules;
 for(const [batchIndex,batch] of batches(passages).entries()){
  const hints=arm==='htn'?batch.flatMap(p=>consumerHints(saved,p.text)):[];
  const dedup=[...new Map(hints.map(h=>[h.sourceTerm.toLowerCase(),h])).values()];
  const instructions=`Surrounding contextBefore/contextAfter, when provided, is source context only: use it to disambiguate, and translate only text. Translate each full Spanish source passage accurately and naturally into ${language==='en'?'English':'Vietnamese'}. Preserve source content, numbers, names and grammar. Do not add explanations, commentary, footnotes or beliefs to the main passage. Return each id once, full translation. ${arm==='htn'?consumerRules:''}`;
  const content={passages:sourcePacket(batch,arg('source-context','none')==='neighbors')};
  if(arm==='htn')content.glossary_info=dedup;
  if(arm==='human-hints-only')content.humanTerminologyRequirements=requirements[input.term];
  const partialFile=`${dir(i)}/${revision}/${language}/chunks/${arm}-${hash(content)}.json`;let result=read(partialFile);if(!result){result=await ask(i,`translate-${revision}-${language}-${arm}-${batchIndex}`,translationSchema,instructions,content,'translation','low');validateTranslations(result.items,content.passages);write(partialFile,result);}
  validateTranslations(result.items,content.passages);rows.push(...result.items);
 }
 checkIds(rows,passages.map(p=>String(p.itemId)));write(out,rows);return rows;
}
function compileLatest(i){
 const input=inp(i),inventory=loadStage(i,'inventory'),aliasProof=loadStage(i,'alias-proof')?.proof;
 if(aliasProof)for(const f of inventory.forms)if([aliasProof.observed.toLowerCase(),aliasProof.canonical.toLowerCase()].includes(f.form.toLowerCase())){f.include=true;f.relationship='spelling_variant';}
 const provenance=sanitizeProvenance(input,inventory,loadStage(i,'provenance'),read(`${run}/provenance-supplement.json`)?.[input.term]??{});
 const selected=loadStage(i,'selection-repair')?.proposal??loadStage(i,'proposal-reviewed')??loadStage(i,'proposal');const proposal=bindProposalForms(inventory,provenance,groundProposal(inventory,selected).proposal).proposal;
 for(const l of input.languages){let saved=serializeEntry(input,inventory,provenance,proposal,l);if(method==='htn-v4')saved=attachMandatoryConstraints(saved,requirements[input.term]);write(`${dir(i)}/${method}/${l}/saved-glossary.json`,saved);}
 emit(i,`compiled-${method}`,{entrySignature:decisionSignature({inventory,provenance,proposal}),sourceAliasProof:aliasProof??null,consumer:'Production Gnosis matching/hints/rules with subscription model',provisional:true});
}
async function translateHTN(i){
 const input=inp(i);for(const l of input.languages)for(const arm of ['no-glossary','human-hints-only','htn'])await translateSet(i,l,arm,input.test,arm==='htn'?method:(arg('source-context','none')==='neighbors'?'context-baseline':'htn-v1'));
}

async function grade(i,stage,packets){
 const rows=[];for(let at=0;at<packets.length;at+=8){const batch=packets.slice(at,at+8);const result=await ask(i,stage+'-'+at,gradeSchema,gradeRubric,batch,'judge','medium');checkIds(result.items,batch.map(x=>x.id));rows.push(...result.items);}return rows;
}
async function calibrateHTN(){
 const controls=read(`${run}/assessment-only/controls.json`),file=`${run}/calibration.json`;if(read(file))return;
 const rows=await grade(1,'domain-calibration',controls.map(c=>c.packet)),failures=[];
 for(const c of controls){const row=rows.find(r=>r.id===c.packet.id);for(const [field,v] of Object.entries(c.expected))if(row[field]!==v)failures.push({id:c.packet.id,case:c.case,field,expected:v,actual:row[field],reason:row.reason});}
 write(file,{presentations:rows.length,passed:!failures.length,failures,rows,limitation:'Model evaluator sensitivity checks; no claim of human validation or glossary quality.'});
}
async function evaluateHTN(i,role='all',revision=method){
 const input=inp(i),selected=input.test.filter(p=>role==='all'||p.role===role),firstLabels=loadStage(i,'source-labels-1'),secondLabels=loadStage(i,'source-labels-2');
 if(!firstLabels||!secondLabels)throw Error('Two source-only labels required');
 const calibration=read(`${run}/calibration.json`);if(!calibration?.passed)throw Error('Calibrated evaluator required before acceptance');
 for(const l of input.languages){
  const baselineVersion=arg('source-context','none')==='neighbors'?'context-baseline':'htn-v1';const baseline=await translateSet(i,l,'no-glossary',input.test,baselineVersion);
  for(const arm of arg('arms','human-hints-only,htn').split(',')){if(!['human-hints-only','htn'].includes(arm))throw Error('Unknown evaluation arm');
   const file=`${dir(i)}/${revision}/${l}/${arm}-assessment-${role}.json`;if(read(file))continue;
   const candidate=await translateSet(i,l,arm,input.test,arm==='htn'?revision:baselineVersion),b=new Map(baseline.map(r=>[r.id,r.translation])),c=new Map(candidate.map(r=>[r.id,r.translation]));
   const pairs=selected.map(p=>blindPair({id:String(p.itemId),text:p.text},b.get(String(p.itemId)),c.get(String(p.itemId)),`htn:${i}:${l}:${arm}:${revision}`));
   const packet=pair=>({...pair.public,term:input.term,language:l,criteria:requirements[input.term],sourceContext:arg('source-context','none')==='neighbors'?{before:input.test.find(p=>String(p.itemId)===pair.public.id).contextBefore,after:input.test.find(p=>String(p.itemId)===pair.public.id).contextAfter}:null,sourceJudgments:[firstLabels.find(x=>x.id===pair.public.id),secondLabels.find(x=>x.id===pair.public.id)]});
   const first=await grade(i,`grade-${revision}-${l}-${arm}-${role}`,pairs.map(packet));
   const rows=first.map(r=>({...r,candidateSide:pairs.find(p=>p.public.id===r.id).candidateSide}));
   const changed=rows.filter(r=>['accuracy','policy','naturalness'].some(dim=>selectionEffect(r,dim))||r.wholePassageA!==r.wholePassageB);
   const seconds=changed.map(r=>{const p=selected.find(p=>String(p.itemId)===r.id);return blindPair({id:r.id,text:p.text},b.get(r.id),c.get(r.id),`htn-confirm:${i}:${l}:${arm}:${revision}`);});
   const again=await grade(i,`confirm-${revision}-${l}-${arm}-${role}`,seconds.map(packet));
   const confirmed=rows.map(r=>{const s=again.find(s=>s.id===r.id);const second=s?{...s,candidateSide:seconds.find(p=>p.public.id===r.id).candidateSide}:null;return {id:r.id,first:r,second,effects:Object.fromEntries(['accuracy','policy','naturalness'].map(dim=>[dim,second&&selectionEffect(r,dim)===selectionEffect(second,dim)?selectionEffect(r,dim):0]))};});
   write(file,confirmed);
  }
 }
}
async function repairHTN(i){
 const input=inp(i),inventory=loadStage(i,'inventory'),provenance=loadStage(i,'provenance-sanitized')??loadStage(i,'provenance'),proposal=loadStage(i,'proposal-reviewed')??loadStage(i,'proposal');
 let repairedMatching=false;
 if(provenance.verified.length&&inventory.forms.some(f=>f.include&&f.relationship==='unknown')&&!loadStage(i,'alias-proof')&&!loadStage(i,'alias-resolution')){
  const dev=input.test.filter(p=>p.role==='development');
  const resolved=await ask(i,'alias-identity-after-originals',ALIAS_SCHEMA,`Resolve source-form identity after reading original-book evidence. The initial source-only stage could not link unknown author spellings to the original designation. Confirm or reject each supplied unknown candidate from actual author passages and originals. Borrowing can adapt a definition or taxonomy; require identity of the distinctive concept/name, not equality of every doctrinal detail. Fuzzy spelling and the human requirement alone are not proof. Distinguish inflections/spelling variants from adjective derivatives and unrelated names. Explicit pronunciation guidance is evidence for a phonetic alias. Keep canonical original spelling searchable even if zero author hits; never claim it is author-attested without a passage. Quote concrete distinguishing evidence. This is one bounded matching repair, not a new dictionary or frequency study.`,{term:input.term,inventory,originals:input.originals,supplement:read(`${run}/provenance-supplement.json`)?.[input.term],authorPassages:[...input.research.slice(0,16),...dev].map(p=>({id:String(p.itemId),text:p.text})),candidateForms:input.candidateForms});
  const known=new Set(input.candidateForms.map(x=>x.toLowerCase()));if(resolved.forms.some(f=>!known.has(f.form.toLowerCase())))throw Error('Alias repair invented a form');
  for(const f of resolved.forms){const old=inventory.forms.find(x=>x.form.toLowerCase()===f.form.toLowerCase());if(old)Object.assign(old,f);else inventory.forms.push(f);}
  emit(i,'alias-resolution',resolved);emit(i,'inventory-pre-alias-repair',loadStage(i,'inventory'));emit(i,'inventory',inventory);repairedMatching=true;
 }
 // Reuse source-only development judgments, not trial output, to preserve a newly uncovered meaning.
 if(i===2&&!inventory.senses.some(s=>s.id==='sensible.afectivo_experiencial')){
  const p=input.test.find(p=>p.role==='development'&&p.text.includes('amor sensible'));
  if(p){const labels=[loadStage(i,'source-labels-1').find(x=>x.id===String(p.itemId)),loadStage(i,'source-labels-2').find(x=>x.id===String(p.itemId))];
   inventory.senses.push({id:'sensible.afectivo_experiencial',definitionSpanish:'En el amor y afectos: dependiente de sentimientos y consuelos experimentados, no limitado a los cinco sentidos físicos.',grammar:'adjetivo aplicado a amor/afecto',kind:'ordinary',evidenceIds:[String(p.itemId)],boundariesSpanish:'No confundir con percepción física ni con impresionabilidad de una persona.'});
   emit(i,'source-refinement',{basis:'Actual development source plus two independent source-only judgments made before trial translations',sourceId:p.itemId,source:p.text,sourceJudgments:labels,newSenseId:'sensible.afectivo_experiencial',confirmationExposed:false,confidence:'Provisional contextual interpretation; human review remains required'});emit(i,'inventory',inventory);
  }
 }
 const failures=[];
 for(const l of input.languages){const rows=read(`${dir(i)}/htn-v2/${l}/htn-assessment-development.json`);if(!rows)throw Error('Development assessment required before repairs');
 for(const r of rows)if(['accuracy','policy','naturalness'].some(dim=>r.first[dim+r.first.candidateSide]===(dim==='accuracy'?'material_error':dim==='policy'?'fail':'clear_problem'))){const p=input.test.find(p=>String(p.itemId)===r.id);failures.push({language:l,source:p.text,actualTranslation:read(`${dir(i)}/htn-v2/${l}/htn.json`).find(t=>t.id===r.id).translation,diagnostic:r.first.reason});}}
 if(repairedMatching){const fixed=bindProposalForms(inventory,provenance,proposal).proposal;for(const l of input.languages)write(`${dir(i)}/htn-v3/${l}/saved-glossary.json`,serializeEntry(input,inventory,provenance,fixed,l));emit(i,'selection-repair',{activated:true,kind:'matching-and-verified-inflection',failures:failures.length,confirmationUsed:false});return;}
 if(!failures.length){for(const l of input.languages)write(`${dir(i)}/htn-v3/${l}/saved-glossary.json`,read(`${dir(i)}/htn-v2/${l}/saved-glossary.json`));emit(i,'selection-repair',{activated:false,reason:'No measured development failures; confirmation remains reserved'});return;}
 if(loadStage(i,'selection-repair'))return;
 let revised=await ask(i,'selection-repair-development-only',PROPOSAL_SCHEMA,`Repair only measured translation selection failures in these development passages. Entry changes must concern this headword or necessary grammar; unrelated full-passage defects (such as a standalone English pronoun elsewhere) belong in the report and must not produce glossary notes or new research steps. The established original meanings and human requirements stay fixed; the supplied inventory may additionally contain a source-supported meaning discovered from development evidence. Cover it alongside every original meaning. Investigate whether condition wording/order/scope caused failure. Preserve all sense ids and verified forms/names/provenance. Do not invent meanings or force a term across incompatible contexts. Test notes/order first; phrase entries are not permitted without a component-only comparison. This is the single allowed consumer repair round. No confirmation passages or translations are provided. Keep unresolved conflicts visible.`,{inventory,provenance,proposal,languages:input.languages,humanRequirements:requirements[input.term],failures});
 revised=bindProposalForms(inventory,provenance,revised).proposal;validateProposal(input,inventory,provenance,revised);
 for(const l of input.languages)write(`${dir(i)}/htn-v3/${l}/saved-glossary.json`,serializeEntry(input,inventory,provenance,revised,l));
 emit(i,'selection-repair',{activated:true,failures:failures.length,proposal:revised,confirmationUsed:false});
}

async function pool(items,fn){let at=0;return Promise.all(Array.from({length:Math.min(workers,items.length)},async()=>{while(at<items.length){const i=items[at++];try{await fn(i);}catch(e){write(`${dir(i)}/failure-${phase}-${method}.json`,{message:e.message,at:new Date().toISOString()});console.error(JSON.stringify({term:inp(i).term,phase,error:e.message}));}}}));}
try{
 const auth=spawnSync('codex',['login','status'],{encoding:'utf8'});if(!`${auth.stdout}${auth.stderr}`.includes('Logged in using ChatGPT'))throw Error('ChatGPT subscription required');
 if(phase==='source')await pool(indices,source);
 else if(phase==='labels')await pool(indices,labels);
 else if(phase==='research')await pool(indices,researchHTN);
 else if(phase==='compile')await pool(indices,compileLatest);
 else if(phase==='translate')await pool(indices,translateHTN);
 else if(phase==='calibrate')await calibrateHTN();
 else if(phase==='evaluate')await pool(indices,i=>evaluateHTN(i,arg('role','development'),method));
 else if(phase==='repair')await pool(indices,repairHTN);
 else throw Error('Phase not implemented yet: '+phase);
}finally{if(worker)worker.stdin.end();}
