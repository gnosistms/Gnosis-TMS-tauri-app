import { buildEditorDerivedGlossaryModel } from "./editor-glossary-highlighting.js";
import {
  GLOSSARY_MATCHER_POLICY,
  GLOSSARY_MATCHER_POLICY_VERSION,
} from "./glossary-token-matcher.js";

function sanitizeString(value) {
  return typeof value === "string" ? value : String(value ?? "");
}

function sanitizeStringList(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => sanitizeString(value).trim())
    .filter(Boolean);
}

function sanitizeTargetVariantList(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const text = sanitizeString(value.text).trim();
        const note = sanitizeString(value.note).trim();
        return text
          ? {
              text,
              ...(note ? { note } : {}),
            }
          : null;
      }
      const text = sanitizeString(value).trim();
      return text ? { text } : null;
    })
    .filter(Boolean);
}

function sanitizeNoTranslation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const position = sanitizeString(value.position).trim();
  if (!position) {
    return null;
  }
  const note = sanitizeString(value.note).trim();
  return {
    position,
    ...(note ? { note } : {}),
  };
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
    glossaryRevisionKey: normalizeEditorGlossaryRevisionKey(context.glossaryRevisionKey),
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
    glossaryRevisionKey: normalizeEditorGlossaryRevisionKey(normalized.glossaryRevisionKey),
    entries: (Array.isArray(normalized.entries) ? normalized.entries : []).map((entryValue) => ({
      sourceTerm: sanitizeString(entryValue?.sourceTerm).trim(),
      glossarySourceTerm: sanitizeString(entryValue?.glossarySourceTerm).trim(),
      targetVariants: sanitizeTargetVariantList(entryValue?.targetVariants),
      noTranslation: sanitizeNoTranslation(entryValue?.noTranslation),
      notes: sanitizeStringList(entryValue?.notes),
      globalNotes: sanitizeStringList(entryValue?.globalNotes),
      footnotes: sanitizeStringList(entryValue?.footnotes),
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

// 53-bit string hash (cyrb53): stable across sessions and platforms, cheap on
// the ~150 KB revision JSON, and collision-safe for the handful of glossary
// revisions a chapter ever sees.
function hashGlossaryRevisionSource(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

const GLOSSARY_REVISION_KEY_PREFIX = "h1:";

// Revision keys used to be the full revision JSON (~150 KB per cached row
// entry, 139 MB of persisted store on one machine). Entries persisted under
// that format still carry the JSON; hashing it here yields exactly the key
// buildEditorGlossaryRevisionKey now produces for the same glossary, so the
// old cache keeps hitting without re-derivation.
export function normalizeEditorGlossaryRevisionKey(value) {
  const key = sanitizeString(value);
  return key.startsWith("{")
    ? `${GLOSSARY_REVISION_KEY_PREFIX}${hashGlossaryRevisionSource(key)}`
    : key;
}

// Classification calls this once per row against the same glossary object;
// memoised by glossary-state identity (state is replaced, not mutated, on
// glossary changes) with the terms array as a guard.
const revisionKeyByGlossaryState = new WeakMap();

export function buildEditorGlossaryRevisionKey(glossaryState) {
  if (!glossaryState || typeof glossaryState !== "object") {
    return "";
  }

  const terms = Array.isArray(glossaryState.terms) ? glossaryState.terms : null;
  const cached = revisionKeyByGlossaryState.get(glossaryState);
  if (cached && cached.terms === terms && cached.termCount === (terms?.length ?? 0)) {
    return cached.key;
  }
  const key = normalizeEditorGlossaryRevisionKey(buildEditorGlossaryRevisionSource(glossaryState));
  revisionKeyByGlossaryState.set(glossaryState, { terms, termCount: terms?.length ?? 0, key });
  return key;
}

function buildEditorGlossaryRevisionSource(glossaryState) {
  return JSON.stringify({
    // Cached derived entries were selected under a specific matcher policy;
    // including it here makes them regenerate on a policy change instead of
    // mixing selection algorithms.
    matcherPolicy: GLOSSARY_MATCHER_POLICY,
    matcherPolicyVersion: GLOSSARY_MATCHER_POLICY_VERSION,
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
  if (typeof rowId !== "string" || !rowId.trim()) {
    return chapterState;
  }

  return applyEditorDerivedGlossaryEntries(chapterState, { [rowId]: nextEntry });
}

// Batch write: one normalization pass over the existing map regardless of how
// many entries land. Applying N entries through the singular helper instead
// re-normalizes the whole map N times — quadratic churn that has frozen the
// editor on large derivation runs.
export function applyEditorDerivedGlossaryEntries(chapterState, entriesByRowId) {
  if (!chapterState?.chapterId || !entriesByRowId || typeof entriesByRowId !== "object") {
    return chapterState;
  }

  const normalizedEntries = {};
  for (const [rowId, entry] of Object.entries(entriesByRowId)) {
    if (typeof rowId === "string" && rowId.trim()) {
      normalizedEntries[rowId] = normalizeEditorDerivedGlossaryEntryState(entry);
    }
  }
  if (Object.keys(normalizedEntries).length === 0) {
    return chapterState;
  }

  return {
    ...chapterState,
    derivedGlossariesByRowId: {
      ...normalizeEditorDerivedGlossariesByRowId(chapterState.derivedGlossariesByRowId),
      ...normalizedEntries,
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
