import { createHash } from 'node:crypto';
export const hash = x => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
export function splitEvaluation(items, seed, n = 40) {
  const distinct = [...new Map(items.map(i => [hash(i.text), i])).values()];
  distinct.sort((a,b) => hash(`${seed}:${a.text}`).localeCompare(hash(`${seed}:${b.text}`)));
  const evaluation = distinct.slice(0,n), research = distinct.slice(n);
  return { evaluation, research:research.length ? research : distinct, overlap:research.length ? 0 : evaluation.length };
}
export function checkIds(rows, expected) {
  const ids = rows.map(x => x.id);
  if (ids.length !== expected.length || new Set(ids).size !== ids.length || expected.some(x => !ids.includes(x))) throw new Error('Incomplete or duplicate evaluation output');
}
export function blindPair(source, baseline, candidate, seed) {
  const swapped = Number.parseInt(hash(`${seed}:${source.id}`).slice(0,8),16)%2 === 1;
  return { public:{id:source.id,source:source.text,A:swapped?candidate:baseline,B:swapped?baseline:candidate},candidateSide:swapped?'A':'B' };
}
export function totals(records) {
  const successful=records.filter(x=>x.status==='ok');
  return {calls:records.length,successfulCalls:successful.length,seconds:records.reduce((n,r)=>n+r.seconds,0),
    input:records.reduce((n,r)=>n+(r.usage?.input_tokens??0),0),cached:records.reduce((n,r)=>n+(r.usage?.cached_input_tokens??0),0),
    output:records.reduce((n,r)=>n+(r.usage?.output_tokens??0),0),unknownUsage:records.filter(r=>!r.usage).length};
}

export function needsLexicalAudit(entry) {
  const seen=new Set();
  for(const row of entry.entries??[]) {
    if(row.variants.length>1)return true;
    for(const key of new Set(row.sourceTerms.map(form=>form.normalize('NFC').trim().toLowerCase()))) {
      if(seen.has(key))return true;seen.add(key);
    }
  }
  return false;
}

export function enforceClearCorrectness(row) {
  const result={...row};
  const material=[row.accuracyA,row.accuracyB].includes('material_error');
  if(!material || [row.accuracyA,row.accuracyB].includes('uncertain'))result.accuracy='tie';
  const clearFluency=[row.naturalnessA,row.naturalnessB].includes('clear_problem');
  if(!clearFluency || [row.naturalnessA,row.naturalnessB].includes('uncertain'))result.naturalness='tie';
  result.winner=result.accuracy;
  result.rubricAdjusted=result.accuracy!==row.accuracy||result.naturalness!==row.naturalness||result.winner!==row.winner;
  return result;
}

export function confirmJudgment(first,second) {
  if(!second)return {...first,secondCheck:'not-needed'};
  const relative=(row,dim)=>row[dim]==='tie'?'tie':row[dim]===row.candidateSide?'candidate':'reference';
  const row={...first,secondCheck:'checked',secondJudge:second};
  for(const dim of ['accuracy','naturalness'])if(first[dim]!=='tie'&&relative(first,dim)!==relative(second,dim))row[dim]='tie';
  row.winner=row.accuracy;row.judgeDisagreement=row.accuracy!==first.accuracy||row.naturalness!==first.naturalness;
  return row;
}
