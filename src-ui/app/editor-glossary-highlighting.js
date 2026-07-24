import { extractInlineMarkupBaseText, mapInlineMarkupBaseRangesToVisibleRanges } from "./editor-inline-markup.js";
import {
  extractGlossaryRubyBaseText,
  extractGlossaryRubyVisibleText,
  glossaryRubyHasAnnotation,
  sanitizeGlossaryRubyMarkup,
  serializeGlossaryRubyForAiPrompt,
  targetTextContainsGlossaryVariantExactRuby,
} from "./glossary-ruby.js";

function resolveLanguageCode(language) {
  if (typeof language === "string" && language.trim()) {
    return language.trim();
  }

  if (language && typeof language === "object") {
    const code = typeof language.code === "string" ? language.code.trim() : "";
    if (code) {
      return code;
    }
  }

  return "";
}

function resolveLanguageName(language, fallbackCode = "") {
  if (language && typeof language === "object") {
    const name = typeof language.name === "string" ? language.name.trim() : "";
    if (name) {
      return name;
    }
  }

  return fallbackCode || "";
}

function sectionSemanticLanguageCode(section) {
  const baseCode = typeof section?.baseCode === "string" ? section.baseCode.trim() : "";
  return baseCode || resolveLanguageCode(section);
}

function sectionMatchesLanguage(section, languageCode) {
  return Boolean(languageCode)
    && (resolveLanguageCode(section) === languageCode || sectionSemanticLanguageCode(section) === languageCode);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeHtmlAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

const NON_SPACE_DELIMITED_LANGUAGE_CODES = new Set([
  "zh",
  "ja",
  "th",
  "lo",
  "km",
  "my",
  "bo",
  "dz",
]);

function primaryLanguageSubtag(languageCode) {
  const [primarySubtag = ""] = String(languageCode ?? "")
    .trim()
    .toLowerCase()
    .split(/[-_]/u);
  return primarySubtag;
}

function isNonSpaceDelimitedGlossaryLanguage(languageCode) {
  return NON_SPACE_DELIMITED_LANGUAGE_CODES.has(primaryLanguageSubtag(languageCode));
}

function textUnitsForGlossaryMatching(text) {
  const normalizedText = String(text ?? "");
  try {
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      return Array.from(
        new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(normalizedText),
        (segment) => segment.segment,
      );
    }
  } catch {
    // Fall back to code points when Intl.Segmenter is unavailable or incomplete.
  }

  return Array.from(normalizedText);
}

function textUnitCanBeMatched(unit) {
  return /[\p{L}\p{M}\p{N}]/u.test(unit);
}

export function normalizeGlossaryToken(token, languageCode = "en") {
  const text = String(token ?? "");
  if (!text) {
    return "";
  }

  try {
    return text.toLocaleLowerCase(languageCode || undefined);
  } catch {
    return text.toLowerCase();
  }
}

export function tokenizeGlossaryTerm(term, languageCode) {
  const baseText = extractGlossaryRubyBaseText(term);
  if (isNonSpaceDelimitedGlossaryLanguage(languageCode)) {
    return textUnitsForGlossaryMatching(baseText)
      .filter(textUnitCanBeMatched)
      .map((unit) => normalizeGlossaryToken(unit, languageCode));
  }

  return Array.from(baseText.matchAll(/[\p{L}\p{M}\p{N}]+/gu), (match) =>
    normalizeGlossaryToken(match[0], languageCode),
  );
}

function sanitizeTermList(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function mergeOrderedUniqueValues(...valueLists) {
  const merged = [];
  const seen = new Set();
  for (const value of valueLists.flatMap((values) => sanitizeTermList(values))) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    merged.push(value);
  }
  return merged;
}

function sanitizeGlossaryVariantList(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => sanitizeGlossaryRubyMarkup(value).trim())
    .filter(Boolean);
}

function glossaryDisplayValues(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => extractGlossaryRubyVisibleText(value).trim())
    .filter(Boolean);
}

function analyzeGlossaryTargetVariants(values, notes = []) {
  const rawVariants = (Array.isArray(values) ? values : []).map((value, index) => {
    const rawText = value && typeof value === "object" && !Array.isArray(value)
      ? value.text
      : value;
    const rawNote = value && typeof value === "object" && !Array.isArray(value)
      ? value.note
      : notes?.[index];
    return {
      text: sanitizeGlossaryRubyMarkup(rawText).trim(),
      note: typeof rawNote === "string" ? rawNote.trim() : "",
    };
  });
  const targetVariants = [];
  const seenTargetVariantIndexes = new Map();
  let noTranslationNote = "";

  rawVariants.forEach((variant) => {
    if (!variant.text) {
      noTranslationNote = mergeTargetVariantNoteText(noTranslationNote, variant.note);
      return;
    }
    const existingIndex = seenTargetVariantIndexes.get(variant.text);
    if (existingIndex !== undefined) {
      targetVariants[existingIndex].note = mergeTargetVariantNoteText(
        targetVariants[existingIndex].note,
        variant.note,
      );
      return;
    }
    seenTargetVariantIndexes.set(variant.text, targetVariants.length);
    targetVariants.push(variant);
  });

  const sanitizedValues = rawVariants.map((variant) => variant.text);
  const targetTerms = targetVariants.map((variant) => variant.text);
  const emptyVariantIndex = sanitizedValues.findIndex((value) => !value);
  const noTranslationPosition = emptyVariantIndex < 0
    ? null
    : targetTerms.length === 0
      ? "only"
      : emptyVariantIndex === 0
        ? "first"
        : "later";
  if (emptyVariantIndex < 0) {
    return {
      targetTerms,
      targetVariants,
      noTranslation: null,
      noTranslationNote: "",
      noTranslationPosition: null,
    };
  }

  return {
    targetTerms,
    targetVariants,
    noTranslation: {
      position: noTranslationPosition,
      ...(noTranslationNote ? { note: noTranslationNote } : {}),
    },
    noTranslationNote,
    noTranslationPosition,
  };
}

function appendOrderedUniqueTerms(orderedTerms, uniqueTerms, incomingValues) {
  for (const value of sanitizeTermList(incomingValues)) {
    if (uniqueTerms.has(value)) {
      continue;
    }
    uniqueTerms.add(value);
    orderedTerms.push(value);
  }
}

function targetVariantKey(variant) {
  return String(variant?.text ?? "").trim();
}

function mergeTargetVariantNoteText(existing, incoming) {
  const note = String(incoming ?? "").trim();
  if (!note) {
    return String(existing ?? "").trim();
  }
  const current = String(existing ?? "").trim();
  if (!current) {
    return note;
  }
  if (current.split("\n\n").some((value) => value.trim() === note)) {
    return current;
  }
  return `${current}\n\n${note}`;
}

function appendOrderedUniqueTargetVariants(orderedVariants, uniqueVariants, incomingValues) {
  for (const incoming of Array.isArray(incomingValues) ? incomingValues : []) {
    const text = sanitizeGlossaryRubyMarkup(incoming?.text ?? "").trim();
    const note = String(incoming?.note ?? "").trim();
    if (!text) {
      continue;
    }
    const key = targetVariantKey({ text, note });
    if (uniqueVariants.has(key)) {
      const existingVariant = orderedVariants.find((variant) => targetVariantKey(variant) === key);
      if (existingVariant) {
        existingVariant.note = mergeTargetVariantNoteText(existingVariant.note, note);
      }
      continue;
    }
    uniqueVariants.add(key);
    orderedVariants.push({ text, note });
  }
}

function orderedCandidateValues(candidate, orderedKey, setKey) {
  if (Array.isArray(candidate?.[orderedKey])) {
    return sanitizeTermList(candidate[orderedKey]);
  }

  return sanitizeTermList(Array.from(candidate?.[setKey] || []));
}

function orderedCandidateTargetVariants(candidate) {
  return Array.isArray(candidate?.targetVariantsOrdered)
    ? candidate.targetVariantsOrdered
        .map((variant) => ({
          text: sanitizeGlossaryRubyMarkup(variant?.text ?? "").trim(),
          note: String(variant?.note ?? "").trim(),
        }))
        .filter((variant) => variant.text)
    : [];
}

function normalizeNoTranslationHint(value, fallbackPosition = null, fallbackNote = "") {
  const position =
    typeof value?.position === "string" && value.position.trim()
      ? value.position.trim()
      : typeof fallbackPosition === "string" && fallbackPosition.trim()
        ? fallbackPosition.trim()
        : "";
  if (!position) {
    return null;
  }
  const note =
    typeof value?.note === "string" && value.note.trim()
      ? value.note.trim()
      : typeof fallbackNote === "string" && fallbackNote.trim()
        ? fallbackNote.trim()
        : "";
  return {
    position,
    ...(note ? { note } : {}),
  };
}

function mergeNoTranslationHint(existing, incoming) {
  const normalizedIncoming = normalizeNoTranslationHint(incoming);
  if (!normalizedIncoming) {
    return existing ?? null;
  }
  const normalizedExisting = normalizeNoTranslationHint(existing);
  if (!normalizedExisting) {
    return normalizedIncoming;
  }
  const note = mergeTargetVariantNoteText(
    normalizedExisting.note,
    normalizedIncoming.note,
  );
  return {
    position: normalizedExisting.position,
    ...(note ? { note } : {}),
  };
}

function candidateNoTranslation(candidate) {
  return normalizeNoTranslationHint(
    candidate?.noTranslation,
    candidate?.noTranslationPosition,
    candidate?.noTranslationNote,
  );
}

function glossaryDetailFields(term) {
  return {
    translatorNotes:
      typeof term?.notesToTranslators === "string" && term.notesToTranslators.trim()
        ? [term.notesToTranslators.trim()]
        : [],
    footnotes:
      typeof term?.footnote === "string" && term.footnote.trim()
        ? [term.footnote.trim()]
        : [],
  };
}

function buildLanguageGlossaryMatcher(entries, matchLanguage) {
  if (!matchLanguage || !Array.isArray(entries)) {
    return null;
  }

  const byFirstToken = new Map();
  const termMap = new Map();

  for (const entry of entries) {
    for (const matchTerm of entry.matchTerms || []) {
      const tokens = tokenizeGlossaryTerm(matchTerm, matchLanguage);
      if (tokens.length === 0) {
        continue;
      }

      const key = tokens.join(" ");
      const existingCandidate = termMap.get(key);
      if (existingCandidate) {
        appendOrderedUniqueTerms(
          existingCandidate.termIdsOrdered,
          existingCandidate.termIds,
          entry.termIds,
        );
        appendOrderedUniqueTerms(
          existingCandidate.sourceTermsOrdered,
          existingCandidate.sourceTerms,
          entry.sourceTerms,
        );
        appendOrderedUniqueTerms(
          existingCandidate.targetTermsOrdered,
          existingCandidate.targetTerms,
          entry.targetTerms,
        );
        appendOrderedUniqueTargetVariants(
          existingCandidate.targetVariantsOrdered,
          existingCandidate.targetVariants,
          entry.targetVariants,
        );
        appendOrderedUniqueTerms(
          existingCandidate.translatorNotesOrdered,
          existingCandidate.translatorNotes,
          entry.translatorNotes,
        );
        appendOrderedUniqueTerms(
          existingCandidate.footnotesOrdered,
          existingCandidate.footnotes,
          entry.footnotes,
        );
        appendOrderedUniqueTerms(
          existingCandidate.originTermsOrdered,
          existingCandidate.originTerms,
          entry.originTerms,
        );
        existingCandidate.noTranslation = mergeNoTranslationHint(
          existingCandidate.noTranslation,
          normalizeNoTranslationHint(
            entry.noTranslation,
            entry.noTranslationPosition,
            entry.noTranslationNote,
          ),
        );
        existingCandidate.noTranslationPosition =
          existingCandidate.noTranslation?.position ?? null;
        existingCandidate.noTranslationNote =
          existingCandidate.noTranslation?.note ?? "";
        continue;
      }

      const firstToken = tokens[0];
      const termIdsOrdered = [];
      const termIds = new Set();
      appendOrderedUniqueTerms(termIdsOrdered, termIds, entry.termIds);
      const sourceTermsOrdered = [];
      const sourceTerms = new Set();
      appendOrderedUniqueTerms(sourceTermsOrdered, sourceTerms, entry.sourceTerms);
      const targetTermsOrdered = [];
      const targetTerms = new Set();
      appendOrderedUniqueTerms(targetTermsOrdered, targetTerms, entry.targetTerms);
      const targetVariantsOrdered = [];
      const targetVariants = new Set();
      appendOrderedUniqueTargetVariants(targetVariantsOrdered, targetVariants, entry.targetVariants);
      const translatorNotesOrdered = [];
      const translatorNotes = new Set();
      appendOrderedUniqueTerms(translatorNotesOrdered, translatorNotes, entry.translatorNotes);
      const footnotesOrdered = [];
      const footnotes = new Set();
      appendOrderedUniqueTerms(footnotesOrdered, footnotes, entry.footnotes);
      const originTermsOrdered = [];
      const originTerms = new Set();
      appendOrderedUniqueTerms(originTermsOrdered, originTerms, entry.originTerms);
      const noTranslation = normalizeNoTranslationHint(
        entry.noTranslation,
        entry.noTranslationPosition,
        entry.noTranslationNote,
      );
      const candidate = {
        tokens,
        termIds,
        termIdsOrdered,
        sourceTerms,
        sourceTermsOrdered,
        targetTerms,
        targetTermsOrdered,
        targetVariants,
        targetVariantsOrdered,
        translatorNotes,
        translatorNotesOrdered,
        footnotes,
        footnotesOrdered,
        originTerms,
        originTermsOrdered,
        characterLength: extractGlossaryRubyBaseText(matchTerm).length,
        matchLanguage,
        noTranslation,
        noTranslationPosition: noTranslation?.position ?? null,
        noTranslationNote: noTranslation?.note ?? "",
      };
      const candidates = byFirstToken.get(firstToken) || [];
      candidates.push(candidate);
      byFirstToken.set(firstToken, candidates);
      termMap.set(key, candidate);
    }
  }

  for (const candidates of byFirstToken.values()) {
    candidates.sort((left, right) => {
      if (right.tokens.length !== left.tokens.length) {
        return right.tokens.length - left.tokens.length;
      }
      return right.characterLength - left.characterLength;
    });
  }

  return {
    languageCode: matchLanguage,
    byFirstToken,
  };
}

function buildEditorGlossaryModelFromEntrySets({
  glossaryId = null,
  repoName = "",
  title = "",
  sourceLanguage,
  targetLanguage,
  sourceEntries = [],
  targetEntries = [],
}) {
  const sourceLanguageCode = resolveLanguageCode(sourceLanguage);
  const targetLanguageCode = resolveLanguageCode(targetLanguage);
  if (!sourceLanguageCode || !targetLanguageCode) {
    return null;
  }

  const normalizedSourceLanguage = {
    code: sourceLanguageCode,
    name: resolveLanguageName(sourceLanguage, sourceLanguageCode),
  };
  const normalizedTargetLanguage = {
    code: targetLanguageCode,
    name: resolveLanguageName(targetLanguage, targetLanguageCode),
  };
  const sourceMatcher = buildLanguageGlossaryMatcher(sourceEntries, normalizedSourceLanguage.code);
  const targetMatcher = buildLanguageGlossaryMatcher(targetEntries, normalizedTargetLanguage.code);

  if (!sourceMatcher && !targetMatcher) {
    return null;
  }

  return {
    glossaryId: typeof glossaryId === "string" ? glossaryId : null,
    repoName: typeof repoName === "string" ? repoName : "",
    title: typeof title === "string" ? title : "",
    sourceLanguage: normalizedSourceLanguage,
    targetLanguage: normalizedTargetLanguage,
    sourceMatcher,
    targetMatcher,
  };
}

export function buildEditorGlossaryModel(glossary) {
  const activeTerms = (Array.isArray(glossary?.terms) ? glossary.terms : [])
    .filter((term) => term?.lifecycleState !== "deleted");

  const sourceEntries = activeTerms.map((term) => {
    const targetVariantInfo = analyzeGlossaryTargetVariants(
      term?.targetTerms,
      term?.targetVariantNotes,
    );
    const details = glossaryDetailFields(term);
    return {
      termIds: typeof term?.termId === "string" && term.termId.trim() ? [term.termId] : [],
      sourceTerms: sanitizeGlossaryVariantList(term?.sourceTerms),
      targetTerms: targetVariantInfo.targetTerms,
      targetVariants: targetVariantInfo.targetVariants,
      noTranslation: targetVariantInfo.noTranslation,
      noTranslationPosition: targetVariantInfo.noTranslationPosition,
      noTranslationNote: targetVariantInfo.noTranslationNote,
      translatorNotes: details.translatorNotes,
      footnotes: details.footnotes,
      matchTerms: sanitizeGlossaryVariantList(term?.sourceTerms),
    };
  });
  const targetEntries = activeTerms.map((term) => {
    const targetVariantInfo = analyzeGlossaryTargetVariants(
      term?.targetTerms,
      term?.targetVariantNotes,
    );
    const details = glossaryDetailFields(term);
    return {
      termIds: typeof term?.termId === "string" && term.termId.trim() ? [term.termId] : [],
      sourceTerms: sanitizeGlossaryVariantList(term?.sourceTerms),
      targetTerms: targetVariantInfo.targetTerms,
      targetVariants: targetVariantInfo.targetVariants,
      noTranslation: targetVariantInfo.noTranslation,
      noTranslationPosition: targetVariantInfo.noTranslationPosition,
      noTranslationNote: targetVariantInfo.noTranslationNote,
      translatorNotes: details.translatorNotes,
      footnotes: details.footnotes,
      matchTerms: targetVariantInfo.targetTerms,
    };
  });

  return buildEditorGlossaryModelFromEntrySets({
    glossaryId: glossary?.glossaryId,
    repoName: glossary?.repoName,
    title: glossary?.title,
    sourceLanguage: glossary?.sourceLanguage,
    targetLanguage: glossary?.targetLanguage,
    sourceEntries,
    targetEntries,
  });
}

export function buildEditorDerivedGlossaryModel({
  sourceLanguage,
  targetLanguage,
  entries = [],
  glossaryId = null,
  repoName = "",
  title = "",
}) {
  const normalizedEntries = (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const targetVariantInfo = analyzeGlossaryTargetVariants(entry?.targetVariants);
      const noTranslation = normalizeNoTranslationHint(
        entry?.noTranslation,
        targetVariantInfo.noTranslationPosition,
        targetVariantInfo.noTranslationNote,
      );
      return {
        sourceTerm: extractGlossaryRubyBaseText(entry?.sourceTerm).trim(),
        glossarySourceTerm: extractGlossaryRubyBaseText(entry?.glossarySourceTerm).trim(),
        targetVariants: targetVariantInfo.targetTerms,
        targetVariantObjects: targetVariantInfo.targetVariants,
        noTranslation,
        noTranslationPosition: noTranslation?.position ?? null,
        noTranslationNote: noTranslation?.note ?? "",
        notes: mergeOrderedUniqueValues(
          sanitizeTermList(entry?.globalNotes),
          sanitizeTermList(entry?.notes),
        ),
        footnotes: sanitizeTermList(entry?.footnotes),
      };
    })
    .filter((entry) =>
      entry.sourceTerm
      && (
        entry.glossarySourceTerm
        || entry.targetVariants.length > 0
        || entry.noTranslationPosition
        || entry.notes.length > 0
      )
    );

  const sourceEntries = normalizedEntries.map((entry) => ({
    sourceTerms: [entry.sourceTerm],
    targetTerms: entry.targetVariants,
    targetVariants: entry.targetVariantObjects,
    noTranslation: entry.noTranslation,
    noTranslationPosition: entry.noTranslationPosition,
    noTranslationNote: entry.noTranslationNote,
    translatorNotes: entry.notes,
    footnotes: entry.footnotes,
    originTerms: entry.glossarySourceTerm ? [entry.glossarySourceTerm] : [],
    matchTerms: [entry.sourceTerm],
  }));

  return buildEditorGlossaryModelFromEntrySets({
    glossaryId,
    repoName,
    title,
    sourceLanguage,
    targetLanguage,
    sourceEntries,
    targetEntries: [],
  });
}

function tokenizeTextForHighlighting(text, languageCode) {
  const sourceText = extractInlineMarkupBaseText(text);
  if (isNonSpaceDelimitedGlossaryLanguage(languageCode)) {
    return tokenizeNonSpaceDelimitedTextForHighlighting(sourceText, languageCode);
  }

  const tokens = [];
  const wordEntries = [];
  let lastIndex = 0;

  for (const match of sourceText.matchAll(/[\p{L}\p{M}\p{N}]+/gu)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      tokens.push({
        type: "text",
        value: sourceText.slice(lastIndex, index),
      });
    }

    const value = match[0];
    const tokenIndex = tokens.length;
    tokens.push({
      type: "word",
      value,
      normalized: normalizeGlossaryToken(value, languageCode),
    });
    wordEntries.push({
      tokenIndex,
      normalized: normalizeGlossaryToken(value, languageCode),
    });
    lastIndex = index + value.length;
  }

  if (lastIndex < sourceText.length) {
    tokens.push({
      type: "text",
      value: sourceText.slice(lastIndex),
    });
  }

  return { tokens, wordEntries };
}

function tokenizeNonSpaceDelimitedTextForHighlighting(sourceText, languageCode) {
  const tokens = [];
  const wordEntries = [];

  for (const unit of textUnitsForGlossaryMatching(sourceText)) {
    const tokenIndex = tokens.length;
    if (textUnitCanBeMatched(unit)) {
      const normalized = normalizeGlossaryToken(unit, languageCode);
      tokens.push({
        type: "word",
        value: unit,
        normalized,
      });
      wordEntries.push({
        tokenIndex,
        normalized,
      });
      continue;
    }

    tokens.push({
      type: "text",
      value: unit,
    });
  }

  return { tokens, wordEntries };
}

export function findLongestGlossaryMatches(text, matcher) {
  if (!matcher) {
    return {
      tokens: [],
      matches: [],
    };
  }

  const tokenizedText = tokenizeTextForHighlighting(text, matcher.languageCode);
  const { tokens, wordEntries } = tokenizedText;
  const matches = [];

  for (let wordIndex = 0; wordIndex < wordEntries.length;) {
    const word = wordEntries[wordIndex];
    const candidates = matcher.byFirstToken.get(word.normalized) || [];
    let matchedCandidate = null;

    for (const candidate of candidates) {
      if (wordIndex + candidate.tokens.length > wordEntries.length) {
        continue;
      }

      const isMatch = candidate.tokens.every(
        (token, candidateIndex) => wordEntries[wordIndex + candidateIndex].normalized === token,
      );
      if (isMatch) {
        matchedCandidate = candidate;
        break;
      }
    }

    if (!matchedCandidate) {
      wordIndex += 1;
      continue;
    }

    matches.push({
      startTokenIndex: wordEntries[wordIndex].tokenIndex,
      endTokenIndex: wordEntries[wordIndex + matchedCandidate.tokens.length - 1].tokenIndex,
      candidate: matchedCandidate,
    });
    wordIndex += matchedCandidate.tokens.length;
  }

  return { tokens, matches };
}

function buildGlossaryTooltipText(candidate, glossaryModel) {
  const sourceTerms = orderedCandidateValues(candidate, "sourceTermsOrdered", "sourceTerms");
  const targetTerms = orderedCandidateValues(candidate, "targetTermsOrdered", "targetTerms");
  const translatorNotes = orderedCandidateValues(
    candidate,
    "translatorNotesOrdered",
    "translatorNotes",
  );
  const footnotes = orderedCandidateValues(candidate, "footnotesOrdered", "footnotes");
  const originTerms = orderedCandidateValues(candidate, "originTermsOrdered", "originTerms");
  const parts = [];
  const sourceTermDisplay = glossaryDisplayValues(sourceTerms);
  const targetTermDisplay = glossaryDisplayValues(targetTerms);
  const originTermDisplay = glossaryDisplayValues(originTerms);

  if (sourceTermDisplay.length > 0) {
    parts.push(sourceTermDisplay.join(", "));
  }
  if (targetTermDisplay.length > 0) {
    const label = glossaryModel?.targetLanguage?.name || glossaryModel?.targetLanguage?.code || "Target";
    parts.push(`${label}: ${targetTermDisplay.join(", ")}`);
  }
  if (translatorNotes.length > 0) {
    parts.push(translatorNotes.join(" | "));
  }
  if (footnotes.length > 0) {
    parts.push(footnotes.join(" | "));
  }
  if (originTermDisplay.length > 0) {
    parts.push(`Glossary source: ${originTermDisplay.join(", ")}`);
  }

  return parts.join(" | ");
}

function resolveStructuredTooltipTitle(candidate, hoveredTerm, glossaryModel) {
  const normalizedHoveredTerm = normalizeGlossaryToken(
    extractGlossaryRubyBaseText(hoveredTerm),
    candidate?.matchLanguage || glossaryModel?.sourceLanguage?.code || "",
  );
  if (!normalizedHoveredTerm) {
    return String(hoveredTerm ?? "").trim();
  }

  const orderedValues = candidate?.matchLanguage === glossaryModel?.targetLanguage?.code
    ? orderedCandidateValues(candidate, "targetTermsOrdered", "targetTerms")
    : orderedCandidateValues(candidate, "sourceTermsOrdered", "sourceTerms");
  return orderedValues.find((value) =>
    normalizeGlossaryToken(
      extractGlossaryRubyBaseText(value),
      candidate?.matchLanguage || glossaryModel?.sourceLanguage?.code || "",
    ) === normalizedHoveredTerm,
  ) || String(hoveredTerm ?? "").trim();
}

function buildStructuredGlossaryTooltipPayload(candidate, hoveredTerm, glossaryModel) {
  const title = resolveStructuredTooltipTitle(candidate, hoveredTerm, glossaryModel);
  const isSourceMatch = candidate?.matchLanguage === glossaryModel?.sourceLanguage?.code;
  const isTargetMatch = candidate?.matchLanguage === glossaryModel?.targetLanguage?.code;
  if (!isSourceMatch && !isTargetMatch) {
    return null;
  }

  const variants = isSourceMatch
    ? orderedCandidateTargetVariants(candidate)
    : orderedCandidateValues(candidate, "sourceTermsOrdered", "sourceTerms");
  const noTranslation = isSourceMatch ? candidateNoTranslation(candidate) : null;
  const matchedTargetVariant = isTargetMatch
    ? orderedCandidateTargetVariants(candidate).find((variant) =>
      normalizeGlossaryToken(
        extractGlossaryRubyBaseText(variant.text),
        candidate?.matchLanguage || glossaryModel?.targetLanguage?.code || "",
      ) === normalizeGlossaryToken(
        extractGlossaryRubyBaseText(title),
        candidate?.matchLanguage || glossaryModel?.targetLanguage?.code || "",
      )
    ) ?? null
    : null;
  const translatorNotes = orderedCandidateValues(
    candidate,
    "translatorNotesOrdered",
    "translatorNotes",
  );
  const footnotes = orderedCandidateValues(candidate, "footnotesOrdered", "footnotes");
  const originTerms = orderedCandidateValues(candidate, "originTermsOrdered", "originTerms");
  if (
    !title
    && variants.length === 0
    && !noTranslation
    && translatorNotes.length === 0
    && footnotes.length === 0
    && originTerms.length === 0
  ) {
    return null;
  }

  return {
    kind: isSourceMatch ? "source" : "target",
    title,
    variants,
    ...(noTranslation ? { noTranslation } : {}),
    targetVariantNote: matchedTargetVariant?.note ?? "",
    translatorNotes,
    footnotes,
    originTerms,
  };
}

function buildHighlightMarkup(text, matcher, glossaryModel, resolveMatchState = null) {
  const sourceText = String(text ?? "");
  const baseText = extractInlineMarkupBaseText(sourceText);
  const result = findLongestGlossaryMatches(baseText, matcher);
  if (!result || result.matches.length === 0) {
    return {
      html: "",
      hasMatches: false,
    };
  }

  const { tokens, matches } = result;
  const htmlParts = [];
  let tokenIndex = 0;
  let matchIndex = 0;
  let characterOffset = 0;

  while (tokenIndex < tokens.length) {
    const currentMatch = matches[matchIndex];
    if (currentMatch && currentMatch.startTokenIndex === tokenIndex) {
      const segment = tokens
        .slice(currentMatch.startTokenIndex, currentMatch.endTokenIndex + 1)
        .map((token) => token.value)
        .join("");
      const baseMatchStart = characterOffset;
      const baseMatchEnd = baseMatchStart + segment.length;
      const [visibleRange] = mapInlineMarkupBaseRangesToVisibleRanges(sourceText, [
        {
          start: baseMatchStart,
          end: baseMatchEnd,
        },
      ]);
      const matchStart = visibleRange?.start ?? baseMatchStart;
      const matchEnd = visibleRange?.end ?? baseMatchEnd;
      const matchState = typeof resolveMatchState === "function"
        ? resolveMatchState(currentMatch.candidate)
        : "normal";
      const matchClasses = [
        "glossary-match",
        "translation-language-panel__glossary-mark",
      ];
      if (matchState === "error") {
        matchClasses.push("glossary-match-error");
      }
      const tooltipText = buildGlossaryTooltipText(currentMatch.candidate, glossaryModel);
      const tooltipPayload = buildStructuredGlossaryTooltipPayload(
        currentMatch.candidate,
        segment,
        glossaryModel,
      );
      // The first contributing term id is the term whose information leads on the
      // hover card, so it is the one a double-click jump opens.
      const [termId] = orderedCandidateValues(currentMatch.candidate, "termIdsOrdered", "termIds");
      const termIdAttribute = termId
        ? ` data-editor-glossary-term-id="${escapeHtmlAttribute(termId)}"`
        : "";
      const tooltipAttribute = tooltipText
        ? ` data-editor-glossary-tooltip="${escapeHtmlAttribute(tooltipText)}"`
        : "";
      const tooltipPayloadAttribute = tooltipPayload
        ? ` data-editor-glossary-tooltip-payload="${escapeHtmlAttribute(JSON.stringify(tooltipPayload))}"`
        : "";
      htmlParts.push(
        `<mark class="${matchClasses.join(" ")}" data-editor-glossary-mark data-text-start="${matchStart}" data-text-end="${matchEnd}"${termIdAttribute}${tooltipAttribute}${tooltipPayloadAttribute}>${escapeHtml(segment)}</mark>`,
      );
      characterOffset = baseMatchEnd;
      tokenIndex = currentMatch.endTokenIndex + 1;
      matchIndex += 1;
      continue;
    }

    const tokenValue = tokens[tokenIndex]?.value ?? "";
    htmlParts.push(escapeHtml(tokenValue));
    characterOffset += tokenValue.length;
    tokenIndex += 1;
  }

  return {
    html: htmlParts.join(""),
    hasMatches: true,
  };
}

function collectMatchedCandidateEntries(text, matcher) {
  const result = findLongestGlossaryMatches(extractInlineMarkupBaseText(text), matcher);
  const entries = [];
  const seen = new Set();

  for (const match of result.matches || []) {
    if (!match?.candidate || seen.has(match.candidate)) {
      continue;
    }
    seen.add(match.candidate);
    entries.push({
      candidate: match.candidate,
      sourceTerm: buildMatchedGlossarySegment(result.tokens, match),
    });
  }

  return entries;
}

function targetTextContainsCandidateVariant(targetText, targetTerm, languageCode) {
  return glossaryRubyHasAnnotation(targetTerm)
    ? targetTextContainsGlossaryVariantExactRuby(targetText, targetTerm, languageCode)
    : textContainsGlossaryTerm(
        extractInlineMarkupBaseText(targetText),
        targetTerm,
        languageCode,
      );
}

function targetTextsContainCandidateVariant(targetTexts, targetTerm, languageCode) {
  return targetTexts.some((targetText) =>
    targetTextContainsCandidateVariant(targetText, targetTerm, languageCode)
  );
}

function buildRowTargetMatcher(sections, glossaryModel, targetTexts) {
  if (!glossaryModel?.sourceMatcher) {
    return null;
  }

  const matchedCandidateEntries = [];
  const seen = new Set();

  for (const section of Array.isArray(sections) ? sections : []) {
    if (!sectionMatchesLanguage(section, glossaryModel.sourceLanguage.code)) {
      continue;
    }

    for (const entry of collectMatchedCandidateEntries(section?.text ?? "", glossaryModel.sourceMatcher)) {
      const candidate = entry.candidate;
      if (seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);
      matchedCandidateEntries.push(entry);
    }
  }

  if (matchedCandidateEntries.length === 0) {
    return null;
  }

  const targetEntries = matchedCandidateEntries
    .map((entry) => {
      const candidate = entry.candidate;
      const matchingTargetTerms = orderedCandidateValues(
        candidate,
        "targetTermsOrdered",
        "targetTerms",
      ).filter((targetTerm) =>
        targetTextsContainCandidateVariant(
          targetTexts,
          targetTerm,
          glossaryModel.targetLanguage.code,
        )
      );
      if (matchingTargetTerms.length === 0) {
        return null;
      }
      const matchingTargetVariants = orderedCandidateTargetVariants(candidate)
        .filter((variant) => matchingTargetTerms.includes(variant.text));

      return {
        termIds: orderedCandidateValues(candidate, "termIdsOrdered", "termIds"),
        sourceTerms: entry.sourceTerm
          ? [entry.sourceTerm]
          : orderedCandidateValues(candidate, "sourceTermsOrdered", "sourceTerms"),
        targetTerms: matchingTargetTerms,
        targetVariants: matchingTargetVariants,
        translatorNotes: orderedCandidateValues(
          candidate,
          "translatorNotesOrdered",
          "translatorNotes",
        ),
        footnotes: orderedCandidateValues(candidate, "footnotesOrdered", "footnotes"),
        matchTerms: matchingTargetTerms,
      };
    })
    .filter(Boolean);

  if (targetEntries.length === 0) {
    return null;
  }

  return buildLanguageGlossaryMatcher(targetEntries, glossaryModel.targetLanguage.code);
}

function rowTargetTexts(sections, glossaryModel) {
  return (Array.isArray(sections) ? sections : [])
    .filter((section) => sectionMatchesLanguage(section, glossaryModel?.targetLanguage?.code))
    .map((section) => String(section?.text ?? ""));
}

function textContainsGlossaryTerm(text, term, languageCode) {
  const tokens = tokenizeGlossaryTerm(term, languageCode);
  if (tokens.length === 0) {
    return false;
  }

  const { wordEntries } = tokenizeTextForHighlighting(text, languageCode);
  for (let wordIndex = 0; wordIndex <= wordEntries.length - tokens.length; wordIndex += 1) {
    const isMatch = tokens.every(
      (token, candidateIndex) => wordEntries[wordIndex + candidateIndex]?.normalized === token,
    );
    if (isMatch) {
      return true;
    }
  }

  return false;
}

function sourceCandidateHasTargetMatch(candidate, targetTexts, glossaryModel) {
  if (candidateNoTranslation(candidate)) {
    return true;
  }

  const targetTerms = orderedCandidateValues(candidate, "targetTermsOrdered", "targetTerms");
  if (!glossaryModel?.targetLanguage?.code || targetTexts.length === 0 || targetTerms.length === 0) {
    return false;
  }

  return targetTexts.some((targetText) =>
    targetTerms.some((targetTerm) =>
      targetTextContainsCandidateVariant(
        targetText,
        targetTerm,
        glossaryModel.targetLanguage.code,
      ),
    ),
  );
}

export function buildEditorRowGlossaryHighlights(sections, glossaryModel) {
  const highlights = new Map();
  if (!glossaryModel?.sourceMatcher) {
    return highlights;
  }

  const normalizedSections = Array.isArray(sections) ? sections : [];
  const targetTexts = rowTargetTexts(normalizedSections, glossaryModel);
  const targetMatcher = buildRowTargetMatcher(normalizedSections, glossaryModel, targetTexts);
  const hasTargetColumn = normalizedSections.some(
    (section) => sectionMatchesLanguage(section, glossaryModel.targetLanguage.code),
  );

  for (const section of normalizedSections) {
    if (!section?.code) {
      continue;
    }

    if (sectionMatchesLanguage(section, glossaryModel.sourceLanguage.code)) {
      const highlight = buildHighlightMarkup(
        section.text ?? "",
        glossaryModel.sourceMatcher,
        glossaryModel,
        hasTargetColumn
          ? (candidate) =>
              sourceCandidateHasTargetMatch(candidate, targetTexts, glossaryModel)
                ? "normal"
                : "error"
          : null,
      );
      if (highlight.hasMatches) {
        highlights.set(section.code, highlight);
      }
      continue;
    }

    if (sectionMatchesLanguage(section, glossaryModel.targetLanguage.code) && targetMatcher) {
      const highlight = buildHighlightMarkup(
        section.text ?? "",
        targetMatcher,
        glossaryModel,
      );
      if (highlight.hasMatches) {
        highlights.set(section.code, highlight);
      }
    }
  }

  return highlights;
}

export function buildEditorRowSourceGlossaryHighlights(sections, glossaryModel) {
  const highlights = new Map();
  if (!glossaryModel?.sourceMatcher) {
    return highlights;
  }

  for (const section of Array.isArray(sections) ? sections : []) {
    if (!sectionMatchesLanguage(section, glossaryModel?.sourceLanguage?.code)) {
      continue;
    }

    const highlight = buildHighlightMarkup(
      section.text ?? "",
      glossaryModel.sourceMatcher,
      glossaryModel,
      null,
    );
    if (highlight.hasMatches) {
      highlights.set(section.code, highlight);
    }
  }

  return highlights;
}

function buildMatchedGlossarySegment(tokens, match) {
  return (Array.isArray(tokens) ? tokens : [])
    .slice(match?.startTokenIndex ?? 0, (match?.endTokenIndex ?? -1) + 1)
    .map((token) => token?.value ?? "")
    .join("")
    .trim();
}

export function buildEditorAiTranslationGlossaryHints(
  sourceText,
  sourceLanguageCode,
  targetLanguageCode,
  glossaryModel,
) {
  if (
    !glossaryModel?.sourceMatcher
    || sourceLanguageCode !== glossaryModel?.sourceLanguage?.code
    || targetLanguageCode !== glossaryModel?.targetLanguage?.code
  ) {
    return [];
  }

  const result = findLongestGlossaryMatches(sourceText, glossaryModel.sourceMatcher);
  const hints = [];
  const seen = new Set();

  for (const match of result.matches || []) {
    const sourceTerm = buildMatchedGlossarySegment(result.tokens, match);
    const targetVariants = orderedCandidateTargetVariants(match?.candidate)
      .map((variant) => {
        const text = serializeGlossaryRubyForAiPrompt(variant.text);
        return {
          ...(text ? { text } : {}),
          ...(variant.note ? { note: variant.note } : {}),
        };
      })
      .filter((variant) => variant.text);
    const noTranslation = candidateNoTranslation(match?.candidate);
    const globalNotes = orderedCandidateValues(
      match?.candidate,
      "translatorNotesOrdered",
      "translatorNotes",
    );
    const footnotes = orderedCandidateValues(match?.candidate, "footnotesOrdered", "footnotes");
    if (!sourceTerm || (targetVariants.length === 0 && globalNotes.length === 0 && footnotes.length === 0 && !noTranslation)) {
      continue;
    }

    const dedupeKey = normalizeGlossaryToken(sourceTerm, sourceLanguageCode);
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    const hint = {
      sourceTerm,
    };
    if (targetVariants.length > 0) {
      hint.targetVariants = targetVariants;
    }
    if (globalNotes.length > 0) {
      hint.globalNotes = globalNotes;
      hint.notes = globalNotes;
    }
    if (footnotes.length > 0) {
      hint.footnotes = footnotes;
    }
    if (noTranslation) {
      hint.noTranslation = noTranslation;
    }
    hints.push(hint);
  }

  return hints;
}
