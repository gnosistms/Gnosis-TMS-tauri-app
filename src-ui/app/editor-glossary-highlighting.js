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
  return Array.from(String(term ?? "").matchAll(/[\p{L}\p{M}\p{N}]+/gu), (match) =>
    normalizeGlossaryToken(match[0], languageCode),
  );
}

function sanitizeTermList(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function glossaryDetailNotes(term) {
  const notes = [];
  if (typeof term?.notesToTranslators === "string" && term.notesToTranslators.trim()) {
    notes.push(`Notes: ${term.notesToTranslators.trim()}`);
  }
  if (typeof term?.footnote === "string" && term.footnote.trim()) {
    notes.push(`Footnote: ${term.footnote.trim()}`);
  }
  return notes;
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
        for (const sourceTerm of entry.sourceTerms || []) {
          existingCandidate.sourceTerms.add(sourceTerm);
        }
        for (const targetTerm of entry.targetTerms || []) {
          existingCandidate.targetTerms.add(targetTerm);
        }
        for (const note of entry.notes || []) {
          existingCandidate.notes.add(note);
        }
        continue;
      }

      const firstToken = tokens[0];
      const candidate = {
        tokens,
        sourceTerms: new Set(entry.sourceTerms || []),
        targetTerms: new Set(entry.targetTerms || []),
        notes: new Set(entry.notes || []),
        characterLength: String(matchTerm ?? "").length,
        matchLanguage,
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

export function buildEditorGlossaryModel(glossary) {
  const sourceLanguageCode = resolveLanguageCode(glossary?.sourceLanguage);
  const targetLanguageCode = resolveLanguageCode(glossary?.targetLanguage);
  if (!sourceLanguageCode || !targetLanguageCode) {
    return null;
  }

  const sourceLanguage = {
    code: sourceLanguageCode,
    name: resolveLanguageName(glossary?.sourceLanguage, sourceLanguageCode),
  };
  const targetLanguage = {
    code: targetLanguageCode,
    name: resolveLanguageName(glossary?.targetLanguage, targetLanguageCode),
  };
  const activeTerms = (Array.isArray(glossary?.terms) ? glossary.terms : [])
    .filter((term) => term?.lifecycleState !== "deleted");

  const sourceEntries = activeTerms.map((term) => ({
    sourceTerms: sanitizeTermList(term?.sourceTerms),
    targetTerms: sanitizeTermList(term?.targetTerms),
    notes: glossaryDetailNotes(term),
    matchTerms: sanitizeTermList(term?.sourceTerms),
  }));
  const targetEntries = activeTerms.map((term) => ({
    sourceTerms: sanitizeTermList(term?.sourceTerms),
    targetTerms: sanitizeTermList(term?.targetTerms),
    notes: glossaryDetailNotes(term),
    matchTerms: sanitizeTermList(term?.targetTerms),
  }));

  const sourceMatcher = buildLanguageGlossaryMatcher(sourceEntries, sourceLanguage.code);
  const targetMatcher = buildLanguageGlossaryMatcher(targetEntries, targetLanguage.code);

  if (!sourceMatcher && !targetMatcher) {
    return null;
  }

  return {
    glossaryId: typeof glossary?.glossaryId === "string" ? glossary.glossaryId : null,
    repoName: typeof glossary?.repoName === "string" ? glossary.repoName : "",
    title: typeof glossary?.title === "string" ? glossary.title : "",
    sourceLanguage,
    targetLanguage,
    sourceMatcher,
    targetMatcher,
  };
}

function tokenizeTextForHighlighting(text, languageCode) {
  const sourceText = String(text ?? "");
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
  const sourceTerms = Array.from(candidate?.sourceTerms || []);
  const targetTerms = Array.from(candidate?.targetTerms || []);
  const notes = Array.from(candidate?.notes || []);
  const parts = [];

  if (sourceTerms.length > 0) {
    parts.push(sourceTerms.join(", "));
  }
  if (targetTerms.length > 0) {
    const label = glossaryModel?.targetLanguage?.name || glossaryModel?.targetLanguage?.code || "Target";
    parts.push(`${label}: ${targetTerms.join(", ")}`);
  }
  if (notes.length > 0) {
    parts.push(notes.join(" | "));
  }

  return parts.join(" | ");
}

function buildHighlightMarkup(text, matcher, glossaryModel, resolveMatchState = null) {
  const sourceText = String(text ?? "");
  const result = findLongestGlossaryMatches(sourceText, matcher);
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
      const matchStart = characterOffset;
      const matchEnd = matchStart + segment.length;
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
      const tooltipAttribute = tooltipText
        ? ` data-editor-glossary-tooltip="${escapeHtmlAttribute(tooltipText)}"`
        : "";
      htmlParts.push(
        `<mark class="${matchClasses.join(" ")}" data-editor-glossary-mark data-text-start="${matchStart}" data-text-end="${matchEnd}"${tooltipAttribute}>${escapeHtml(segment)}</mark>`,
      );
      characterOffset = matchEnd;
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
  const result = findLongestGlossaryMatches(text, matcher);
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

function buildRowTargetMatcher(sections, glossaryModel) {
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

  const targetEntries = matchedCandidates.map((candidate) => ({
    sourceTerms: Array.from(candidate.sourceTerms || []),
    targetTerms: Array.from(candidate.targetTerms || []),
    notes: Array.from(candidate.notes || []),
    matchTerms: Array.from(candidate.targetTerms || []),
  }));

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
  const targetTerms = Array.from(candidate?.targetTerms || []);
  if (!glossaryModel?.targetLanguage?.code || targetTexts.length === 0 || targetTerms.length === 0) {
    return false;
  }

  return targetTexts.some((targetText) =>
    targetTerms.some((targetTerm) =>
      textContainsGlossaryTerm(targetText, targetTerm, glossaryModel.targetLanguage.code),
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
  const targetMatcher = buildRowTargetMatcher(normalizedSections, glossaryModel);
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
