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
  };
}

export function editorChapterFiltersAreActive(filters) {
  const normalizedFilters = normalizeEditorChapterFilterState(filters);
  return normalizedFilters.searchQuery.trim().length > 0;
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
}) {
  const normalizedFilters = normalizeEditorChapterFilterState(filters);
  const visibleLanguageCodes = buildVisibleLanguageCodeSet(languages, collapsedLanguageCodes);
  const hasActiveFilters = editorChapterFiltersAreActive(normalizedFilters);
  const rowList = Array.isArray(rows) ? rows : [];

  if (!hasActiveFilters) {
    return {
      filters: normalizedFilters,
      hasActiveFilters,
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

    const searchMatches = buildRowSearchMatches(
      row,
      normalizedFilters.searchQuery,
      visibleLanguageCodes,
      normalizedFilters.caseSensitive,
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
    filters: normalizedFilters,
    hasActiveFilters,
    filteredRows,
    visibleLanguageCodes,
    searchResults,
    searchMatchesByRowId,
    matchingRowCount: filteredRows.length,
  };
}
