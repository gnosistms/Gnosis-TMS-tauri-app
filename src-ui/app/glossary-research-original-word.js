// The original word of a borrowed meaning (Hans, 2026-10-08). When a meaning of
// the term comes, with confidence, from a book the author read in translation,
// and that book was written in the glossary's target language, the book's own
// word is the traditional target-language term for that meaning:
//   - it is always a translation of the entry, whatever its general frequency;
//   - it is the translation for that meaning: other renderings of the same meaning
//     are left out (other meanings of the term keep their own translations);
//   - the counting step is told so, and its glossary note says so.
// "With confidence" means the word was read in the original text: confirmed or
// corrected by the original-word check, or given by the book's own glossary pairs
// and found in the original text.

const fold = (text) => String(text ?? "").normalize("NFC").toLowerCase().trim();
const baseLanguage = (code) => String(code ?? "").toLowerCase().split(/[-_]/)[0];

/**
 * The original word a study sense carries, or null. `record` is the reference
 * book's record; `forms` the term's searched forms; `pairReads` maps
 * an original book id to the occurrences of its glossary-pair words found in the
 * original text.
 */
export function originalWordOf(sense, record, { forms = [], pairReads = new Map() } = {}) {
  const formKeys = new Set(forms.map(fold));
  if (!sense || sense.inDictionary || !sense.originalTerm || !record?.translated) return null;
  const term = String(sense.originalTerm).trim();
  if (!term) return null;
  const check = sense.originalCheck ?? null;
  let basis = "";
  if (check?.confirmed === true) basis = "checked in the original text";
  else if (check && check.originalTerm && fold(check.originalTerm) === fold(term)) basis = "corrected from the original text";
  else if (!check && (pairReads.get(record.originalBookId) ?? 0) > 0
    && (record.headwordPairs ?? []).some((pair) => formKeys.has(fold(pair.source)) && fold(pair.original) === fold(term))) {
    basis = "the book's own glossary pairs it with the term, and the original text uses it";
  }
  return {
    term,
    languageCode: record.originalLanguage ?? null,
    originalTitle: record.originalTitle ?? null,
    originalAuthor: record.originalAuthor ?? null,
    translationTitle: record.title ?? null,
    verified: Boolean(basis),
    basis,
  };
}

/** A rendering that is the word itself, or the word with an article ("the Innermost", "l'Intime"). */
function sameWord(rendering, key) {
  const text = fold(rendering);
  if (text === key) return true;
  const at = text.indexOf(key);
  if (at < 0 || text.length - key.length > 4) return false;
  const rest = (text.slice(0, at) + text.slice(at + key.length)).trim();
  return !/\s/.test(rest) && (at === 0 ? /^\s/.test(text.slice(key.length)) : /[\s'’]$/.test(text.slice(0, at)));
}

/** The original words that bind this glossary: verified, and in its target language. */
export function requiredOriginalWords(study, targetCode) {
  const seen = new Set();
  return (study?.senses ?? [])
    .filter((sense) => sense.originalWord?.verified && baseLanguage(sense.originalWord.languageCode) === baseLanguage(targetCode))
    .map((sense) => ({ ...sense.originalWord, sense: sense.sense }))
    .filter((word) => !seen.has(fold(word.term)) && seen.add(fold(word.term)));
}

/** "The Dayspring of Youth (M.)", or the translation's title when the original's is unknown. */
export function bookName(word) {
  const title = word.originalTitle || word.translationTitle || "";
  return word.originalAuthor ? `${title} (${word.originalAuthor})` : title;
}

/** Lines for the AI, naming each original word and the meaning it is required for. */
export function originalWordsText(required, targetName) {
  if (!required.length) return "";
  return required.map((word) => `- “${word.term}” is the traditional ${targetName} term for the meaning “${word.sense}”: the original word of ${bookName(word)}, which the author read in translation (${word.basis}).`).join("\n");
}

/**
 * Candidates: each original word stands alone in a recommended group of the
 * meaning it was proposed for (else of a new meaning block), and no other group
 * of that meaning is recommended. Returns where each word was placed:
 * [{ ...word, senseId, senseText, added }].
 */
export function placeOriginalWords(candidates, required) {
  const placed = [];
  candidates.senses ??= [];
  for (const word of required) {
    const key = fold(word.term);
    const holders = [];
    for (const sense of candidates.senses) {
      for (const group of sense.groups ?? []) {
        if ((group.members ?? []).some((member) => sameWord(member, key))) holders.push({ sense, group });
      }
    }
    const holder = holders.find((h) => h.group.recommended) ?? holders[0] ?? null;
    let sense = holder?.sense;
    if (!sense) {
      sense = { senseId: "none", sense: word.sense, groups: [] };
      candidates.senses.push(sense);
    }
    const note = holder && holder.group.members.length === 1 ? holder.group.note : "";
    if (holder) {
      holder.group.members = holder.group.members.filter((member) => !sameWord(member, key));
      sense.groups = sense.groups.filter((group) => group.members.length);
    }
    for (const group of sense.groups) group.recommended = false;
    sense.groups.unshift({
      members: [word.term], recommended: true, original: true, note: note ?? "",
      rationale: `The original word of ${bookName(word)}: the traditional term for this meaning.`,
    });
    placed.push({ ...word, senseId: sense.senseId, senseText: sense.sense, added: !holder });
  }
  return placed;
}

/** The placed original word a candidate check is for, or null. */
export function originalFor(placed, target, senseId) {
  const key = fold(target);
  return (placed ?? []).find((word) => fold(word.term) === key && word.senseId === senseId) ?? null;
}

/**
 * Proposal: every original word is a variant (added to the entry that holds the
 * headword when missing), marked `original`; the other variants of its entry that
 * render the same meaning (same sense labels) are left out. Returns
 * { added: [...], removed: [...] } for the log.
 */
export function enforceOriginalWords(proposal, placed, { headword = "" } = {}) {
  const added = [];
  const removed = [];
  const words = proposal.entries?.filter((entry) => entry.kind !== "expression") ?? [];
  if (!words.length) return { added, removed };
  for (const word of placed ?? []) {
    const key = fold(word.term);
    let entry = words.find((e) => e.variants.some((v) => fold(v.target) === key));
    let variant = entry?.variants.find((v) => fold(v.target) === key);
    if (!variant) {
      entry = words.find((e) => e.sourceTerms.some((t) => fold(t) === fold(headword))) ?? words[0];
      let n = entry.variants.length + 1;
      while (entry.variants.some((v) => v.id === `${entry.id}v${n}`)) n += 1;
      variant = { id: `${entry.id}v${n}`, target: word.term, note: "", senses: [`Outside dictionary: ${word.sense}`], corpusSense: word.sense, rationale: "" };
      entry.variants.push(variant);
      added.push({ entryId: entry.id, target: word.term });
    }
    variant.original = { term: word.term, sense: word.sense, book: bookName(word), originalTitle: word.originalTitle ?? word.translationTitle ?? "" };
    // The original word comes first: it is the translation of its meaning.
    entry.variants = [variant, ...entry.variants.filter((v) => v !== variant)];
    const sameMeaning = (v) => v !== variant && !v.original && (v.senses ?? []).length
      && (v.senses ?? []).every((s) => (variant.senses ?? []).includes(s))
      && (variant.senses ?? []).every((s) => (v.senses ?? []).includes(s));
    for (const other of entry.variants.filter(sameMeaning)) {
      removed.push({ entryId: entry.id, target: other.target, original: word.term });
      (proposal.leftOutRenderings ??= []).push({
        rendering: other.target, count: 0,
        reason: `Same meaning as “${word.term}”, the original word of ${bookName(word)}, which is the translation for that meaning.`,
      });
    }
    entry.variants = entry.variants.filter((v) => !sameMeaning(v));
  }
  return { added, removed };
}

/** An original word's note must say what it is; it names the original book, which is checkable in any language. */
export function noteNamesTheBook(variant) {
  const title = fold(variant?.original?.originalTitle);
  return !title || fold(variant?.note).includes(title);
}
