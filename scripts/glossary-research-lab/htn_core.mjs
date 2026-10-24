/** Bounded, evidence-driven HTN prototype. Planning and delivery are deterministic. */
import {hash} from './protocol.mjs';
import {buildEditorGlossaryModel,buildEditorAiTranslationGlossaryHints} from '../../src-ui/app/editor-glossary-highlighting.js';
export const POLICY=Object.freeze({version:'htn-v1',maxResearchCallsPerWord:6,maxRepairRounds:1,maxOriginalBooks:3,initialFullContexts:12,scoutWindows:160});
const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const s={type:'string'},a=items=>({type:'array',items}),b={type:'boolean'};
export const INVENTORY_SCHEMA=obj({senses:a(obj({id:s,definitionSpanish:s,grammar:s,kind:{type:'string',enum:['ordinary','designation','expression']},evidenceIds:a(s),boundariesSpanish:s})),forms:a(obj({form:s,include:b,relationship:{type:'string',enum:['same_lemma','spelling_variant','derived','unrelated','unknown']},reasonSpanish:s})),relatedStudies:a(obj({term:s,reasonSpanish:s})),questions:a(s)});
export const NORMALIZATION_SCHEMA=obj({inventory:INVENTORY_SCHEMA,mappings:a(obj({originalSenseId:s,baseSenseIds:a(s),modifierContributionSpanish:s,reasonSpanish:s})),unresolved:a(s)});
export const PROVENANCE_SCHEMA=obj({verified:a(obj({senseIds:a(s),name:s,plural:s,author:s,book:s,evidenceQuote:s,basis:s})),unresolved:a(s)});
export const PROPOSAL_SCHEMA=obj({languages:a(obj({language:s,variants:a(obj({id:s,senseIds:a(s),target:s,scope:s,readerNote:s,kind:{type:'string',enum:['designation','translation']}})),generalNote:s,sourceForms:a(s),unresolved:a(s)})),candidateDispositions:a(obj({target:s,language:s,senseIds:a(s),disposition:{type:'string',enum:['kept','rejected','unknown']},reason:s}))});
export const ALIAS_SCHEMA=obj({forms:a(obj({form:s,include:b,relationship:{type:'string',enum:['same_lemma','spelling_variant','derived','unrelated','unknown']},evidenceQuote:s,reasonSpanish:s})),unresolved:a(s)});
export const AUDIT_SCHEMA=obj({verdict:{type:'string',enum:['pass','repair','unknown']},issues:a(obj({language:s,senseIds:a(s),kind:{type:'string',enum:['meaning','name_definition','false_friend','scope','human_requirement','missing_form','provenance','readability']},evidence:s,repair:s})),unresolved:a(s)});
export const LABEL_SCHEMA=obj({items:a(obj({id:s,meaningSpanish:s,grammar:s,category:s,certainty:{type:'string',enum:['clear','ambiguous','insufficient']},reason:s}))});
export function taskPlan(input,inventory,requirements){
 const named=inventory.senses.some(x=>x.kind==='designation');
 const provenance=input.originals.some(x=>x.passages.length)||(named&&input.dictionary.status!=='found')||/Gurdjieff|Dayspring/.test(requirements);
 const lexical=inventory.senses.length>1||inventory.relatedStudies.length>0||inventory.senses.some(x=>x.kind==='expression');
 return [{id:'spelling-recall',method:'always-discover-and-confirm-aliases',status:'pending',reason:'Exact hits do not establish complete spelling coverage; candidates require identity verification'},
  {id:'source-meanings',method:'independent-source-inventory',status:'satisfied',evidence:'inventory'},
  {id:'verified-designation',method:'bounded-original-verification',status:provenance?'pending':'inapplicable',reason:provenance?'Original evidence, named concept or human provenance requirement':'No naming/provenance obligation identified'},
  {id:'target-coverage',method:'sense-scoped-candidates',status:'pending'},
  {id:'independent-open-reading',method:'unframed-source-interpretation',status:'satisfied',evidence:'source-only inventory before targets'},
  {id:'candidate-audit',method:'independent-all-candidate-check',status:'pending',lexicalRisk:lexical},
  {id:'source-frequency',method:'full-measurement',status:'unknown',reason:'Not replaced/retired by this pilot; applicability and legacy cost reported'},
  {id:'target-frequency',method:'full-measurement',status:'unknown',reason:'Reader comprehension audit is experimental, not measured frequency equivalence'},
  {id:'counts-two-judges',method:'full-measurement',status:'unknown',reason:'Translation selection is tested independently; preference counting not claimed'},
  {id:'human-review',method:'review-delivered-entry',status:'pending'},
  {id:'delivery',method:'serialize-and-match-production-hints',status:'pending'},
  {id:'actual-selection',method:'development-then-reserved-confirmation',status:'pending'}];
}
export function validateInventory(input,inventory){
 const ids=new Set([...input.research,...input.test].map(p=>String(p.itemId))),senseIds=new Set();
 for(const sense of inventory.senses){if(!sense.id||senseIds.has(sense.id))throw Error('Sense identity must be unique');senseIds.add(sense.id);if(!sense.evidenceIds.length||sense.evidenceIds.some(id=>!ids.has(id)))throw Error('Unattested or invented sense evidence');}
 const known=new Set(input.candidateForms.map(x=>x.toLowerCase()));
 for(const f of inventory.forms)if(f.include&&!known.has(f.form.toLowerCase())&&!input.research.some(p=>p.text.toLowerCase().includes(f.form.toLowerCase())))throw Error('Invented included form');
 if(!senseIds.size)throw Error('Empty source inventory');
 return true;
}

/** The ledger owns source identity; model proposal prose cannot add/drop aliases. */
export function sanitizeProvenance(input,inventory,record,supplement={}){
 const clean=structuredClone(record),ids=new Set(inventory.senses.map(s=>s.id));
 const texts=[...input.originals.flatMap(x=>x.passages.map(p=>p.text)),supplement.quote??''];
 const observed=word=>word&&texts.some(t=>String(t).toLowerCase().includes(word.toLowerCase()));
 const kept=[];
 for(const p of clean.verified){
  if(!observed(p.name)||p.senseIds.some(id=>!ids.has(id))){clean.unresolved.push(`Unverified designation record excluded: ${p.name}`);continue;}
  if(p.plural&&!observed(p.plural)){clean.unresolved.push(`Plural not verified in supplied witnesses: ${p.plural}`);p.plural='';}
  kept.push(p);
 }
 clean.verified=kept;return clean;
}
export function bindProposalForms(inventory,provenance,proposal){
 const fixed=structuredClone(proposal),knownSourceForms=new Set(inventory.forms.map(f=>f.form.toLowerCase())),forms=[...new Set([...inventory.forms.filter(f=>f.include&&['same_lemma','spelling_variant'].includes(f.relationship)).map(f=>f.form),...provenance.verified.flatMap(p=>[p.name,p.plural].filter(x=>x&&knownSourceForms.has(x.toLowerCase())))])];
 const changes=[];
 for(const l of fixed.languages){
  l.sourceForms??=[];const omitted=forms.filter(f=>!l.sourceForms.some(x=>x.toLowerCase()===f.toLowerCase()));
  const unauthorized=l.sourceForms.filter(f=>!forms.some(x=>x.toLowerCase()===f.toLowerCase()));
  if(omitted.length||unauthorized.length)changes.push({language:l.language,restoredVerifiedForms:omitted,excludedUnverifiedForms:unauthorized});
  l.sourceForms=[...forms];
 }
 return {proposal:fixed,changes};
}

export function proposalSchemaFor(input,inventory){
 const schema=JSON.parse(JSON.stringify(PROPOSAL_SCHEMA)),language=schema.properties.languages.items;
 schema.properties.languages.minItems=input.languages.length;schema.properties.languages.maxItems=input.languages.length;
 language.properties.language.enum=input.languages;
 language.properties.variants.items.properties.senseIds.items.enum=inventory.senses.map(s=>s.id);
 language.properties.variants.items.properties.senseIds.minItems=1;
 language.properties.sourceForms.maxItems=0;
 schema.properties.candidateDispositions.items.properties.senseIds.items.enum=inventory.senses.map(s=>s.id);
 return schema;
}
export function groundProposal(inventory,proposal){
 const known=new Set(inventory.senses.map(s=>s.id)),fixed=structuredClone(proposal),excluded=[];
 for(const l of fixed.languages){
  l.variants=l.variants.filter(v=>{const missing=v.senseIds.filter(id=>!known.has(id));if(!missing.length)return true;excluded.push({language:l.language,target:v.target,unknownSenseIds:missing,reason:'Unbound/unattested sense cannot enter the delivered author-corpus entry'});l.unresolved.push(`Target kept only in research record pending source attestation: ${v.target} (${missing.join(', ')})`);return false;});
 }
 return {proposal:fixed,excluded};
}

export function validateProposal(input,inventory,provenance,proposal){
 const ids=new Set(inventory.senses.map(s=>s.id)),knownForms=new Set([...inventory.forms.filter(f=>f.include&&['same_lemma','spelling_variant'].includes(f.relationship)).map(f=>f.form.toLowerCase()),...provenance.verified.flatMap(p=>[p.name,p.plural].filter(Boolean).map(x=>x.toLowerCase()))]);
 if(proposal.languages.length!==input.languages.length||new Set(proposal.languages.map(l=>l.language)).size!==input.languages.length)throw Error('Missing/repeated target language');
 const missing=[];
 for(const l of proposal.languages){
  if(!input.languages.includes(l.language))throw Error('Unrequested language');
  if(l.sourceForms.some(x=>!knownForms.has(x.toLowerCase())))throw Error('Unverified source form');
  for(const v of l.variants)if(!v.senseIds.length||v.senseIds.some(id=>!ids.has(id)))throw Error('Unknown target sense identity');
  for(const id of ids)if(!l.variants.some(v=>v.senseIds.includes(id)))missing.push({language:l.language,senseId:id});
 }
 if(missing.length)throw Error('Lost meanings: '+JSON.stringify(missing));
 return true;
}
export function serializeEntry(input,inventory,provenance,proposal,language){
 validateProposal(input,inventory,provenance,proposal);
 const l=structuredClone(proposal.languages.find(l=>l.language===language));
 for(const p of provenance.verified)if(p.plural&&l.variants.some(v=>v.target.toLowerCase()===p.name.toLowerCase())&&!l.variants.some(v=>v.target.toLowerCase()===p.plural.toLowerCase())){const ids=[...new Set(l.variants.filter(v=>v.target.toLowerCase()===p.name.toLowerCase()).flatMap(v=>v.senseIds))];l.variants.push({id:'verified-plural-'+p.name,senseIds:ids,target:p.plural,scope:'Use for genuinely plural referents, from source grammar/context. A source spelling ending in -en can still refer to one person; do not choose plural from spelling alone.',readerNote:'',kind:'designation'});}
 const senses=new Map(inventory.senses.map(s=>[s.id,s]));
 const derived=[...new Set(inventory.forms.filter(f=>f.relationship==='derived').map(f=>f.form))];
 const boundaries=derived.length?`These choices serve the standalone lemma, not an automatic rendering inside derived forms: ${derived.join(', ')}. Those words require their own whole-word interpretation/study.`:'';
 const origin=provenance.verified.map(p=>`Verified designation: ${p.name}${p.plural?'; plural '+p.plural:''}. Source: ${p.author}, ${p.book}. ${p.basis}`).join('\n');
 const fields={termId:`htn-${input.index}-${language}`,sourceTerms:l.sourceForms,targetTerms:l.variants.map(v=>v.target),targetVariantNotes:l.variants.map(v=>v.scope),notesToTranslators:[l.generalNote,boundaries,origin].filter(Boolean).join('\n'),footnote:[...new Set(l.variants.map(v=>v.readerNote).filter(Boolean))].join('\n')};
 return {sourceLanguage:{code:'es'},targetLanguage:{code:language},terms:[fields]};
}
export function consumerHints(saved,source){
 const model=buildEditorGlossaryModel(JSON.parse(JSON.stringify(saved)));
 return buildEditorAiTranslationGlossaryHints(source,'es',saved.targetLanguage.code,model).map(({notes,...h})=>h);
}
export function decisionSignature(packet){return hash({version:POLICY.version,...packet});}
export function allowRepair({round,issues,newEvidence}){return round<POLICY.maxRepairRounds&&issues.length>0&&Boolean(newEvidence);}
export function selectionEffect(row,dim){const side=row.candidateSide,other=side==='A'?'B':'A';const good=dim==='accuracy'?'faithful':dim==='policy'?'pass':'natural',bad=dim==='accuracy'?'material_error':dim==='policy'?'fail':'clear_problem';return row[dim+side]===good&&row[dim+other]===bad?1:row[dim+side]===bad&&row[dim+other]===good?-1:0;}

export function translationSchemaFor(passages){
 return {type:'object',additionalProperties:false,required:['items'],properties:{items:{type:'array',minItems:passages.length,maxItems:passages.length,items:{type:'object',additionalProperties:false,required:['id','translation'],properties:{id:{type:'string',enum:passages.map(p=>p.id)},translation:{type:'string'}}}}}};
}
export function validateTranslations(rows,passages){
 const ids=rows.map(r=>r.id),expected=passages.map(p=>p.id);
 if(ids.length!==expected.length||new Set(ids).size!==ids.length||expected.some(id=>!ids.includes(id)))throw Error('Incomplete or duplicate translation output');
 if(rows.some(r=>r.translation===r.id))throw Error('Translation is an ID placeholder, not source content');
 return true;
}

export function attachMandatoryConstraints(saved,requirements){
 const result=structuredClone(saved),prefix='MANDATORY PROJECT CONSTRAINTS, overriding any conflicting generic or construction note: ';
 for(const term of result.terms)term.notesToTranslators=prefix+requirements+'\n'+term.notesToTranslators;
 return result;
}
/** A witnessed collocation cannot override the lexical sense established in this context. */
export function attachSelectionContract(saved){
 const result=structuredClone(saved);
 const rule='SELECTION CONTRACT: Establish the word\'s meaning from the full source context before choosing a target. A construction or collocation note describes a usual reading, not an unconditional rule for every occurrence with that noun. Explicitly established defining consequences in the source take precedence over a construction\'s usual association. Select the supported lexical branch matching those consequences. Witness examples are evidence, not a restriction to that one example. Preserve genuine names and idioms as names and idioms.';
 for(const term of result.terms)term.notesToTranslators=rule+'\n'+term.notesToTranslators;
 return result;
}
export function sourcePacket(passages,withNeighbors=false){
 return passages.map(p=>({id:String(p.itemId),text:p.text,...(withNeighbors?{contextBefore:structuredClone(p.contextBefore??[]),contextAfter:structuredClone(p.contextAfter??[])}:{})}));
}
export function applyUsagePatch(saved,patch,evidence){
 const result=structuredClone(saved),term=result.terms[0],n=term.targetTerms.length;
 if(patch.order.length!==n||new Set(patch.order).size!==n||patch.order.some(i=>!Number.isInteger(i)||i<0||i>=n))throw Error('Order must preserve every target exactly once');
 const seen=new Set();
 for(const edit of patch.variantNotes){
  if(!Number.isInteger(edit.index)||edit.index<0||edit.index>=n||seen.has(edit.index))throw Error('Invalid/repeated note index');seen.add(edit.index);
  if(!evidence.some(p=>String(p.itemId)===edit.evidenceId&&p.text.includes(edit.quote)&&edit.quote.trim().length>0))throw Error('Note repair lacks an actual supplied source quote');
  term.targetVariantNotes[edit.index]=edit.note;
 }
 if(patch.additionalGeneralNote){
  if(!patch.generalEvidence.some(e=>evidence.some(p=>String(p.itemId)===e.evidenceId&&p.text.includes(e.quote)&&e.quote.trim().length>0)))throw Error('General note repair lacks actual evidence');
  term.notesToTranslators=patch.additionalGeneralNote+'\n'+term.notesToTranslators;
 }
 const targets=[...term.targetTerms],notes=[...term.targetVariantNotes];term.targetTerms=patch.order.map(i=>targets[i]);term.targetVariantNotes=patch.order.map(i=>notes[i]);
 return result;
}
export function sortByUsage(saved,counts){
 const result=structuredClone(saved),term=result.terms[0];
 if(counts.length!==term.targetTerms.length||counts.some(n=>!Number.isFinite(n)||n<0))throw Error('Frequency counts must account for every retained target');
 const byText=new Map();term.targetTerms.forEach((text,index)=>byText.set(text,(byText.get(text)??0)+counts[index]));
 const effectiveCounts=term.targetTerms.map(text=>byText.get(text));
 const order=effectiveCounts.map((count,index)=>({count,index})).sort((a,b)=>b.count-a.count||a.index-b.index).map(r=>r.index);
 const targets=[...term.targetTerms],notes=[...term.targetVariantNotes];term.targetTerms=order.map(i=>targets[i]);term.targetVariantNotes=order.map(i=>notes[i]);
 return {saved:result,order,counts:order.map(i=>effectiveCounts[i])};
}
export function suppliedEvidence(value){
 const out=new Map();
 function walk(v){if(!v||typeof v!=='object')return;if(!Array.isArray(v)){const id=v.itemId??v.item_id??v.paragraph_id;if(id!=null&&typeof v.text==='string'){out.set(String(id),{itemId:String(id),text:v.text,...v});for(const [side,texts] of [['before',v.contextBefore??v.context_before??[]],['after',v.contextAfter??v.context_after??[]]])for(const [n,text] of texts.entries())if(typeof text==='string')out.set(`${id}:${side}:${n}`,{itemId:`${id}:${side}:${n}`,text});}}for(const child of Object.values(v))if(child&&typeof child==='object')walk(child);}
 walk(value);return [...out.values()];
}
export function evidenceQuoteSupported(quote,texts,ids=[]){
 const normalize=s=>s.normalize('NFC').toLowerCase().replace(/[«»“”]/g,'"').replace(/[‘’]/g,"'").replace(/\s+/g,' ').trim();
 const sources=texts.map(normalize),q=String(quote).trim();if(!q)return false;
 const direct=x=>sources.some(s=>s.includes(normalize(x))||(/[.!?]$/.test(x)&&s.includes(normalize(x.slice(0,-1)))));
 if(direct(q))return true;
 let cleaned=q;for(const id of ids)cleaned=cleaned.replaceAll(String(id)+':','');
 let parts=[cleaned];
 const quoted=[...cleaned.matchAll(/«([^»]+)»|“([^”]+)”/g)];
 if(quoted.length&&cleaned.replace(/«[^»]+»|“[^”]+”/g,'').match(/^[\s;,.!?]*$/))parts=quoted.map(m=>m[1]??m[2]);
 else if((q.startsWith('«')&&q.endsWith('»'))||(q.startsWith('“')&&q.endsWith('”'))||(q.startsWith('(')&&q.endsWith(')')))parts=[q.slice(1,-1)];
 parts=parts.flatMap(p=>p.split(/\[\s*…\s*\]|\[\s*\.\.\.\s*\]|\s…\s/)).map(p=>p.trim()).filter(Boolean);
 return parts.length>0&&parts.every(direct);
}
