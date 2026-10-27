// Mechanical compliance checks. Source classification and mapping quality are
// separate evidence-dependent judgments; this module cannot certify either.
const normalize=s=>String(s).normalize('NFC').toLocaleLowerCase('en').trim();
export function agreeMappings(first,second){
 const bindings=[],unresolved=[];
 for(const a of first.meanings){
  const b=second.meanings.find(b=>b.senseId===a.senseId);
  if(!b||a.status!=='preferred'||b.status!=='preferred'||normalize(a.preferredEnglish)!==normalize(b.preferredEnglish)){
   unresolved.push({senseId:a.senseId,first:a,second:b??null,reason:'No independently agreed preferred rendering'});continue;
  }
  const common=a.acceptedForms.filter(f=>b.acceptedForms.some(g=>normalize(f)===normalize(g)));
  if(!common.length){unresolved.push({senseId:a.senseId,reason:'No agreed exact surface forms'});continue;}
  bindings.push({senseId:a.senseId,targetId:`binding:${a.senseId}`,target:a.preferredEnglish,acceptedForms:common});
 }
 return {bindings,unresolved};
}
export function agreeClassifications(first,second,passages){
 const selected=[],unresolved=[];
 for(const p of passages){
  const id=String(p.itemId),a=first.items.find(r=>r.id===id),b=second.items.find(r=>r.id===id);
  for(let n=0;n<p.occurrences.length;n++){
   const x=a?.occurrences.find(o=>o.occurrenceIndex===n),y=b?.occurrences.find(o=>o.occurrenceIndex===n);
   if(x?.certainty==='clear'&&y?.certainty==='clear'&&x.selectedSenseId!=='unknown'&&x.selectedSenseId===y.selectedSenseId)selected.push({id,occurrenceIndex:n,senseId:x.selectedSenseId});
   else unresolved.push({id,occurrenceIndex:n,first:x??null,second:y??null});
  }
 }
 return {selected,unresolved};
}
export function eligiblePassages(passages,selections,bindings,requirePreferredTarget=false){
 return passages.filter(p=>p.occurrences.every((o,n)=>{
  const selection=selections.find(s=>s.id===String(p.itemId)&&s.occurrenceIndex===n);
  if(!selection||requirePreferredTarget&&!selection.preferredTargetId)return false;
  return bindings.some(b=>selection.preferredTargetId?b.targetId===selection.preferredTargetId&&b.senseId===selection.senseId:b.senseId===selection.senseId);
 }));
}
export function verifyBoundTranslation(items,passages,selections,bindings){
 const errors=[],translations=[];
 const ids=items.map(r=>r.id),expected=passages.map(p=>String(p.itemId));
 if(new Set(ids).size!==ids.length||ids.length!==expected.length||ids.some(id=>!expected.includes(id)))errors.push({kind:'passage_coverage'});
 for(const p of passages){
  const id=String(p.itemId),row=items.find(r=>r.id===id);
  if(!row)continue;
  const counts=new Map();
  for(const segment of row.segments){
   if(segment.occurrenceIndex===-1){if(segment.senseId||segment.targetId)errors.push({id,kind:'unbound_segment_has_identity'});continue;}
   const n=segment.occurrenceIndex;counts.set(n,(counts.get(n)??0)+1);
   const selected=selections.find(s=>s.id===id&&s.occurrenceIndex===n),binding=bindings.find(b=>selected?.preferredTargetId?b.targetId===selected.preferredTargetId:b.senseId===selected?.senseId);
   if(!selected||!binding){errors.push({id,occurrenceIndex:n,kind:'unknown_binding'});continue;}
   if(binding.senseId!==selected.senseId||segment.senseId!==selected.senseId||segment.targetId!==binding.targetId)errors.push({id,occurrenceIndex:n,kind:'wrong_identity'});
   if(!binding.acceptedForms.some(f=>normalize(f)===normalize(segment.text)))errors.push({id,occurrenceIndex:n,kind:'wrong_rendering',actual:segment.text,allowed:binding.acceptedForms});
  }
  for(let n=0;n<p.occurrences.length;n++)if(counts.get(n)!==1)errors.push({id,occurrenceIndex:n,kind:'occurrence_coverage'});
  translations.push({id,translation:row.segments.map(s=>s.text).join('')});
 }
 return {passed:errors.length===0,errors,translations,scope:'Checks selected meaning/target identity, approved rendered spans and occurrence accounting. Does not certify meaning recognition, target preference, placement or full-passage accuracy.'};
}
