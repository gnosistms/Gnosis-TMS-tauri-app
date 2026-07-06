// Shared source-context window builder for AI translate/review/assistant flows.
//
// The context window is a token budget, not a fixed row count: walk outward from
// the target row(s) until the estimated source-token budget is spent. One shared
// budget pair is used everywhere — single-row translate, single-row review, the
// assistant, and the batch translate/review paths — so context sizing is
// consistent across features.

export const AI_CONTEXT_BEFORE_TOKEN_TARGET = 360;
export const AI_CONTEXT_AFTER_TOKEN_TARGET = 220;

// Script-aware source-token estimate: CJK characters are roughly one token each,
// Latin-like text is ~4 chars per token. Shared by the context-window budgets and
// the batch chunker's token cap so both size work the same way.
export function estimateSourceTokens(text) {
  const value = String(text ?? "").trim();
  if (!value) {
    return 0;
  }

  const cjkPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
  const cjkTokenCount = Math.ceil((value.match(cjkPattern) ?? []).length * 1.1);
  const nonCjkText = value.replace(cjkPattern, "");
  const latinLikeTokenCount = Math.ceil(nonCjkText.length / 4);
  return Math.ceil((cjkTokenCount + latinLikeTokenCount) * 1.15);
}

function rowIdentity(row) {
  return String(row?.rowId ?? row?.id ?? "").trim();
}

function readRowFieldText(row, languageCode) {
  if (!languageCode) {
    return "";
  }
  return typeof row?.fields?.[languageCode] === "string"
    ? row.fields[languageCode]
    : String(row?.fields?.[languageCode] ?? "");
}

function resolveRowIndex(rows, rowId) {
  const normalizedRowId = String(rowId ?? "").trim();
  if (!normalizedRowId) {
    return -1;
  }
  return rows.findIndex((row) => rowIdentity(row) === normalizedRowId);
}

function toContextEntry(row, sourceLanguageCode, targetLanguageCode) {
  return {
    rowId: rowIdentity(row),
    sourceText: readRowFieldText(row, sourceLanguageCode),
    targetText: readRowFieldText(row, targetLanguageCode),
  };
}

function collectBeforeRows(rows, index, sourceLanguageCode) {
  const previousRows = [];
  let tokenCount = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && tokenCount < AI_CONTEXT_BEFORE_TOKEN_TARGET;
    cursor -= 1
  ) {
    const row = rows[cursor];
    previousRows.unshift(row);
    tokenCount += estimateSourceTokens(readRowFieldText(row, sourceLanguageCode));
  }
  return previousRows;
}

function collectAfterRows(rows, index, sourceLanguageCode) {
  const nextRows = [];
  let tokenCount = 0;
  for (
    let cursor = index + 1;
    cursor < rows.length && tokenCount < AI_CONTEXT_AFTER_TOKEN_TARGET;
    cursor += 1
  ) {
    const row = rows[cursor];
    nextRows.push(row);
    tokenCount += estimateSourceTokens(readRowFieldText(row, sourceLanguageCode));
  }
  return nextRows;
}

// Single-row window: rows before + the row itself + rows after, in one array.
// Used by the assistant, single-row translate, and single-row review paths.
export function buildRowSourceContextWindow(
  chapterState,
  rowId,
  sourceLanguageCode,
  targetLanguageCode,
) {
  const rows = Array.isArray(chapterState?.rows) ? chapterState.rows : [];
  const rowIndex = resolveRowIndex(rows, rowId);
  if (rowIndex < 0) {
    return [];
  }

  return [
    ...collectBeforeRows(rows, rowIndex, sourceLanguageCode),
    rows[rowIndex],
    ...collectAfterRows(rows, rowIndex, sourceLanguageCode),
  ].map((row) => toContextEntry(row, sourceLanguageCode, targetLanguageCode));
}

// Batch window: rows before the FIRST batch row and rows after the LAST batch
// row, computed once for the whole span. The batch rows are their own mutual
// context, so nothing between first and last is repeated here.
export function buildBatchSourceContext(
  chapterState,
  firstRowId,
  lastRowId,
  sourceLanguageCode,
  targetLanguageCode,
) {
  const rows = Array.isArray(chapterState?.rows) ? chapterState.rows : [];
  const firstIndex = resolveRowIndex(rows, firstRowId);
  const lastIndex = resolveRowIndex(rows, lastRowId);
  if (firstIndex < 0 || lastIndex < 0) {
    return { contextBefore: [], contextAfter: [] };
  }

  return {
    contextBefore: collectBeforeRows(rows, firstIndex, sourceLanguageCode).map((row) =>
      toContextEntry(row, sourceLanguageCode, targetLanguageCode),
    ),
    contextAfter: collectAfterRows(rows, lastIndex, sourceLanguageCode).map((row) =>
      toContextEntry(row, sourceLanguageCode, targetLanguageCode),
    ),
  };
}
