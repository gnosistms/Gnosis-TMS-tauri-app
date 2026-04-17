import {
  cloneRowImages,
  normalizeEditorFieldImage,
} from "./editor-images.js";

export function cloneRowFields(fields) {
  return Object.fromEntries(
    Object.entries(fields && typeof fields === "object" ? fields : {}).map(([code, value]) => [
      code,
      typeof value === "string" ? value : String(value ?? ""),
    ]),
  );
}

export function normalizeEditorContentKind(value) {
  return value === "footnote" ? "footnote" : "field";
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

export { cloneRowImages, normalizeEditorFieldImage };

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

export function editorFootnoteEditorMatches(chapterState, rowId, languageCode) {
  return (
    chapterState?.footnoteEditor?.rowId === rowId
    && chapterState?.footnoteEditor?.languageCode === languageCode
  );
}

export function editorImageEditorMatches(chapterState, rowId, languageCode, mode = null) {
  if (
    chapterState?.imageEditor?.rowId !== rowId
    || chapterState?.imageEditor?.languageCode !== languageCode
  ) {
    return false;
  }

  return mode ? chapterState?.imageEditor?.mode === mode : true;
}

export function editorImageEditorCanCollapse(editorState) {
  if (!editorState || typeof editorState !== "object") {
    return true;
  }

  if (
    editorState.status === "saving"
    || editorState.status === "submitting"
    || editorState.status === "picking"
    || editorState.invalidUrl === true
  ) {
    return false;
  }

  if (editorState.mode === "url" && String(editorState.urlDraft ?? "").trim()) {
    return false;
  }

  return true;
}

export function editorLanguageFootnoteText(row, languageCode) {
  return typeof row?.footnotes?.[languageCode] === "string"
    ? row.footnotes[languageCode]
    : String(row?.footnotes?.[languageCode] ?? "");
}

export function editorLanguageFootnoteIsVisible(row, languageCode, chapterState) {
  return (
    editorLanguageFootnoteText(row, languageCode).trim().length > 0
    || editorFootnoteEditorMatches(chapterState, row?.rowId ?? "", languageCode)
  );
}

export function editorLanguageImage(row, languageCode) {
  return normalizeEditorFieldImage(row?.images?.[languageCode]);
}

export function buildEditorFieldSelector(rowId, languageCode, contentKind = "field") {
  const rowIdPart = String(rowId ?? "");
  const languageCodePart = String(languageCode ?? "");
  const kind = normalizeEditorContentKind(contentKind);
  const kindSelector = kind === "footnote" ? '[data-content-kind="footnote"]' : ":not([data-content-kind])";
  return `[data-editor-row-field][data-row-id="${CSS.escape(rowIdPart)}"][data-language-code="${CSS.escape(languageCodePart)}"]${kindSelector}`;
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
