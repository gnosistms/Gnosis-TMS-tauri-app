/** Audit findings must reach the entry; broad sense coverage is insufficient. */
import {evidenceQuoteSupported} from './htn_core.mjs';
const str={type:'string'},arr=items=>({type:'array',items});
const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const DELIVERY_OBLIGATIONS_SCHEMA=arr(obj({id:str,language:str,senseIds:arr(str),targets:arr(str),scope:str,evidence:arr(obj({evidenceId:str,quote:str}))}));
DELIVERY_OBLIGATIONS_SCHEMA.items.properties.senseIds.minItems=1;
DELIVERY_OBLIGATIONS_SCHEMA.items.properties.targets.minItems=1;
DELIVERY_OBLIGATIONS_SCHEMA.items.properties.evidence.minItems=1;
export const CONTEXTUAL_CANDIDATE_RULES=`Retain useful natural translations for supported contextual applications, even when another translation covers more of the broad lexical meaning. One broad meaning may need several context-scoped targets. A counterexample narrows applicability rather than globally rejecting a target that fits other attested applications. Keep validity, preferred selection and sample frequency separate. Preserve every source meaning and valid candidate; remove redundant duplicates, not meaningfully narrower choices. Include distinct singular/plural target forms when the target language marks number and source usages support them; the compiler does not invent inflections. State which source uses each target serves. When a narrower target is preferred, write an explicit positive conditional selection priority over broader defaults and frequency, plus its fallback boundary; a definition of validity alone does not express preference. Source witness IDs and research caveats belong in evidence records, not translator-facing scope notes. Revisit a prior rejection when audit evidence contradicts it; preserve its decision history, not an erroneous verdict.`;
export const AUDIT_DELIVERY_RULES=`Return deliveryObligations for clearly supported targets or grammatical forms whose absence loses a useful contextual distinction. This is a list of necessary corrections, not all possible synonyms or paraphrases: do not require another synonym when existing choices already adequately express that application. Translate the researched headword's own contribution. Do not absorb separately expressed adjectives, titles or modifiers into headword candidates; retain established idiomatic whole-expression translations only for the inventoried expression uses. Each obligation gives exact target text(s), applicable source meaning IDs, scope, and actual source quotes with their passage IDs. Every listed target must serve every listed meaning under that scope; split obligations if their meanings differ. Dictionary-only possibilities without an attested source meaning stay unresolved, not mandatory delivery targets. These are contextual candidates, not universal defaults. Include supported inflected forms explicitly when needed. If evidence is ambiguous, record unresolved rather than inventing a mandatory target. A prose acknowledgment is not resolution: the actual candidate, scope and note must be delivered.`;
const norm=s=>String(s).normalize('NFC').trim().toLowerCase();
export function candidateDeliveryFailures({proposal,savedByLanguage,obligations,evidence}){
 const errors=[],languages=new Map(proposal.languages.map(l=>[l.language,l]));
 const witnesses=new Map(evidence.map(p=>[String(p.itemId??p.id),[p.text,...(p.contextBefore??[]),...(p.contextAfter??[])]]));
 for(const o of obligations){
  const language=languages.get(o.language),base={obligationId:o.id,language:o.language};
  if(!language||!o.senseIds.length||!o.targets.length||!o.scope.trim()||!o.evidence.length||o.evidence.some(q=>!witnesses.has(q.evidenceId)||!evidenceQuoteSupported(q.quote,witnesses.get(q.evidenceId)))){
   errors.push({...base,kind:'invalid_obligation_evidence'});continue;
  }
  for(const target of o.targets){
   const v=language.variants.find(v=>norm(v.target)===norm(target)&&o.senseIds.every(id=>v.senseIds.includes(id)));
   if(!v){errors.push({...base,target,kind:'missing_contextual_candidate'});continue;}
   if(!v.scope.trim())errors.push({...base,target,kind:'missing_scope'});
   if(proposal.candidateDispositions.some(d=>d.language===o.language&&norm(d.target)===norm(target)&&d.disposition==='rejected'&&d.senseIds.some(id=>o.senseIds.includes(id))))errors.push({...base,target,kind:'contradictory_rejection'});
   if(savedByLanguage){
    const terms=savedByLanguage[o.language]?.terms??[];
    const found=terms.some(t=>t.targetTerms.some((s,i)=>norm(s)===norm(target)&&t.targetVariantNotes[i]?.trim()));
    if(!found)errors.push({...base,target,kind:'lost_in_serialization'});
   }
  }
 }
 for(const d of proposal.candidateDispositions.filter(d=>d.disposition==='kept'&&d.senseIds.length)){
  const l=languages.get(d.language);
  if(!l?.variants.some(v=>norm(v.target)===norm(d.target)&&d.senseIds.every(id=>v.senseIds.includes(id))))errors.push({language:d.language,target:d.target,kind:'kept_candidate_missing'});
 }
 return errors;
}
export function assertCandidateDelivery(packet){
 const failures=candidateDeliveryFailures(packet);
 if(failures.length)throw Error('Unresolved candidate delivery: '+JSON.stringify(failures));
 return true;
}
