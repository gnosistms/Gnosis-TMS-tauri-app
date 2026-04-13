export function cloneRowFields(fields) {
  return Object.fromEntries(
    Object.entries(fields && typeof fields === "object" ? fields : {}).map(([code, value]) => [
      code,
      typeof value === "string" ? value : String(value ?? ""),
    ]),
  );
}

export function normalizeFieldState(fieldState) {
  return {
    reviewed: fieldState?.reviewed === true,
    pleaseCheck: fieldState?.pleaseCheck === true,
  };
}

export function cloneRowFieldStates(fieldStates) {
  return Object.fromEntries(
    Object.entries(fieldStates && typeof fieldStates === "object" ? fieldStates : {}).map(([code, value]) => [
      code,
      normalizeFieldState(value),
    ]),
  );
}

export function hasEditorRow(chapterState, rowId) {
  return Array.isArray(chapterState?.rows)
    && chapterState.rows.some((row) => row?.rowId === rowId);
}

export function hasEditorLanguage(chapterState, languageCode) {
  return Array.isArray(chapterState?.languages)
    && chapterState.languages.some((language) => language?.code === languageCode);
}

export function hasActiveEditorField(chapterState) {
  return hasEditorRow(chapterState, chapterState?.activeRowId)
    && hasEditorLanguage(chapterState, chapterState?.activeLanguageCode);
}

export function findEditorRowById(rowId, chapterState) {
  return chapterState?.rows?.find((row) => row?.rowId === rowId) ?? null;
}

export function buildVisibleEditorLanguageCodeSet(chapterState) {
  const collapsedLanguageCodes =
    chapterState?.collapsedLanguageCodes instanceof Set
      ? chapterState.collapsedLanguageCodes
      : new Set();

  return new Set(
    (Array.isArray(chapterState?.languages) ? chapterState.languages : [])
      .map((language) => (typeof language?.code === "string" ? language.code.trim() : ""))
      .filter((code) => code && !collapsedLanguageCodes.has(code)),
  );
}
