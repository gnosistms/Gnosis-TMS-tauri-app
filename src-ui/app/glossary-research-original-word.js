// The original word of a borrowed meaning (Hans, 2026-10-08). When a meaning of
// the term comes, with confidence, from a book the author read in translation,
// and that book was written in the glossary's target language, the book's own
// word is the traditional target-language term for that meaning:
//   - it is always a translation of the entry, whatever its general frequency;
//   - it is the translation for that meaning: other renderings of the same meaning
//     are left out (other meanings of the term keep their own translations);
//   - the counting step is told so, and its glossary note says so.
// "With confidence" means the word was read in the original text: confirmed or
// corrected by the original-word check, or given by a pair of the term with the
// book's word and found in the original text. A pair comes from the book's own
// glossaries (both editions end with one, matched entry by entry: Dioses
// Atómicos) or from the search site's comparison of the translation with its
// original; both name the book's word for the term.

const fold = (text) => String(text ?? "").normalize("NFC").toLowerCase().trim();
const baseLanguage = (code) => String(code ?? "").toLowerCase().split(/[-_]/)[0];

/**
 * The pairs of the term with the book's original word: `record.termPairs` when
 * the search site gave them for this term ({ source, original, also, basis:
 * "printed" | "aligned" }), else the book's own glossary pairs whose Spanish
 * side is one of the forms.
 */
export function termPairsOf(record, forms = []) {
  if (Array.isArray(record?.termPairs)) return record.termPairs;
  const formKeys = new Set(forms.map(fold));
  return (record?.headwordPairs ?? [])
    .filter((pair) => formKeys.has(fold(pair.source)))
    .map((pair) => ({ ...pair, also: [], basis: "printed" }));
}

/** The paired words of a pair: its word and the book's other wordings for the term. */
export const pairWords = (pair) => [pair.original, ...(pair.also ?? [])].filter(Boolean);

const PAIR_BASIS = {
  printed: "the book's own glossary pairs it with the term, and the original text uses it",
  aligned: "the search site's comparison of the translation with the original pairs it with the term, and the original text uses it",
};

/**
 * The original word a study sense carries, or null. `record` is the reference
 * book's record; `forms` the term's searched forms; `pairReads` maps
 * an original book id to the occurrences of its paired words found in the
 * original text. `pairBasis` says which kind of pair gave the word, if one did.
 */
export function originalWordOf(sense, record, { forms = [], pairReads = new Map() } = {}) {
  if (!sense || sense.inDictionary || !sense.originalTerm || !record?.translated) return null;
  const term = String(sense.originalTerm).trim();
  if (!term) return null;
  const check = sense.originalCheck ?? null;
  let basis = "";
  let pairBasis = null;
  if (check?.confirmed === true) basis = "checked in the original text";
  else if (check && check.originalTerm && fold(check.originalTerm) === fold(term)) basis = "corrected from the original text";
  else if (!check && (pairReads.get(record.originalBookId) ?? 0) > 0) {
    const pair = termPairsOf(record, forms).find((item) => pairWords(item).some((word) => fold(word) === fold(term)));
    if (pair) {
      pairBasis = pair.basis === "aligned" ? "aligned" : "printed";
      basis = PAIR_BASIS[pairBasis];
    }
  }
  return {
    term,
    languageCode: record.originalLanguage ?? null,
    originalTitle: record.originalTitle ?? null,
    originalAuthor: record.originalAuthor ?? null,
    translationTitle: record.title ?? null,
    verified: Boolean(basis),
    basis,
    pairBasis,
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

const yearOf = (value) => {
  const match = /(\d{4})/.exec(String(value ?? ""));
  return match ? Number(match[1]) : null;
};

/**
 * Whether the author borrowed this sense of the term from its source book (Hans,
 * 2026-10-09): yes when the sense is not the ordinary one (not in the dictionary)
 * and it occurs in one of the books he read, even once. He may have met it
 * elsewhere too, but he certainly met it there. Dates are shown, not required.
 * Returns { strength, reasons, notes, spanishYear, firstYear }.
 */
export function borrowingStrength(sense, record, { citations = 0, glossaryPair = false, pair = null } = {}) {
  if (!sense?.sourceBook || !record) return null;
  const spanishYear = record.translated ? yearOf(record.firstSpanishTranslation) : yearOf(record.firstPrinting ?? record.originalFirstPrinting);
  const firstYear = Number.isInteger(sense.firstUseYear) ? sense.firstUseYear : null;
  const reasons = [];
  if (["only", "mainly", "several"].includes(sense.exclusivity)) reasons.push("in-book");
  if (sense.citesBook === true && citations > 0) reasons.push("cites");
  // A pair of the term with the book's word (either kind) shows the book uses the term.
  if (pair === "aligned") reasons.push("aligned");
  else if (glossaryPair || pair === "printed") reasons.push("glossary");
  const special = sense.inDictionary === false;
  const notes = [];
  if (spanishYear != null && firstYear != null && spanishYear > firstYear) notes.push(`the Spanish edition (${spanishYear}) is later than his first use in this sense (${firstYear})`);
  const strength = special && reasons.length ? "strong" : "weak";
  const doubts = [];
  if (!special) doubts.push("this is an ordinary meaning of the word");
  if (!reasons.length) doubts.push("the sense was not found in the book");
  return { strength, reasons, notes, doubts, spanishYear, firstYear };
}

/** One plain line saying what the borrowing rests on. */
export function borrowingText(sense, borrowing, { author = "The author", term = "", translationTitle = "" } = {}) {
  if (!borrowing) return "";
  const where = translationTitle || sense.sourceBook;
  if (borrowing.strength === "weak") {
    return `${where} may be where ${author} found “${term}” in this sense, but it is not certain (${borrowing.doubts.join("; ")}).`;
  }
  const bases = ["the sense is not the ordinary one"];
  if (borrowing.reasons.includes("in-book")) bases.push(sense.exclusivity === "only" ? "the book uses it, and no other book he read does" : "the book uses it");
  if (borrowing.reasons.includes("cites")) bases.push("he names the book next to the term");
  if (borrowing.reasons.includes("glossary")) bases.push("the book's own glossary gives it");
  if (borrowing.reasons.includes("aligned")) bases.push("the search site's comparison with the original pairs it with the book's word");
  const dates = borrowing.spanishYear != null ? ` Spanish edition ${borrowing.spanishYear}${borrowing.firstYear != null ? `; his first use in this sense ${borrowing.firstYear}` : ""}${borrowing.notes.length ? ` (note: ${borrowing.notes.join("; ")})` : ""}.` : "";
  return `${author} read “${term}” in this sense in ${where}: ${bases.join("; ")}.${dates}`;
}

/** The original words that bind this glossary: verified, borrowed with certainty, and in its target language. */
export function requiredOriginalWords(study, targetCode) {
  const seen = new Set();
  return (study?.senses ?? [])
    .filter((sense) => sense.originalWord?.verified && baseLanguage(sense.originalWord.languageCode) === baseLanguage(targetCode))
    // A borrowing that is not certain does not impose the book's word (runs before 2026-10-09 have no strength).
    .filter((sense) => sense.borrowing?.strength !== "weak")
    .map((sense) => ({ ...sense.originalWord, sense: sense.sense, partOfSpeech: sense.partOfSpeech ?? null }))
    .filter((word) => !seen.has(fold(word.term)) && seen.add(fold(word.term)));
}

/** "English" for "en": the name of a language in English, or "" when unknown. */
export function languageNameOf(code) {
  if (!code) return "";
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(String(code));
    return name && name !== String(code) ? name : "";
  } catch {
    return "";
  }
}

const quoted = (words) => {
  const marked = words.map((word) => `“${word}”`);
  return marked.length > 1 ? `${marked.slice(0, -1).join(", ")} and ${marked.at(-1)}` : marked.join("");
};

/**
 * The step's fact for the pairs of the term in one book. It says where the pair
 * comes from, so it is not taken for the AI's answer (Hans, 2026-10-09): the
 * book's own glossaries (`printed`), or the search site's comparison of the
 * translation with its original (`aligned`: matched by AI, then each original
 * word confirmed by a program in the matching passages of the original).
 * `searched` are the forms counted in the original text; `occurrences` their count.
 */
export function pairFact({ site = "author's", author = "the author", shortTitle, record, term, pairs, occurrences, searched = [] }) {
  const language = languageNameOf(record?.originalLanguage);
  const name = record?.originalTitle ?? shortTitle;
  const sentence = `The ${site} search site lists ${shortTitle} among the books ${author} read: the Spanish translation of ${name}${record?.originalAuthor ? `, written${language ? ` in ${language}` : ""} by ${record.originalAuthor}` : ""}`;
  const intro = sentence.endsWith(".") ? sentence : `${sentence}.`; // "by M." ends the sentence
  const original = `${language ? `${language} ` : ""}original`;
  const times = occurrences === 1 ? "once" : `${occurrences} times`;
  const words = [...new Set(pairs.flatMap(pairWords))];
  if (pairs.every((pair) => pair.basis !== "aligned")) {
    return `${intro} Both editions end with a glossary; matched entry by entry, they pair “${term}” with ${words.map((o) => `“${o}”`).join(", ")}, which the ${original} uses ${times}.`;
  }
  const extra = searched.filter((form) => !words.some((word) => fold(word) === fold(form)));
  const counting = extra.length ? ` (counting ${quoted(extra)})` : "";
  const spoken = language || "original";
  const how = `The site compared the Spanish translation with the ${original} passage by passage: an AI matched the words, and a program then confirmed that each ${spoken} word appears in the matching ${spoken} passages.`;
  if (pairs.every((pair) => pair.status === "passthrough")) {
    // A kept word may be spelled differently in the original ("akasa" for "akasha").
    const bare = (text) => fold(text).normalize("NFD").replace(/\p{M}/gu, "");
    if (words.every((word) => bare(word) === bare(term))) {
      return `${intro} ${how} The Spanish translation keeps the ${original}'s word: ${quoted(words)}, used ${times}${counting}.`;
    }
    return `${intro} ${how} The Spanish translation keeps the ${original}'s word; the ${original} spells it ${quoted(words)} and uses it ${times}${counting}.`;
  }
  return `${intro} ${how} It pairs “${term}” with ${quoted(words)}, which the ${original} uses ${times}${counting}.`;
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
    // The word as written wins over a case variant: "Innermost" (the divine name)
    // is not the adjective "innermost" listed for another meaning.
    const exact = (member) => String(member ?? "").normalize("NFC").trim() === String(word.term).normalize("NFC").trim();
    const find = (test) => candidates.senses.flatMap((sense) => (sense.groups ?? [])
      .filter((group) => (group.members ?? []).some(test)).map((group) => ({ sense, group })));
    let holders = find(exact);
    if (!holders.length) holders = find((member) => sameWord(member, key));
    const holder = holders.find((h) => h.group.recommended) ?? holders[0] ?? null;
    let sense = holder?.sense;
    if (!sense) {
      sense = { senseId: "none", sense: word.sense, groups: [] };
      candidates.senses.push(sense);
    }
    const note = holder && holder.group.members.length === 1 ? holder.group.note : "";
    if (holder) {
      holder.group.members = holder.group.members.filter((member) => !(exact(member) || (!holders.some((h) => h.group.members.some(exact)) && sameWord(member, key))));
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
  const text = String(target ?? "").normalize("NFC").trim();
  return (placed ?? []).find((word) => String(word.term).normalize("NFC").trim() === text && word.senseId === senseId) ?? null;
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
    const term = String(word.term).normalize("NFC").trim();
    const exact = (v) => String(v.target ?? "").normalize("NFC").trim() === term;
    let entry = words.find((e) => e.variants.some(exact)) ?? words.find((e) => e.variants.some((v) => fold(v.target) === key));
    let variant = entry?.variants.find(exact) ?? entry?.variants.find((v) => fold(v.target) === key);
    if (!variant) {
      entry = words.find((e) => e.sourceTerms.some((t) => fold(t) === fold(headword))) ?? words[0];
      let n = entry.variants.length + 1;
      while (entry.variants.some((v) => v.id === `${entry.id}v${n}`)) n += 1;
      variant = { id: `${entry.id}v${n}`, target: word.term, note: "", ...(word.partOfSpeech ? { partOfSpeech: word.partOfSpeech } : {}), senses: [`Outside dictionary: ${word.sense}`], corpusSense: word.sense, rationale: "" };
      entry.variants.push(variant);
      added.push({ entryId: entry.id, target: word.term });
    }
    variant.original = {
      term: word.term, sense: word.sense, book: bookName(word),
      originalTitle: word.originalTitle ?? word.translationTitle ?? "", author: word.originalAuthor ?? "",
    };
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

/**
 * The short label of an original word: "from M.", the author of the book it was
 * borrowed from (runs saved before the author was kept: from the book's name).
 */
export function originalSourceLabel(original) {
  const author = original?.author || /\(([^()]+)\)\s*$/.exec(original?.book ?? "")?.[1] || "";
  return `from ${author || original?.originalTitle || original?.book || "the source book"}`;
}

/** What the "from <author>" label means, for its tooltip. */
export function originalSourceTooltip(original, target) {
  const word = target || original?.term || "this word";
  return `The author took this meaning from ${original?.book || "a book he read in translation"}, which uses “${word}” for it. So “${word}” is the translation whenever the term has this meaning, however rare it is in general use.`;
}

/** An original word's note must say what it is; it names the original book, which is checkable in any language. */
export function noteNamesTheBook(variant) {
  const title = fold(variant?.original?.originalTitle);
  return !title || fold(variant?.note).includes(title);
}
