import { editorRowHasUnreadComments } from "./editor-comments.js";
import { rowHasUnresolvedEditorConflict } from "./editor-conflicts.js";

export const EDITOR_ROW_FILTER_MODE_SHOW_ALL = "show-all";
export const EDITOR_ROW_FILTER_MODE_REVIEWED = "reviewed";
export const EDITOR_ROW_FILTER_MODE_NOT_REVIEWED = "not-reviewed";
export const EDITOR_ROW_FILTER_MODE_PLEASE_CHECK = "please-check";
export const EDITOR_ROW_FILTER_MODE_TARGET_EMPTY = "target-empty";
export const EDITOR_ROW_FILTER_MODE_HAS_COMMENTS = "has-comments";
export const EDITOR_ROW_FILTER_MODE_HAS_UNREAD_COMMENTS = "has-unread-comments";
export const EDITOR_ROW_FILTER_MODE_HAS_CONFLICT = "has-conflict";

export const EDITOR_ROW_FILTER_OPTIONS = [
  { value: EDITOR_ROW_FILTER_MODE_SHOW_ALL, label: "Show all" },
  { value: EDITOR_ROW_FILTER_MODE_REVIEWED, label: "Reviewed" },
  { value: EDITOR_ROW_FILTER_MODE_NOT_REVIEWED, label: "Not reviewed" },
  { value: EDITOR_ROW_FILTER_MODE_PLEASE_CHECK, label: "Please check" },
  { value: EDITOR_ROW_FILTER_MODE_TARGET_EMPTY, label: "Target empty" },
  { value: EDITOR_ROW_FILTER_MODE_HAS_COMMENTS, label: "Has comments" },
  { value: EDITOR_ROW_FILTER_MODE_HAS_UNREAD_COMMENTS, label: "Has unread comments" },
  { value: EDITOR_ROW_FILTER_MODE_HAS_CONFLICT, label: "Has conflict" },
];

const EDITOR_ROW_FILTER_OPTION_VALUES = new Set(
  EDITOR_ROW_FILTER_OPTIONS.map((option) => option.value),
);

function normalizeSearchCase(value, languageCode = "") {
  const text = String(value ?? "");
  if (!text) {
    return "";
  }

  try {
    return text.toLocaleLowerCase(languageCode || undefined);
  } catch {
    return text.toLowerCase();
  }
}

function resolveLanguageCode(language) {
  return typeof language?.code === "string" && language.code.trim()
    ? language.code.trim()
    : "";
}

function normalizeCollapsedLanguageCodes(collapsedLanguageCodes) {
  return collapsedLanguageCodes instanceof Set
    ? new Set([...collapsedLanguageCodes].filter(Boolean))
    : new Set();
}

export function normalizeEditorChapterFilterState(filters) {
  return {
    searchQuery: typeof filters?.searchQuery === "string" ? filters.searchQuery : "",
    caseSensitive: filters?.caseSensitive === true,
    rowFilterMode:
      typeof filters?.rowFilterMode === "string" && EDITOR_ROW_FILTER_OPTION_VALUES.has(filters.rowFilterMode)
        ? filters.rowFilterMode
        : EDITOR_ROW_FILTER_MODE_SHOW_ALL,
  };
}

export function editorChapterFiltersAreActive(filters) {
  const normalizedFilters = normalizeEditorChapterFilterState(filters);
  return (
    normalizedFilters.searchQuery.trim().length > 0
    || normalizedFilters.rowFilterMode !== EDITOR_ROW_FILTER_MODE_SHOW_ALL
  );
}

export function labelForEditorRowFilterMode(mode) {
  return EDITOR_ROW_FILTER_OPTIONS.find((option) => option.value === mode)?.label ?? "Show all";
}

export function buildEditorSearchResultKey(rowId, languageCode, start, end) {
  if (!rowId || !languageCode || !Number.isInteger(start) || !Number.isInteger(end)) {
    return "";
  }

  return `${rowId}:${languageCode}:${start}:${end}`;
}

export function findEditorSearchMatches(text, query, languageCode = "", options = {}) {
  const sourceText = String(text ?? "");
  const normalizedQuery = String(query ?? "").trim();
  const caseSensitive = options?.caseSensitive === true;
  if (!sourceText || !normalizedQuery) {
    return [];
  }

  const haystack = caseSensitive ? sourceText : normalizeSearchCase(sourceText, languageCode);
  const needle = caseSensitive ? normalizedQuery : normalizeSearchCase(normalizedQuery, languageCode);
  if (!needle) {
    return [];
  }

  const matches = [];
  let fromIndex = 0;
  while (fromIndex <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, fromIndex);
    if (start < 0) {
      break;
    }

    const end = start + needle.length;
    matches.push({ start, end });
    fromIndex = end;
  }

  return matches;
}

function buildVisibleLanguageCodeSet(languages, collapsedLanguageCodes) {
  const collapsedCodes = normalizeCollapsedLanguageCodes(collapsedLanguageCodes);
  return new Set(
    (Array.isArray(languages) ? languages : [])
      .map((language) => resolveLanguageCode(language))
      .filter((code) => code && !collapsedCodes.has(code)),
  );
}

function findRowSection(row, languageCode) {
  if (!languageCode) {
    return null;
  }

  return (Array.isArray(row?.sections) ? row.sections : []).find((section) => resolveLanguageCode(section) === languageCode) ?? null;
}

function rowHasUnresolvedTextConflict(row, targetLanguageCode) {
  const targetSection = findRowSection(row, targetLanguageCode);
  if (
    targetSection?.hasConflict === true
    || targetSection?.hasTextConflict === true
    || targetSection?.textConflict?.isUnresolved === true
    || targetSection?.textConflict?.status === "unresolved"
    || targetSection?.textConflictState === "unresolved"
    || targetSection?.textConflictState === "conflict"
  ) {
    return true;
  }

  return (
    rowHasUnresolvedEditorConflict(row)
    || row?.hasConflict === true
    || row?.hasTextConflict === true
    || row?.textConflict?.isUnresolved === true
    || row?.textConflict?.status === "unresolved"
    || row?.textConflictState === "unresolved"
    || row?.textConflictState === "conflict"
    || row?.translationConflictState === "unresolved"
    || row?.translationConflictState === "conflict"
  );
}

function rowMatchesFilterMode(row, rowFilterMode, targetLanguageCode, seenRevisions) {
  if (rowFilterMode === EDITOR_ROW_FILTER_MODE_SHOW_ALL) {
    return true;
  }

  const targetSection = findRowSection(row, targetLanguageCode);
  switch (rowFilterMode) {
    case EDITOR_ROW_FILTER_MODE_REVIEWED:
      return targetSection?.reviewed === true;
    case EDITOR_ROW_FILTER_MODE_NOT_REVIEWED:
      return Boolean(targetSection) && targetSection.reviewed !== true;
    case EDITOR_ROW_FILTER_MODE_PLEASE_CHECK:
      return targetSection?.pleaseCheck === true;
    case EDITOR_ROW_FILTER_MODE_TARGET_EMPTY:
      return Boolean(targetSection) && String(targetSection.text ?? "").trim().length === 0;
    case EDITOR_ROW_FILTER_MODE_HAS_COMMENTS:
      return Number.parseInt(String(row?.commentCount ?? ""), 10) > 0;
    case EDITOR_ROW_FILTER_MODE_HAS_UNREAD_COMMENTS:
      return editorRowHasUnreadComments(row, seenRevisions);
    case EDITOR_ROW_FILTER_MODE_HAS_CONFLICT:
      return rowHasUnresolvedTextConflict(row, targetLanguageCode);
    default:
      return true;
  }
}

function buildRowSearchMatches(row, searchQuery, visibleLanguageCodes, caseSensitive = false) {
  const sections = Array.isArray(row?.sections) ? row.sections : [];
  const matchesByLanguage = new Map();
  const results = [];

  for (const section of sections) {
    const languageCode = resolveLanguageCode(section);
    if (!languageCode || !visibleLanguageCodes.has(languageCode)) {
      continue;
    }

    const matches = findEditorSearchMatches(section?.text ?? "", searchQuery, languageCode, {
      caseSensitive,
    });
    if (matches.length === 0) {
      continue;
    }

    const normalizedMatches = matches.map((match) => ({
      key: buildEditorSearchResultKey(row.id, languageCode, match.start, match.end),
      rowId: row.id,
      languageCode,
      start: match.start,
      end: match.end,
      text: String(section?.text ?? "").slice(match.start, match.end),
    }));
    matchesByLanguage.set(languageCode, normalizedMatches);
    results.push(...normalizedMatches);
  }

  return {
    matched: matchesByLanguage.size > 0,
    matchesByLanguage,
    results,
  };
}

export function buildEditorFilterResult({
  rows,
  languages,
  collapsedLanguageCodes,
  filters,
  targetLanguageCode = "",
  commentSeenRevisions = {},
}) {
  const normalizedFilters = normalizeEditorChapterFilterState(filters);
  const visibleLanguageCodes = buildVisibleLanguageCodeSet(languages, collapsedLanguageCodes);
  const rowList = Array.isArray(rows) ? rows : [];
  const conflictRowCount = rowList.filter((row) =>
    row
    && row.kind !== "deleted-group"
    && row.lifecycleState !== "deleted"
    && rowHasUnresolvedTextConflict(row, targetLanguageCode)
  ).length;
  const isConflictLocked = conflictRowCount > 0;
  const effectiveFilters = isConflictLocked
    ? {
      ...normalizedFilters,
      rowFilterMode: EDITOR_ROW_FILTER_MODE_HAS_CONFLICT,
    }
    : normalizedFilters;
  const hasSearchFilter = effectiveFilters.searchQuery.trim().length > 0;
  const hasRowFilter = effectiveFilters.rowFilterMode !== EDITOR_ROW_FILTER_MODE_SHOW_ALL;
  const hasActiveFilters = hasSearchFilter || hasRowFilter;

  if (!hasActiveFilters) {
    return {
      filters: effectiveFilters,
      hasActiveFilters,
      isConflictLocked,
      conflictRowCount,
      filteredRows: rowList,
      visibleLanguageCodes,
      searchResults: [],
      searchMatchesByRowId: new Map(),
      matchingRowCount: rowList.filter((row) => row?.lifecycleState !== "deleted").length,
    };
  }

  const filteredRows = [];
  const searchResults = [];
  const searchMatchesByRowId = new Map();

  for (const row of rowList) {
    if (!row || row.kind === "deleted-group" || row.lifecycleState === "deleted") {
      continue;
    }

    if (!rowMatchesFilterMode(row, effectiveFilters.rowFilterMode, targetLanguageCode, commentSeenRevisions)) {
      continue;
    }

    if (!hasSearchFilter) {
      filteredRows.push(row);
      continue;
    }

    const searchMatches = buildRowSearchMatches(
      row,
      effectiveFilters.searchQuery,
      visibleLanguageCodes,
      effectiveFilters.caseSensitive,
    );
    if (!searchMatches.matched) {
      continue;
    }

    filteredRows.push(row);
    searchResults.push(...searchMatches.results);
    if (searchMatches.matchesByLanguage.size > 0) {
      searchMatchesByRowId.set(row.id, searchMatches.matchesByLanguage);
    }
  }

  return {
    filters: effectiveFilters,
    hasActiveFilters,
    isConflictLocked,
    conflictRowCount,
    filteredRows,
    visibleLanguageCodes,
    searchResults,
    searchMatchesByRowId,
    matchingRowCount: filteredRows.length,
  };
}
