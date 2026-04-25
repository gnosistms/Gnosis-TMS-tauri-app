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

function analyzeGlossaryTargetVariants(values) {
  const sanitizedValues = Array.isArray(values)
    ? values.map((value) => sanitizeGlossaryRubyMarkup(value).trim())
    : [];
  const targetTerms = sanitizedValues.filter(Boolean);
  const emptyVariantIndex = sanitizedValues.findIndex((value) => !value);
  if (emptyVariantIndex < 0) {
    return {
      targetTerms,
      noTranslationPosition: null,
    };
  }

  return {
    targetTerms,
    noTranslationPosition:
      targetTerms.length === 0
        ? "only"
        : emptyVariantIndex === 0
          ? "first"
          : "later",
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

function orderedCandidateValues(candidate, orderedKey, setKey) {
  if (Array.isArray(candidate?.[orderedKey])) {
    return sanitizeTermList(candidate[orderedKey]);
  }

  return sanitizeTermList(Array.from(candidate?.[setKey] || []));
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
          existingCandidate.sourceTermsOrdered,
          existingCandidate.sourceTerms,
          entry.sourceTerms,
        );
        appendOrderedUniqueTerms(
          existingCandidate.targetTermsOrdered,
          existingCandidate.targetTerms,
          entry.targetTerms,
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
        if (!existingCandidate.noTranslationPosition && entry.noTranslationPosition) {
          existingCandidate.noTranslationPosition = entry.noTranslationPosition;
        }
        continue;
      }

      const firstToken = tokens[0];
      const sourceTermsOrdered = [];
      const sourceTerms = new Set();
      appendOrderedUniqueTerms(sourceTermsOrdered, sourceTerms, entry.sourceTerms);
      const targetTermsOrdered = [];
      const targetTerms = new Set();
      appendOrderedUniqueTerms(targetTermsOrdered, targetTerms, entry.targetTerms);
      const translatorNotesOrdered = [];
      const translatorNotes = new Set();
      appendOrderedUniqueTerms(translatorNotesOrdered, translatorNotes, entry.translatorNotes);
      const footnotesOrdered = [];
      const footnotes = new Set();
      appendOrderedUniqueTerms(footnotesOrdered, footnotes, entry.footnotes);
      const originTermsOrdered = [];
      const originTerms = new Set();
      appendOrderedUniqueTerms(originTermsOrdered, originTerms, entry.originTerms);
      const candidate = {
        tokens,
        sourceTerms,
        sourceTermsOrdered,
        targetTerms,
        targetTermsOrdered,
        translatorNotes,
        translatorNotesOrdered,
        footnotes,
        footnotesOrdered,
        originTerms,
        originTermsOrdered,
        characterLength: extractGlossaryRubyBaseText(matchTerm).length,
        matchLanguage,
        noTranslationPosition:
          typeof entry.noTranslationPosition === "string" && entry.noTranslationPosition
            ? entry.noTranslationPosition
            : null,
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
    const targetVariantInfo = analyzeGlossaryTargetVariants(term?.targetTerms);
    const details = glossaryDetailFields(term);
    return {
      sourceTerms: sanitizeGlossaryVariantList(term?.sourceTerms),
      targetTerms: targetVariantInfo.targetTerms,
      noTranslationPosition: targetVariantInfo.noTranslationPosition,
      translatorNotes: details.translatorNotes,
      footnotes: details.footnotes,
      matchTerms: sanitizeGlossaryVariantList(term?.sourceTerms),
    };
  });
  const targetEntries = activeTerms.map((term) => {
    const targetVariantInfo = analyzeGlossaryTargetVariants(term?.targetTerms);
    const details = glossaryDetailFields(term);
    return {
      sourceTerms: sanitizeGlossaryVariantList(term?.sourceTerms),
      targetTerms: targetVariantInfo.targetTerms,
      noTranslationPosition: targetVariantInfo.noTranslationPosition,
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
      return {
        sourceTerm: extractGlossaryRubyBaseText(entry?.sourceTerm).trim(),
        glossarySourceTerm: extractGlossaryRubyBaseText(entry?.glossarySourceTerm).trim(),
        targetVariants: targetVariantInfo.targetTerms,
        noTranslationPosition: targetVariantInfo.noTranslationPosition,
        notes: sanitizeTermList(entry?.notes),
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
    noTranslationPosition: entry.noTranslationPosition,
    translatorNotes: entry.notes,
    footnotes: [],
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
    ? orderedCandidateValues(candidate, "targetTermsOrdered", "targetTerms")
    : orderedCandidateValues(candidate, "sourceTermsOrdered", "sourceTerms");
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
      const tooltipAttribute = tooltipText
        ? ` data-editor-glossary-tooltip="${escapeHtmlAttribute(tooltipText)}"`
        : "";
      const tooltipPayloadAttribute = tooltipPayload
        ? ` data-editor-glossary-tooltip-payload="${escapeHtmlAttribute(JSON.stringify(tooltipPayload))}"`
        : "";
      htmlParts.push(
        `<mark class="${matchClasses.join(" ")}" data-editor-glossary-mark data-text-start="${matchStart}" data-text-end="${matchEnd}"${tooltipAttribute}${tooltipPayloadAttribute}>${escapeHtml(segment)}</mark>`,
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

function collectMatchedCandidates(text, matcher) {
  const result = findLongestGlossaryMatches(extractInlineMarkupBaseText(text), matcher);
  const candidates = [];
  const seen = new Set();

  for (const match of result.matches || []) {
    if (!match?.candidate || seen.has(match.candidate)) {
      continue;
    }
    seen.add(match.candidate);
    candidates.push(match.candidate);
  }

  return candidates;
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

  const matchedCandidates = [];
  const seen = new Set();

  for (const section of Array.isArray(sections) ? sections : []) {
    if (section?.code !== glossaryModel.sourceLanguage.code) {
      continue;
    }

    for (const candidate of collectMatchedCandidates(section?.text ?? "", glossaryModel.sourceMatcher)) {
      if (seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);
      matchedCandidates.push(candidate);
    }
  }

  if (matchedCandidates.length === 0) {
    return null;
  }

  const targetEntries = matchedCandidates
    .map((candidate) => {
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

      return {
        sourceTerms: orderedCandidateValues(candidate, "sourceTermsOrdered", "sourceTerms"),
        targetTerms: matchingTargetTerms,
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
    .filter((section) => section?.code === glossaryModel?.targetLanguage?.code)
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
  if (candidate?.noTranslationPosition) {
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
    (section) => section?.code === glossaryModel.targetLanguage.code,
  );

  for (const section of normalizedSections) {
    if (!section?.code) {
      continue;
    }

    if (section.code === glossaryModel.sourceLanguage.code) {
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

    if (section.code === glossaryModel.targetLanguage.code && targetMatcher) {
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
    if (section?.code !== glossaryModel?.sourceLanguage?.code) {
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
    const targetVariants = orderedCandidateValues(
      match?.candidate,
      "targetTermsOrdered",
      "targetTerms",
    ).map((value) => serializeGlossaryRubyForAiPrompt(value));
    const noTranslationPosition = match?.candidate?.noTranslationPosition ?? null;
    const notes = orderedCandidateValues(
      match?.candidate,
      "translatorNotesOrdered",
      "translatorNotes",
    );
    if (!sourceTerm || (targetVariants.length === 0 && notes.length === 0 && !noTranslationPosition)) {
      continue;
    }

    const dedupeKey = normalizeGlossaryToken(sourceTerm, sourceLanguageCode);
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    const hint = {
      sourceTerm,
      targetVariants,
      notes,
    };
    if (noTranslationPosition) {
      hint.noTranslationPosition = noTranslationPosition;
    }
    hints.push(hint);
  }

  return hints;
}
