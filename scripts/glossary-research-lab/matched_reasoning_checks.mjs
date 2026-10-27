const norm=s=>String(s).normalize('NFC').toLowerCase().trim();
export function bindingsFromAnalysis(analysis){
 return analysis.items.flatMap(row=>row.occurrences.map(o=>{const forms=o.acceptedForms.length?o.acceptedForms:o.preferredEnglish.trim()?[o.preferredEnglish]:[];return {id:row.id,occurrenceIndex:o.occurrenceIndex,bindingId:`${row.id}:${o.occurrenceIndex}`,meaningSpanish:o.meaningSpanish,senseId:o.senseId,preferredEnglish:o.preferredEnglish,acceptedForms:forms,certainty:o.certainty,enforced:o.certainty==='clear'&&o.preferredEnglish.trim()!==''&&forms.length>0};}));
}
export function verifyMatchedOutput(result,passages,bindings){
 const errors=[],unresolved=[],translations=[];const ids=result.items.map(r=>r.id),expected=passages.map(p=>String(p.itemId));
 if(ids.length!==expected.length||new Set(ids).size!==ids.length||ids.some(id=>!expected.includes(id)))errors.push({kind:'passage_coverage'});
 for(const p of passages){const id=String(p.itemId),row=result.items.find(r=>r.id===id);if(!row)continue;const counts=new Map();
  for(const segment of row.segments){
   if(segment.occurrenceIndex===-1){if(segment.bindingId)errors.push({id,kind:'ordinary_segment_has_binding'});continue;}
   const n=segment.occurrenceIndex,binding=bindings.find(b=>b.id===id&&b.occurrenceIndex===n);counts.set(n,(counts.get(n)??0)+1);
   if(!binding){errors.push({id,occurrenceIndex:n,kind:'invented_occurrence'});continue;}
   if(segment.bindingId!==binding.bindingId)errors.push({id,occurrenceIndex:n,kind:'wrong_binding'});
   if(binding.enforced&&!binding.acceptedForms.some(f=>norm(f)===norm(segment.text)))errors.push({id,occurrenceIndex:n,kind:'wrong_rendering',actual:segment.text,allowed:binding.acceptedForms});
   if(!binding.enforced)unresolved.push({id,occurrenceIndex:n,certainty:binding.certainty,actualRendering:segment.text});
  }
  for(let n=0;n<p.occurrences.length;n++)if(counts.get(n)!==1)errors.push({id,occurrenceIndex:n,kind:'occurrence_coverage'});
  translations.push({id,translation:row.segments.map(s=>s.text).join('')});
 }
 return {passed:errors.length===0,errors,unresolved,translations,scope:'Full passage/occurrence accounting and literal compliance with independently selected clear choices. Unknown choices are translated but remain unverified; linguistic quality is external.'};
}
