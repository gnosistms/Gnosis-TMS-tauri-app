import { buildEditorDerivedGlossaryModel } from "./editor-glossary-highlighting.js";

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

function normalizeLanguageCode(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveChapterLanguageByCode(languages, languageCode) {
  const normalizedLanguageCode = normalizeLanguageCode(languageCode);
  if (!normalizedLanguageCode) {
    return null;
  }

  const language = (Array.isArray(languages) ? languages : []).find((entry) =>
    entry?.code === normalizedLanguageCode
  );
  if (!language) {
    return {
      code: normalizedLanguageCode,
      name: normalizedLanguageCode,
    };
  }

  return {
    code: normalizedLanguageCode,
    name:
      typeof language?.name === "string" && language.name.trim()
        ? language.name.trim()
        : normalizedLanguageCode,
  };
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
    translationSourceLanguageCode: normalizeLanguageCode(context.translationSourceLanguageCode),
    glossarySourceLanguageCode: normalizeLanguageCode(context.glossarySourceLanguageCode),
    targetLanguageCode: normalizeLanguageCode(context.targetLanguageCode),
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
    requestKey:
      typeof normalized.requestKey === "string" && normalized.requestKey.trim()
        ? normalized.requestKey
        : null,
    translationSourceLanguageCode: normalizeLanguageCode(normalized.translationSourceLanguageCode),
    glossarySourceLanguageCode: normalizeLanguageCode(normalized.glossarySourceLanguageCode),
    targetLanguageCode: normalizeLanguageCode(normalized.targetLanguageCode),
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

export function hydrateEditorDerivedGlossaryEntryState(
  entry,
  chapterLanguages = [],
  glossaryState = null,
) {
  const normalizedEntry = normalizeEditorDerivedGlossaryEntryState(entry);
  if (
    normalizedEntry.status !== "ready"
    || normalizedEntry.matcherModel
    || !normalizedEntry.translationSourceLanguageCode
    || !normalizedEntry.targetLanguageCode
  ) {
    return normalizedEntry;
  }

  const sourceLanguage = resolveChapterLanguageByCode(
    chapterLanguages,
    normalizedEntry.translationSourceLanguageCode,
  );
  const targetLanguage = resolveChapterLanguageByCode(
    chapterLanguages,
    normalizedEntry.targetLanguageCode,
  );
  if (!sourceLanguage || !targetLanguage) {
    return normalizedEntry;
  }

  return {
    ...normalizedEntry,
    matcherModel: buildEditorDerivedGlossaryModel({
      sourceLanguage,
      targetLanguage,
      entries: normalizedEntry.entries,
      glossaryId: glossaryState?.glossaryId ?? null,
      repoName: glossaryState?.repoName ?? "",
      title: glossaryState?.title ?? "",
    }),
  };
}

export function hydrateEditorDerivedGlossariesByRowId(
  derivedGlossariesByRowId,
  chapterLanguages = [],
  glossaryState = null,
) {
  return Object.fromEntries(
    Object.entries(normalizeEditorDerivedGlossariesByRowId(derivedGlossariesByRowId))
      .map(([rowId, entry]) => [
        rowId,
        hydrateEditorDerivedGlossaryEntryState(entry, chapterLanguages, glossaryState),
      ]),
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

export function editorDerivedGlossaryIsStale(entry, context = {}) {
  const normalizedEntry = normalizeEditorDerivedGlossaryEntryState(entry);
  const normalizedContext = buildEditorDerivedGlossaryContext(context);
  if (
    normalizedEntry.status !== "ready"
    || !normalizedEntry.translationSourceLanguageCode
    || !normalizedEntry.targetLanguageCode
  ) {
    return true;
  }

  if (
    normalizedEntry.translationSourceLanguageCode !== normalizedContext.translationSourceLanguageCode
    || normalizedEntry.glossarySourceLanguageCode !== normalizedContext.glossarySourceLanguageCode
    || normalizedEntry.targetLanguageCode !== normalizedContext.targetLanguageCode
    || normalizedEntry.translationSourceText !== normalizedContext.translationSourceText
    || normalizedEntry.glossaryRevisionKey !== normalizedContext.glossaryRevisionKey
  ) {
    return true;
  }

  return normalizedContext.glossarySourceTextOrigin === "row"
    ? normalizedEntry.glossarySourceText !== normalizedContext.glossarySourceText
    : normalizedEntry.glossarySourceTextOrigin === "row";
}

export function editorDerivedGlossaryMatchesContext(entry, context = {}) {
  return !editorDerivedGlossaryIsStale(entry, context);
}

export function resolveEditorDerivedGlossaryEntry(chapterState, rowId) {
  const entriesByRowId = normalizeEditorDerivedGlossariesByRowId(
    chapterState?.derivedGlossariesByRowId,
  );
  const entry = entriesByRowId[rowId];
  return entry ?? null;
}

export function resolveReadyEditorDerivedGlossaryEntry(chapterState, rowId) {
  const entry = resolveEditorDerivedGlossaryEntry(chapterState, rowId);
  return entry?.status === "ready" ? entry : null;
}

function buildCurrentHighlightableDerivedGlossaryContext(chapterState, rowId, entry) {
  const normalizedEntry = normalizeEditorDerivedGlossaryEntryState(entry);
  const row = (Array.isArray(chapterState?.rows) ? chapterState.rows : []).find(
    (candidate) => candidate?.rowId === rowId,
  );
  if (
    !row
    || !normalizedEntry.translationSourceLanguageCode
    || !normalizedEntry.glossarySourceLanguageCode
    || !normalizedEntry.targetLanguageCode
  ) {
    return null;
  }

  const {
    glossarySourceText,
    glossarySourceTextOrigin,
  } = resolveEditorDerivedGlossarySourceText(
    row,
    normalizedEntry.translationSourceLanguageCode,
    normalizedEntry.glossarySourceLanguageCode,
  );

  return buildEditorDerivedGlossaryContext({
    translationSourceLanguageCode: normalizedEntry.translationSourceLanguageCode,
    glossarySourceLanguageCode: normalizedEntry.glossarySourceLanguageCode,
    targetLanguageCode: normalizedEntry.targetLanguageCode,
    translationSourceText: readEditorRowFieldText(
      row,
      "fields",
      normalizedEntry.translationSourceLanguageCode,
    ),
    glossarySourceText,
    glossarySourceTextOrigin,
    glossaryRevisionKey: buildEditorGlossaryRevisionKey(chapterState?.glossary),
  });
}

export function resolveHighlightableEditorDerivedGlossaryEntry(chapterState, rowId) {
  const entry = resolveEditorDerivedGlossaryEntry(chapterState, rowId);
  if (!entry?.matcherModel) {
    return null;
  }

  const context = buildCurrentHighlightableDerivedGlossaryContext(chapterState, rowId, entry);
  if (!context || editorDerivedGlossaryIsStale(entry, context)) {
    return null;
  }

  return entry;
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
