// Two source words with one translation. Sharing is fine when they mean the
// same in these texts (two synonyms in one sentence are then translated once);
// it is a problem only when it erases a difference the author makes.

import { expressionSpans, sentenceBounds, snippet } from "./glossary-research-occurrences.js";

const MAX_PAIRS = 12;

// Target renderings are compared with accents and tones kept (phù ≠ phụ).
const key = (text) => String(text ?? "").normalize("NFC").toLowerCase().trim();

/**
 * Each rendering of the proposal that another source word already has: another
 * entry of the proposal, or one of `others` ({sourceTerms, targetTerms, note, origin}).
 */
export function sharedRenderings(proposal, others = []) {
  const pairs = [];
  const seen = new Set();
  const push = (pair) => {
    const id = `${pair.entryId}:${key(pair.target)}:${pair.otherSourceTerms.map(key).sort().join("|")}`;
    if (seen.has(id) || pairs.length >= MAX_PAIRS) return;
    seen.add(id);
    pairs.push(pair);
  };
  proposal.entries.forEach((entry, index) => {
    for (const variant of entry.variants) {
      const k = key(variant.target);
      if (!k) continue;
      const base = { entryId: entry.id, variantId: variant.id, target: variant.target, note: variant.note ?? "", sourceTerms: entry.sourceTerms };
      for (const other of proposal.entries.slice(index + 1)) {
        const same = other.variants.find((v) => key(v.target) === k);
        if (same) push({ ...base, otherSourceTerms: other.sourceTerms, otherNote: same.note ?? "", origin: "proposal" });
      }
      for (const other of others) {
        const at = (other.targetTerms ?? []).findIndex((t) => key(t) === k);
        if (at >= 0) push({ ...base, otherSourceTerms: other.sourceTerms ?? [], otherNote: other.notes?.[at] || other.note || "", origin: other.origin ?? "glossary" });
      }
    }
  });
  return pairs;
}

/**
 * Sampled passages where both words occur, and how many of them have both in
 * one sentence. Where one word's match lies inside a longer match of the other
 * (a word inside a phrase), only the longer one counts.
 */
export function coOccurrence(items, formsA, formsB, languageCode = "", limit = 3) {
  const entries = [
    { id: "a", kind: "expression", sourceTerms: formsA },
    { id: "b", kind: "expression", sourceTerms: formsB },
  ];
  let passages = 0;
  let sameSentence = 0;
  const examples = [];
  for (const item of items) {
    const text = item.text ?? "";
    const spans = expressionSpans(text, entries, languageCode);
    const kept = spans.filter((span) => !spans.some((other) => other.entryId !== span.entryId
      && other.start <= span.start && span.end <= other.end && other.end - other.start > span.end - span.start));
    const a = kept.filter((s) => s.entryId === "a");
    const b = kept.filter((s) => s.entryId === "b");
    if (!a.length || !b.length) continue;
    passages += 1;
    let pair = null;
    for (const sa of a) {
      const [start, end] = sentenceBounds(text, sa.start, sa.end);
      const sb = b.find((span) => span.start >= start && span.end <= end);
      if (sb) {
        pair = [sa, sb];
        break;
      }
    }
    if (pair) sameSentence += 1;
    if (examples.length < limit) {
      const [sa, sb] = pair ?? [a[0], b.reduce((best, span) => (Math.abs(span.start - a[0].start) < Math.abs(best.start - a[0].start) ? span : best))];
      examples.push(snippet(text, Math.min(sa.start, sb.start), Math.max(sa.end, sb.end), 140));
    }
  }
  return { passages, sameSentence, examples };
}

/** The numbered pairs as the judge sees them. */
export function convergenceContent(pairs, { targetName, dictionaryText }) {
  const origin = { proposal: "another entry of this proposal", family: "a related word studied just before this one", glossary: "the glossary" };
  const lines = [];
  pairs.forEach((pair, index) => {
    const evidence = pair.evidence ?? { passages: 0, sameSentence: 0, examples: [] };
    lines.push(
      `[${index + 1}] “${pair.sourceTerms.join(" / ")}” (the term studied) → ${targetName} “${pair.target}”${pair.note ? ` (note: ${pair.note})` : ""}`,
      `    “${pair.otherSourceTerms.join(" / ")}” → “${pair.target}” in ${origin[pair.origin] ?? pair.origin}${pair.otherNote ? ` (note: ${pair.otherNote})` : ""}`,
      `    Sampled passages of the term that also contain it: ${evidence.passages}; with both in one sentence: ${evidence.sameSentence}`,
      ...evidence.examples.map((example) => `    · ${example}`),
    );
  });
  lines.push("", dictionaryText || "Dictionary entry of the term: none found");
  return lines.join("\n");
}
