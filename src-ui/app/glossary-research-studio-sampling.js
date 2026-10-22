// Small, deterministic exploratory views. Complete evidence stays on the study.
const fold = (text) => String(text ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
const words = (text) => fold(text).match(/[\p{L}\p{N}]+/gu) ?? [];
const doc = (p) => p.reference?.doc_id ?? p.reference?.docId ?? p.reference?.title ?? p.references?.[0]?.title ?? p.id;
const hash = (value) => { let h = 2166136261; for (const c of String(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

export function exploratoryContext(study, paragraph) {
  const included = paragraph?.recovered || study.expandedContextIds?.includes(paragraph?.id)
    || study.contextIncludedIds?.includes(paragraph?.id);
  return included ? { before: paragraph.contextBefore ?? paragraph.context_before ?? [], after: paragraph.contextAfter ?? paragraph.context_after ?? [] }
    : { before: [], after: [] };
}

export function focusedSample(study, meaningId, assignments) {
  const pool = study.passages.filter((p) => assignments.some((a) => a.paragraphId === p.id));
  const limit = study.focusedSampleLimits?.[meaningId] ?? (pool.length > 20 ? 10 : 5);
  const picked = []; const forms = new Set(); const documents = new Set();
  const meaning = study.meanings.find((m) => m.id === meaningId);
  const anchors = new Set((Array.isArray(meaning?.evidence) ? meaning.evidence : []).map((e) => typeof e === "string" ? e : e.id ?? e.paragraphId));
  const surfaces = (p) => p.occurrences.filter((o) => assignments.some((a) => a.paragraphId === p.id && a.occurrenceId === o.id))
    .map((o) => fold(o.surface ?? p.text.slice(o.start, o.end)));
  const add = (p) => { if (!p || picked.includes(p)) return; picked.push(p); surfaces(p).forEach((f) => forms.add(f)); documents.add(doc(p)); };
  const ordered = [...pool].sort((a, b) => hash(`${study.scope.seed}:${meaningId}:${a.id}`) - hash(`${study.scope.seed}:${meaningId}:${b.id}`));
  // Rare witnesses, explicit human reviews and grammatical contrasts survive caps.
  ordered.filter((p) => p.recovered || study.expandedContextIds?.includes(p.id)).forEach(add);
  [...new Set(ordered.flatMap(surfaces))].forEach((f) => { if (!forms.has(f)) add(ordered.find((p) => surfaces(p).includes(f))); });
  const contrast = (p) => /\b(?:m[aá]s|menos|muito|more|less|plus|moins)\b/iu.test(p.text);
  add(ordered.find(contrast));
  add(ordered.find((p) => p.occurrences.some((o) => /\b(?:los?|las?|the|les?|des?)\s+$/iu.test(p.text.slice(0, o.start)))));
  for (const p of ordered) if (picked.length < limit && anchors.has(p.id)) add(p);
  for (const p of ordered) if (picked.length < limit && !documents.has(doc(p))) add(p);
  for (const p of ordered) if (picked.length < limit) add(p);
  return { paragraphs: pool.filter((p) => picked.includes(p)), assignments: assignments.filter((a) => picked.some((p) => p.id === a.paragraphId)),
    totalParagraphs: pool.length, totalOccurrences: assignments.length, version: 2 };
}

export function rankRecoveryParagraphs(paragraphs, profiles, seed) {
  if (!profiles.length) return [...paragraphs];
  const indexed = paragraphs.map((p) => ({ p, text: fold([p.text, p.reference?.title, p.reference?.chapter_title,
    ...(p.contextBefore ?? p.context_before ?? []), ...(p.contextAfter ?? p.context_after ?? [])].join(" ")) }));
  const lists = profiles.map((profile) => indexed.map(({ p, text }) => ({ p, score: (profile.clues ?? []).reduce((score, clue) => {
    const tokens = words(clue).filter((w) => w.length > 2); if (!tokens.length) return score;
    const matches = tokens.filter((w) => text.includes(w)).length;
    return score + matches / tokens.length + (tokens.length > 1 && text.includes(fold(clue)) ? 2 : 0);
  }, 0) })).sort((a, b) => b.score - a.score || hash(`${seed}:${a.p.id}`) - hash(`${seed}:${b.p.id}`)));
  const result = []; const seen = new Set(); const documents = profiles.map(() => new Set());
  // Round-robin protects a rare missing meaning from a dominant meaning's scores.
  for (let i = 0; i < paragraphs.length; i += 1) for (const [index, list] of lists.entries()) {
    const candidate = i < 3 ? list.find(({ p, score }) => score > 0 && !seen.has(p.id) && !documents[index].has(doc(p))) : null;
    const row = candidate ?? list.find(({ p }) => !seen.has(p.id));
    if (!row) continue;
    seen.add(row.p.id); documents[index].add(doc(row.p)); result.push(row.p);
  }
  return result.length ? result : [...paragraphs].sort((a, b) => hash(`${seed}:${a.id}`) - hash(`${seed}:${b.id}`));
}
