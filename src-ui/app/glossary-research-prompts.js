// Prompt texts and strict JSON schemas for Glossary Research.
// Bump RESEARCH_PROMPT_VERSION on any change that could alter a judgment.

export const RESEARCH_PROMPT_VERSION = "2026-09-26.1";

const STR = { type: "string" };
const NSTR = { anyOf: [{ type: "string" }, { type: "null" }] };
const arrayOf = (items) => ({ type: "array", items });
const object = (properties) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const oneOf = (...values) => ({ type: "string", enum: values });

function corpusLine(ctx) {
  return `Source texts: ${ctx.corpusDescription}.`;
}

function dictionaryBlock(ctx) {
  return ctx.dictionaryText
    ? `Dictionary evidence (verbatim, cite by sense number):\n${ctx.dictionaryText}`
    : "Dictionary evidence: none was found for this word; rely on the texts and say so.";
}

// Quotation marks as each language writes them. Models copy the «» of the
// Spanish texts into other languages unless told otherwise.
const QUOTATION_MARKS = {
  en: "“…” (and ‘…’ inside)", vi: "“…”", es: "«…» or “…”", pt: "“…” or «…»", fr: "« … »",
  it: "«…» or “…”", de: "„…“", nl: "“…” or ‘…’", ru: "«…»", uk: "«…»", pl: "„…”",
  zh: "“…” (Simplified) or 「…」 (Traditional)", "zh-Hans": "“…”", "zh-Hant": "「…」 (and 『…』 inside)",
  ja: "「…」 (and 『…』 inside)", ko: "“…”", th: "“…”", id: "“…”", tr: "“…”", ar: "«…» or “…”", he: "\"…\"",
};

export function quotationMarksFor(languageCode) {
  const code = String(languageCode ?? "");
  return QUOTATION_MARKS[code] ?? QUOTATION_MARKS[code.split("-")[0]] ?? null;
}

/** Languages whose own quotation marks include «», where «» in a note is normal. */
export function usesGuillemets(languageCode) {
  return /«/.test(quotationMarksFor(languageCode) ?? "");
}

function quotationRule(languageName, languageCode) {
  const marks = quotationMarksFor(languageCode);
  return marks
    ? `Text written in ${languageName} uses ${languageName} quotation marks: ${marks}. Do not copy the quotation marks of the source texts.`
    : `Text written in ${languageName} uses ${languageName}'s own quotation marks, not those of the source texts.`;
}

/** Quotation-mark rules for the target language and, if different, the report language. */
function quotationRules(ctx) {
  const rules = [quotationRule(ctx.targetName, ctx.targetCode)];
  if (ctx.reportName && ctx.reportName !== ctx.targetName) rules.push(quotationRule(ctx.reportName, ctx.reportCode));
  return rules.join(" ");
}

// --- editor flow: find the source-language term ------------------------------

export const PIVOT_SCHEMA = object({
  found: { type: "boolean" },
  confidence: oneOf("high", "low"),
  sourceTerm: NSTR,
  definitions: arrayOf(STR),
});

export function pivotInstructions() {
  return `You align words between the languages of one translated passage. Given a passage in several languages and a word or phrase in one of them, identify the word or phrase in the SOURCE-language text that it translates, copied exactly as it appears there. Give its lemma form (dictionary form) when the text shows an inflected form, unless the inflection itself is what differs in meaning. Set confidence to "high" only when the correspondence is clear from the texts; otherwise "low" and found=false. If found, also write 2–5 short definitions of the source-language term's meanings, in the language of the research word, ordered by relevance to this passage.`;
}

export function pivotContent({ researchTerm, researchLanguage, sourceLanguage, rowTexts }) {
  const lines = [`Research word (${researchLanguage}): ${researchTerm}`, `Source language: ${sourceLanguage}`, ""];
  for (const { language, text } of rowTexts) {
    lines.push(`[${language}]\n${text}\n`);
  }
  return lines.join("\n");
}

// --- word forms ------------------------------------------------------------

export const FORMS_PROPOSE_SCHEMA = object({
  forms: arrayOf(object({
    form: STR,
    kind: oneOf("inflection", "spelling", "user", "existing"),
    confidence: oneOf("high", "medium", "low"),
  })),
});

export function formsProposeInstructions(ctx) {
  return `You prepare a corpus study of the ${ctx.sourceName} word “${ctx.headword}”. ${corpusLine(ctx)}
List every surface form a search should include: the headword, its grammatical inflections (number, gender, and other inflections the word really has), and alternative spellings (old or variant spellings, capitalised forms only if they differ as words). The text search ignores capital letters but NOT accents: "íntima" and "intima" are different searches. So list every inflection both with and without its accent marks whenever the texts might spell it either way, and include every form of the word from the texts' word list. Include every form the user typed and every source term of the existing glossary entry, marked "user" / "existing", unless it is clearly a different word. Do NOT include derived words with their own dictionary entry (adverbs in -mente, nouns in -idad, etc.). confidence: how sure you are that the form is the same word with the same meaning.`;
}

export function formsProposeContent(ctx) {
  return [
    `Headword: ${ctx.headword}`,
    `Forms typed by the user: ${ctx.userVariants.join(", ") || "none"}`,
    `Existing glossary entry source terms: ${ctx.existingSourceTerms.join(", ") || "none"}`,
    ctx.corpusForms?.length
      ? `Forms of the same lemma found in the texts' word list: ${ctx.corpusForms.join(", ")}`
      : "",
    dictionaryBlock(ctx),
  ].filter(Boolean).join("\n");
}

export const FORMS_CONFIRM_SCHEMA = object({
  forms: arrayOf(object({ form: STR, keep: { type: "boolean" }, reason: STR })),
});

export function formsConfirmInstructions(ctx) {
  return `You confirm which surface forms belong to a corpus study of the ${ctx.sourceName} word “${ctx.headword}”. ${corpusLine(ctx)}
For each candidate you get its number of passages in the texts and a few example passages. Keep a form when the examples show it is the same word in the same range of meanings. Drop it when the examples are a different word (a homograph, a name, another lemma). A form with no passages may be kept only if you are highly confident it is a valid form of the same word (e.g. a regular plural). Reasons at most 12 words, in ${ctx.reportName}.`;
}

// --- discovery (open reading) -----------------------------------------------

export const DISCOVERY_SCHEMA = object({
  items: arrayOf(object({
    occId: STR,
    sense: STR,
    corpusSense: NSTR,
    rendering: STR,
    phraseTranslation: STR,
    expressionCandidate: NSTR,
    reason: STR,
  })),
});

export function discoveryInstructions(ctx) {
  return `You are a terminologist preparing a ${ctx.targetName} glossary (TMX) entry for the ${ctx.sourceName} word “${ctx.headword}”. ${corpusLine(ctx)}
Forms in this study: ${ctx.forms.join(", ")}.

${dictionaryBlock(ctx)}

Each passage marks occurrences as ⟦…⟧ [id]. For EVERY marked occurrence return:
- sense: the dictionary sense number that applies ("2"), several if genuinely ambiguous ("2|4"), "complex:<form>" for a listed complex form, or "none".
- corpusSense: null, or a short gloss in ${ctx.sourceName} when the texts use a meaning the dictionary does not list.
- rendering: the single best natural ${ctx.targetName} word or phrase for the marked word in THIS context, as a skilled literary translator would choose it. Do not default to a cognate; do not force consistency.
- phraseTranslation: the minimal ${ctx.targetName} phrase containing that rendering, so collocation is visible.
- expressionCandidate: the ${ctx.sourceName} fixed expression (lower case) if the word is part of a recurring fixed expression that needs its own translation; else null.
- reason: at most 15 words in ${ctx.reportName}.
An "existing translation" line, when present, is only a hint and may be wrong.`;
}

// --- where the term comes from (reference books) ------------------------------

export const SOURCES_SCHEMA = object({
  summary: STR,
  senses: arrayOf(object({
    sense: STR,
    inDictionary: { type: "boolean" },
    sourceBook: NSTR,
    evidence: STR,
    originalLanguage: NSTR,
    originalTerm: NSTR,
    originalTermBasis: STR,
    meaningInSource: STR,
    authorUsage: STR,
    equivalences: arrayOf(object({ term: STR, relation: oneOf("identity", "related", "symbol", "part"), evidence: STR })),
  })),
});

export function sourcesInstructions(ctx) {
  return `You research where a term used by an author comes from, before anyone translates it. The author is ${ctx.authorName}; the texts are ${ctx.corpusDescription}. The author drew on the reference books listed below (the ${ctx.sourceName} editions he used).

You receive: the dictionary entry for the term; how often the term occurs in each reference book; passages from the books that use it most; passages where the author names those books; a sample of the author's own uses; and records of the reference books (original language, first printings, original titles and the book's own glossary pairs where researched). In passages the term is marked ⟦like this⟧.

Work out:
1. Which senses the author uses that the dictionary does not cover (also list the dictionary senses he uses, briefly, with inDictionary true). For each non-dictionary sense, where it comes from: which book or tradition, with evidence from the passages. Frequency alone is not evidence of borrowing: look for the author naming or quoting the book, and for the same distinctive usage.
2. If that book is a translation, the original-language word or phrase that the ${ctx.sourceName} term translates. Use only the records given (e.g. the book's glossary pairs) and say what they are; if the records do not settle it, give your belief and say it is unverified in originalTermBasis. Never invent a record.
3. What the term means in the source book: what it is, what it does, how it relates to the neighbouring concepts of that system. Quote the book.
4. How the author uses it: whether he follows the source, and which other terms he equates it with. relation "identity" only for explicit statements that X is Y; say whether the equated terms are names for the same thing in other systems.
Do not discuss translating the term. Write summary, evidence, originalTermBasis, meaningInSource, authorUsage and relations in ${ctx.reportName}; keep the wording of quotations. ${quotationRule(ctx.reportName, ctx.reportCode)}`;
}

// --- candidate translations of the whole term --------------------------------

export const CANDIDATES_SCHEMA = object({
  senses: arrayOf(object({
    sense: STR,
    candidates: arrayOf(object({ target: STR, recommended: { type: "boolean" }, note: STR, rationale: STR })),
  })),
});

export function candidatesInstructions(ctx) {
  return `You propose candidate ${ctx.targetName} translations of the ${ctx.sourceName} term “${ctx.headword}” for a translators' glossary. ${corpusLine(ctx)} Translators will choose among the candidates passage by passage, so the list must contain every rendering a careful translator could reasonably need, and each candidate needs a note saying when to use it.

Rules:
- Work sense by sense. A candidate must render the meaning the term has in these texts (the study of where the term comes from, when given, explains special senses).
- Prefer renderings that translate the term's own meaning over substituting another term the author equates it with. A synonym names the same thing with a different word; list it only if a translator might really need it, and say in its note that it is a synonym and what is lost.
- If a sense of the term is a translation of an original-language term and ${ctx.targetName} IS that original language, the original term must be one of the candidates for that sense.
- Notes are written in ${ctx.targetName}, at most 40 words. Rationales are in ${ctx.reportName}. ${quotationRules(ctx)}
- Mark at most one candidate per sense as recommended.`;
}

// --- proposal ------------------------------------------------------------

const VARIANT = object({
  id: STR,
  target: STR,
  note: STR,
  senses: arrayOf(STR),
  corpusSense: NSTR,
  rationale: STR,
});

export const PROPOSAL_SCHEMA = object({
  partOfSpeech: STR,
  entries: arrayOf(object({
    id: STR,
    kind: oneOf("word", "expression"),
    sourceTerms: arrayOf(STR),
    generalNote: STR,
    variants: arrayOf(VARIANT),
    populationOccurrencesCited: { type: "integer" },
    rationale: STR,
  })),
  rejectedExpressions: arrayOf(object({ source: STR, reason: STR })),
  derivativeStudies: arrayOf(object({ source: STR, reason: STR })),
  leftOutRenderings: arrayOf(object({ rendering: STR, count: { type: "integer" }, reason: STR })),
  sensesOutsideDictionary: arrayOf(object({ gloss: STR, evidence: STR })),
  openQuestions: arrayOf(STR),
});

export function proposalInstructions(ctx) {
  return `You are a senior terminologist. Consolidate research into proposed ${ctx.targetName} glossary (TMX) entries for the ${ctx.sourceName} word “${ctx.headword}”. ${corpusLine(ctx)}

Principles:
- The dictionary sense inventory (below) is the starting lexical source; the texts decide which senses are attested. A meaning outside the dictionary goes in sensesOutsideDictionary, never presented as a dictionary sense.
- ENTRIES. An entry is one TMX unit: a group of ${ctx.sourceName} source terms that share one set of ${ctx.targetName} translations. Group source forms together only when ${ctx.targetName} does not need to distinguish them; split them when ${ctx.targetName} keeps the distinction. Example: Spanish negro/negra/negros/negras → English "black" is one entry; Spanish llave → English "key" and llaves → "keys" are two entries, because English never renders a plural as a singular; Spanish llave/llaves → Vietnamese "chìa khóa" is one entry, because Vietnamese nouns do not mark number. Every confirmed form belongs to exactly one word entry.
- Variants are distinct ${ctx.targetName} choices a translator picks between. Merge near-synonyms that serve the same contexts; keep variants that serve genuinely different contexts or collocations. Typically 2–7 per entry, ordered by how broadly they apply.
- START FROM THE CANDIDATE STUDY: its candidates were chosen for the term as a whole, from the study of where the term comes from. Keep its recommended candidates unless the readings show they fail.
- Every rendering the open reading used two or more times (see the rendering tally) must be a variant, or be listed in leftOutRenderings with its count and the reason it should not be measured (e.g. it is a synonym the author equates the term with, not a translation of it).
- Prefer renderings of the term's own meaning over another term the author equates it with; such a synonym is a variant only if translators really need it, and its note says so.
- If the term translates an original-language term and ${ctx.targetName} is that original language, the original term must be a variant.
- Existing translations found in the texts (when shown) are hints, not authorities.
- EXPRESSIONS. Propose a separate expression entry (kind "expression") only for a recurring fixed expression (normally ≥3 occurrences in the whole population, or a listed dictionary complex form that is attested) whose translation cannot be composed from the word variants. Its sourceTerms list every surface spelling to match, lower case. Recurring combinations that need no entry go in rejectedExpressions.
- Derived words (other lemmas sharing the stem) are not part of this study; list those worth separate studies in derivativeStudies.
- LANGUAGE: target, every note, and every generalNote are TMX fields and MUST be in ${ctx.targetName}; each note says when to choose the variant (contexts, collocations, what to avoid), at most 40 words. rationale, reason, evidence, and openQuestions are in ${ctx.reportName}. Source-language quotations keep their wording. ${quotationRules(ctx)}
- Ids: entries "e1", "e2", …; variants "e1v1", "e1v2", ….
- populationOccurrencesCited: an expression's whole-population occurrence count from the neighbour table (0 for word entries).

${dictionaryBlock(ctx)}`;
}

// --- comparison with the existing glossary entry -----------------------------

export const COMPARE_SCHEMA = object({
  items: arrayOf(object({
    existing: STR,
    verdict: oneOf("proposed", "left_out"),
    proposedVariantId: NSTR,
    reason: STR,
  })),
});

export function compareInstructions(ctx) {
  return `The research proposal below was made without looking at the glossary. Compare it with the ${ctx.targetName} translations in the glossary's existing entry for “${ctx.headword}”, one item per existing translation. verdict "proposed": the proposal has the same translation or one with the same wording apart from capitals or inflection; give its variant id. "left_out": the proposal does not include it; say in one sentence why, judging from the proposal and its evidence (e.g. a synonym the author equates the term with, a sense the texts do not use, a wrong sense). Do not change the proposal. Reasons in ${ctx.reportName}, at most 30 words. ${quotationRule(ctx.reportName, ctx.reportCode)}`;
}

// --- counting (configuration A) -------------------------------------------

export function frozenEntryText(frozen, targetName) {
  const lines = [];
  for (const entry of frozen.entries) {
    lines.push(`${entry.kind === "expression" ? "EXPRESSION ENTRY" : "ENTRY"} [${entry.id}] “${entry.sourceTerms.join(" / ")}”`);
    lines.push(`General note (${targetName}): ${entry.generalNote}`);
    for (const variant of entry.displayOrder ?? entry.variants) {
      lines.push(`  [${variant.id}] ${variant.target} — ${variant.note}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

export const TRANSLATE_SCHEMA = object({
  items: arrayOf(object({
    occId: STR,
    sentenceTranslation: STR,
    chosenWording: STR,
    status: oneOf("selected", "other", "unresolved"),
    variantId: NSTR,
    otherRendering: NSTR,
    unresolvedReason: { anyOf: [oneOf("insufficient_context", "source_problem", "not_this_word"), { type: "null" }] },
    fit: oneOf("good", "acceptable", "poor"),
    note: STR,
  })),
});

export function translateInstructions(ctx, frozenText) {
  return `You check how occurrences of the ${ctx.sourceName} word “${ctx.headword}” should be translated into ${ctx.targetName}, using fixed glossary entries. ${corpusLine(ctx)} Judge each occurrence on its own merits: what a skilled ${ctx.targetName} translator would actually write in this passage.

The glossary entries (frozen; do not change them):
${frozenText}

Each passage marks one occurrence per id as ⟦…⟧ [id] and states which entry applies. Choose only among that entry's variants. An "existing translation" line, when present, may be wrong; do not copy it.

For every id: first translate into ${ctx.targetName} the complete sentence that contains the marked occurrence (sentenceTranslation), naturally and faithfully, using the entry as guidance. Then:
- chosenWording: the exact characters of your translation that render the marked word or expression (a verbatim substring of sentenceTranslation).
- status "selected" with variantId: the variant that wording realises (inflected or reordered forms count). "other" with otherRendering: none of the variants fits. "unresolved" with unresolvedReason (insufficient_context, source_problem, not_this_word): you cannot decide responsibly; use rarely, never merely because two variants are close.
- fit: how natural and accurate the chosen wording is in your sentence.
- note: at most 20 words, in ${ctx.reportName}.`;
}

// --- report summary ------------------------------------------------------------

export const PROSE_SCHEMA = object({
  summary: STR,
  recommendations: arrayOf(STR),
  unresolvedExplanation: STR,
});

export function proseInstructions(ctx) {
  return `Write the opening summary of a research report about translating the ${ctx.sourceName} word “${ctx.headword}” into ${ctx.targetName} for a glossary. Write in ${ctx.reportName}. Keep proposed ${ctx.targetName} wording and the wording of source-language quotations. ${quotationRule(ctx.reportName, ctx.reportCode)} Summary at most 120 words; at most 6 recommendations of at most 30 words; unresolvedExplanation at most 80 words. The counts measure which proposed variant was judged most appropriate in each sampled context: contextual preference, not frequency in ${ctx.targetName} or exclusive correctness. Use only the data given.`;
}

// --- dictionary fallback via web search -------------------------------------

export const WEB_DICTIONARY_SCHEMA = object({
  found: { type: "boolean" },
  entries: arrayOf(object({
    sourceName: STR,
    url: STR,
    senses: arrayOf(object({ number: STR, labels: STR, definition: STR })),
  })),
});
