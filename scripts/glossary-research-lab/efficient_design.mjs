/** One research artifact; two projections test whether candidate wording loses meaning. */
import {hash} from './protocol.mjs';
import {passageExcluded} from './adaptive.mjs';
const s={type:'string'},a=items=>({type:'array',items}),o=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const DESIGN=Object.freeze({version:'meaning-contract-v1',fullContexts:12,windows:192,windowRadius:170,maxCharacters:75000,researchCalls:1});
export const SCHEMA=o({meanings:a(o({id:s,sourceForms:a(s),grammar:s,definitionSpanish:s,selectionSpanish:s,
 contrastSpanish:s,ordinaryDictionaryOnly:{type:'boolean'},evidenceIds:a(s),
 targets:a(o({language:s,wording:s,selectionNote:s})),canonicalName:s,canonicalBasis:s})),
 preferenceSpanish:s,provenanceSpanish:s,uncertainties:a(s)});
export const INSTRUCTIONS=`Build a portable Spanish-source terminology guide from raw evidence. This is one integrated meaning and wording task, not a succession of votes or audits. No expected meanings, human targets or earlier outputs are provided.
Infer operational meanings from the author's examples, definitions and contrasts: what motive, relationship, property or function makes an example belong to this meaning? Distinguish that invariant from an incidental action or co-occurring attitude. Opposite outward actions can instantiate one motive. State each materially different meaning in plain Spanish before choosing target wording. A broad approving/disapproving label is not an adequate replacement for a precise meaning.
Keep ordinary dictionary meanings and grammatical uses as clearly marked branches even when a small domain sample does not show them. Specialized senses require corpus or source-book evidence. Separate a standalone headword's meanings from those introduced by modifiers or a fixed expression. Do not mistake this deliberately varied sample for a frequency measurement. Prefer the most specific independently established domain interpretation when coherent with a future source; preserve explicit alternatives where it conflicts with the source, especially categories containing members outside a proposed subtype and idiomatic expressions. Describe evidence-based selection boundaries, not conditions requiring an explicit confirming synonym in every sentence. Never invent a hierarchy if the evidence cannot establish one.
Preserve lexical labels in comparisons and explanations: a thing, its definition, a synonym and another system's name are not the same name. Distinguish ordinary adjectives from technical nouns by syntax and meaning, not capitalization alone. An established proper/technical designation remains a name, with its definition in the note. Source-book original words are fallible evidence: distinguish printed pairs, machine alignment and matching original passages; do not assert first coinage, exclusive origin or direct borrowing without proof. Never expand initials. Accept a spelling correction only when the source definition and original edition identify the same named referent; preserve the observed source form for searching.
For each requested target language, use concise natural contemporary wording that actually communicates the operational definition. If no short word conveys it, use a natural phrase instead of silently discarding the defining distinction. Mentally interpret each word or compound part as an ordinary reader would: a familiar look-alike or a dictionary-listed archaic sense is not proof that readers understand the required meaning. Do not substitute a calque, related attitude or dictionary synonym that loses the condition. Scope every suggested target to its meaning; do not group allegedly interchangeable words or discard one without contextual evidence. Give one preferred wording per materially distinct meaning, with additional meanings as separate cards. Record genuine unresolved comprehension/evidence questions.
Source forms must be supplied or literally attested in the provided passages. evidenceIds must be provided corpus ids (empty for dictionary-only meanings). canonicalName is empty unless the evidence verifies a name; canonicalBasis identifies that evidence. All explanatory fields are Spanish. Target wording and its concise selection note are in the requested target language. Never put commentary inside a searchable source form. Avoid redundant fixed-expression entries when the component meanings compose naturally.`;
export function payload(e,source,languages){
 const all=[...new Map(e.research.map(p=>[hash(p.text),p])).values()];
 const independent=all.filter(p=>!passageExcluded(p,e.evaluation??[]));
 const sparseOverlap=!independent.length&&(e.population?.distinct??all.length)<=(e.evaluation?.length??0);
 const pool=sparseOverlap?all:independent;
 const full=[];let chars=0;
 for(const p of pool){if(full.length===DESIGN.fullContexts)break;if(chars+p.text.length>24000)continue;full.push({id:String(p.itemId),text:p.text,reference:p.reference?.title??''});chars+=p.text.length;}
 const windows=pool.slice().sort((x,y)=>hash(x.text).localeCompare(hash(y.text))).slice(0,DESIGN.windows).map(p=>({id:String(p.itemId),reference:p.reference?.title??'',
  text:(p.occurrences?.length?p.occurrences.slice(0,2).map(occ=>p.text.slice(Math.max(0,occ.start-DESIGN.windowRadius),Math.min(p.text.length,occ.end+DESIGN.windowRadius))).join(' … '):p.text.slice(0,340))}));
 const value={term:e.term,corpusForms:e.forms,targetLanguages:languages,population:e.population,fullPassages:full,sourceWindows:windows,
  sourceDictionary:source.dictionary??'',sourceProvenance:source.sourceProvenance??[],spellingEvidence:source.spellingEvidence??null,
  acquisitionFailures:source.failures??[],coverage:{available:pool.length,full:full.length,windows:windows.length,truncated:pool.length>windows.length,
   excludedHoldoutLocations:all.length-independent.length,sparseOverlap}};
 while(JSON.stringify(value).length>DESIGN.maxCharacters&&value.sourceWindows.length)value.sourceWindows.pop();
 value.coverage.windows=value.sourceWindows.length;value.coverage.truncated=pool.length>value.sourceWindows.length;
 return value;
}
export function validateContract(answer,input){
 const ids=new Set(),evidence=new Set([...input.fullPassages,...input.sourceWindows].map(x=>x.id));
 const forms=new Set(input.corpusForms.map(x=>x.normalize('NFC').toLowerCase()));
 for(const m of answer.meanings){
  if(!m.id||ids.has(m.id))throw new Error('Duplicate/missing meaning id');ids.add(m.id);
  if(!m.definitionSpanish.trim()||!m.sourceForms.length)throw new Error('Empty meaning/form');
  if(m.evidenceIds.some(id=>!evidence.has(id)))throw new Error('Invented evidence id');
  if(m.sourceForms.some(f=>!forms.has(f.normalize('NFC').toLowerCase())&&![...input.fullPassages,...input.sourceWindows].some(p=>p.text.toLowerCase().includes(f.toLowerCase()))))throw new Error('Unattested source form');
  for(const lang of input.targetLanguages)if(m.targets.filter(t=>t.language===lang&&t.wording.trim()).length!==1)throw new Error('Missing/duplicate requested target');
  if(m.canonicalName&&!m.canonicalBasis.trim())throw new Error('Canonical name without basis');
 }
 if(!answer.meanings.length)throw new Error('No meanings');
}
export function project(answer,language,mode='lexical'){
 return {entries:answer.meanings.map(m=>({id:m.id,kind:'word',sourceTerms:m.sourceForms,
  generalNote:[m.grammar,m.definitionSpanish,m.selectionSpanish,m.contrastSpanish,
   m.ordinaryDictionaryOnly?'Significado ordinario de diccionario; no demostrado por la muestra.':'',
   m.canonicalBasis].filter(Boolean).join('\n'),
  variants:mode==='cards'&&!m.canonicalName?[]:[{id:m.id+'-target',target:m.targets.find(t=>t.language===language).wording,note:m.targets.find(t=>t.language===language).selectionNote}]})),
  selectionPolicySpanish:answer.preferenceSpanish,provenanceSpanish:answer.provenanceSpanish,
  risks:answer.uncertainties,status:'done',representation:mode,design:DESIGN.version};
}
export function gradeEffect(row,dimension){
 if(!row)return 0;
 const good=dimension==='accuracy'?'faithful':dimension==='policy'?'pass':'natural';
 const bad=dimension==='accuracy'?'material_error':dimension==='policy'?'fail':'clear_problem';
 const candidate=row[dimension+row.candidateSide],baseline=row[dimension+(row.candidateSide==='A'?'B':'A')];
 return candidate===good&&baseline===bad?1:candidate===bad&&baseline===good?-1:0;
}
export function confirmedEffect(first,second,dimension){
 const initial=gradeEffect(first,dimension);return initial&&initial===gradeEffect(second,dimension)?initial:0;
}
