function sanitizeString(value) {
  return typeof value === "string" ? value : String(value ?? "");
}

function sanitizeStringList(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => sanitizeString(value).trim())
    .filter(Boolean);
}

function readEditorRowFieldText(row, fieldKey, languageCode) {
  if (!languageCode) {
    return "";
  }

  return sanitizeString(row?.[fieldKey]?.[languageCode]);
}

export function createEditorDerivedGlossaryEntryState() {
  return {
    status: "idle",
    error: "",
    requestKey: null,
    translationSourceLanguageCode: null,
    glossarySourceLanguageCode: null,
    targetLanguageCode: null,
    translationSourceText: "",
    glossarySourceText: "",
    glossarySourceTextOrigin: null,
    glossaryRevisionKey: "",
    entries: [],
    matcherModel: null,
  };
}

function normalizeGlossarySourceTextOrigin(origin) {
  return origin === "row" || origin === "generated" ? origin : null;
}

export function resolveEditorDerivedGlossarySourceText(
  row,
  translationSourceLanguageCode,
  glossarySourceLanguageCode,
) {
  const glossarySourceText = readEditorRowFieldText(row, "fields", glossarySourceLanguageCode);
  if (!glossarySourceText.trim()) {
    return {
      glossarySourceText: "",
      glossarySourceTextOrigin: "generated",
    };
  }

  const translationSourceText = readEditorRowFieldText(row, "fields", translationSourceLanguageCode);
  const persistedTranslationSourceText = readEditorRowFieldText(
    row,
    "persistedFields",
    translationSourceLanguageCode,
  );
  const persistedGlossarySourceText = readEditorRowFieldText(
    row,
    "persistedFields",
    glossarySourceLanguageCode,
  );
  const translationSourceChanged = translationSourceText !== persistedTranslationSourceText;
  const glossarySourceChanged = glossarySourceText !== persistedGlossarySourceText;
  if (translationSourceChanged && !glossarySourceChanged) {
    return {
      glossarySourceText: "",
      glossarySourceTextOrigin: "generated",
    };
  }

  return {
    glossarySourceText,
    glossarySourceTextOrigin: "row",
  };
}

export function buildEditorDerivedGlossaryContext(context = {}) {
  const glossarySourceText = sanitizeString(context.glossarySourceText);
  return {
    translationSourceLanguageCode:
      typeof context.translationSourceLanguageCode === "string"
        ? context.translationSourceLanguageCode
        : null,
    glossarySourceLanguageCode:
      typeof context.glossarySourceLanguageCode === "string"
        ? context.glossarySourceLanguageCode
        : null,
    targetLanguageCode:
      typeof context.targetLanguageCode === "string" ? context.targetLanguageCode : null,
    translationSourceText: sanitizeString(context.translationSourceText),
    glossarySourceText,
    glossarySourceTextOrigin: normalizeGlossarySourceTextOrigin(
      context.glossarySourceTextOrigin ?? (glossarySourceText.trim() ? "row" : "generated"),
    ),
    glossaryRevisionKey: sanitizeString(context.glossaryRevisionKey),
  };
}

export function normalizeEditorDerivedGlossaryEntryState(entry) {
  const normalized = {
    ...createEditorDerivedGlossaryEntryState(),
    ...(entry && typeof entry === "object" ? entry : {}),
  };

  return {
    ...normalized,
    status: typeof normalized.status === "string" ? normalized.status : "idle",
    error: sanitizeString(normalized.error),
    requestKey: typeof normalized.requestKey === "string" ? normalized.requestKey : null,
    translationSourceLanguageCode:
      typeof normalized.translationSourceLanguageCode === "string"
        ? normalized.translationSourceLanguageCode
        : null,
    glossarySourceLanguageCode:
      typeof normalized.glossarySourceLanguageCode === "string"
        ? normalized.glossarySourceLanguageCode
        : null,
    targetLanguageCode:
      typeof normalized.targetLanguageCode === "string" ? normalized.targetLanguageCode : null,
    translationSourceText: sanitizeString(normalized.translationSourceText),
    glossarySourceText: sanitizeString(normalized.glossarySourceText),
    glossarySourceTextOrigin: normalizeGlossarySourceTextOrigin(
      normalized.glossarySourceTextOrigin,
    ),
    glossaryRevisionKey: sanitizeString(normalized.glossaryRevisionKey),
    entries: (Array.isArray(normalized.entries) ? normalized.entries : []).map((entryValue) => ({
      sourceTerm: sanitizeString(entryValue?.sourceTerm).trim(),
      glossarySourceTerm: sanitizeString(entryValue?.glossarySourceTerm).trim(),
      targetVariants: sanitizeStringList(entryValue?.targetVariants),
      notes: sanitizeStringList(entryValue?.notes),
    })),
    matcherModel:
      normalized.matcherModel && typeof normalized.matcherModel === "object"
        ? normalized.matcherModel
        : null,
  };
}

export function normalizeEditorDerivedGlossariesByRowId(derivedGlossariesByRowId) {
  if (!derivedGlossariesByRowId || typeof derivedGlossariesByRowId !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(derivedGlossariesByRowId)
      .filter(([rowId]) => typeof rowId === "string" && rowId.trim())
      .map(([rowId, entry]) => [rowId, normalizeEditorDerivedGlossaryEntryState(entry)]),
  );
}

function sanitizeGlossaryTerm(term) {
  return {
    sourceTerms: sanitizeStringList(term?.sourceTerms),
    targetTerms: sanitizeStringList(term?.targetTerms),
    notes:
      typeof term?.notesToTranslators === "string" && term.notesToTranslators.trim()
        ? [term.notesToTranslators.trim()]
        : [],
  };
}

export function buildEditorGlossaryRevisionKey(glossaryState) {
  if (!glossaryState || typeof glossaryState !== "object") {
    return "";
  }

  return JSON.stringify({
    glossaryId:
      typeof glossaryState.glossaryId === "string" ? glossaryState.glossaryId.trim() : "",
    repoName: typeof glossaryState.repoName === "string" ? glossaryState.repoName.trim() : "",
    sourceLanguageCode:
      typeof glossaryState?.sourceLanguage?.code === "string"
        ? glossaryState.sourceLanguage.code.trim()
        : "",
    targetLanguageCode:
      typeof glossaryState?.targetLanguage?.code === "string"
        ? glossaryState.targetLanguage.code.trim()
        : "",
    terms: (Array.isArray(glossaryState.terms) ? glossaryState.terms : [])
      .filter((term) => term?.lifecycleState !== "deleted")
      .map((term) => ({
        termId: typeof term?.termId === "string" ? term.termId.trim() : "",
        ...sanitizeGlossaryTerm(term),
      })),
  });
}

export function editorDerivedGlossaryMatchesContext(entry, context = {}) {
  const normalizedEntry = normalizeEditorDerivedGlossaryEntryState(entry);
  const normalizedContext = buildEditorDerivedGlossaryContext(context);
  if (
    normalizedContext.glossarySourceTextOrigin === "row"
      ? (
          normalizedEntry.glossarySourceTextOrigin !== "row"
          || normalizedEntry.glossarySourceText !== normalizedContext.glossarySourceText
        )
      : normalizedEntry.glossarySourceTextOrigin !== "generated"
  ) {
    return false;
  }

  return (
    normalizedEntry.status === "ready"
    && Boolean(normalizedEntry.translationSourceLanguageCode)
    && Boolean(normalizedEntry.targetLanguageCode)
    && normalizedEntry.translationSourceLanguageCode === normalizedContext.translationSourceLanguageCode
    && normalizedEntry.glossarySourceLanguageCode === normalizedContext.glossarySourceLanguageCode
    && normalizedEntry.targetLanguageCode === normalizedContext.targetLanguageCode
    && normalizedEntry.translationSourceText === normalizedContext.translationSourceText
    && normalizedEntry.glossaryRevisionKey === normalizedContext.glossaryRevisionKey
  );
}

export function resolveEditorDerivedGlossaryEntry(chapterState, rowId, context = {}) {
  const entriesByRowId = normalizeEditorDerivedGlossariesByRowId(
    chapterState?.derivedGlossariesByRowId,
  );
  const entry = entriesByRowId[rowId];
  if (!entry) {
    return null;
  }

  return editorDerivedGlossaryMatchesContext(entry, context) ? entry : null;
}

export function applyEditorDerivedGlossaryEntry(chapterState, rowId, nextEntry) {
  if (!chapterState?.chapterId || typeof rowId !== "string" || !rowId.trim()) {
    return chapterState;
  }

  return {
    ...chapterState,
    derivedGlossariesByRowId: {
      ...normalizeEditorDerivedGlossariesByRowId(chapterState.derivedGlossariesByRowId),
      [rowId]: normalizeEditorDerivedGlossaryEntryState(nextEntry),
    },
  };
}

export function removeEditorDerivedGlossaryEntry(chapterState, rowId) {
  if (!chapterState?.chapterId || typeof rowId !== "string" || !rowId.trim()) {
    return chapterState;
  }

  const derivedGlossariesByRowId = normalizeEditorDerivedGlossariesByRowId(
    chapterState.derivedGlossariesByRowId,
  );
  if (!(rowId in derivedGlossariesByRowId)) {
    return chapterState;
  }

  const nextEntries = { ...derivedGlossariesByRowId };
  delete nextEntries[rowId];
  return {
    ...chapterState,
    derivedGlossariesByRowId: nextEntries,
  };
}
