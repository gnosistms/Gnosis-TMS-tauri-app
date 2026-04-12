import { findEditorSearchMatches } from "./editor-filters.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeHighlightMatches(matches, textLength) {
  const normalizedMatches = [];
  let lastEnd = 0;

  for (const match of Array.isArray(matches) ? matches : []) {
    const start = Number.parseInt(match?.start ?? "", 10);
    const end = Number.parseInt(match?.end ?? "", 10);
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) {
      continue;
    }

    const boundedStart = Math.max(lastEnd, Math.min(textLength, start));
    const boundedEnd = Math.max(boundedStart, Math.min(textLength, end));
    if (boundedEnd <= boundedStart) {
      continue;
    }

    normalizedMatches.push({
      start: boundedStart,
      end: boundedEnd,
    });
    lastEnd = boundedEnd;
  }

  return normalizedMatches;
}

export function buildEditorSearchHighlightMarkup(text, matches) {
  const sourceText = String(text ?? "");
  if (!sourceText) {
    return {
      kind: "search",
      html: "",
      hasMatches: false,
    };
  }

  const normalizedMatches = normalizeHighlightMatches(matches, sourceText.length);
  if (normalizedMatches.length === 0) {
    return {
      kind: "search",
      html: "",
      hasMatches: false,
    };
  }

  const htmlParts = [];
  let cursor = 0;

  for (const match of normalizedMatches) {
    if (match.start > cursor) {
      htmlParts.push(escapeHtml(sourceText.slice(cursor, match.start)));
    }

    htmlParts.push(
      `<mark class="translation-language-panel__search-match">${escapeHtml(sourceText.slice(match.start, match.end))}</mark>`,
    );
    cursor = match.end;
  }

  if (cursor < sourceText.length) {
    htmlParts.push(escapeHtml(sourceText.slice(cursor)));
  }

  return {
    kind: "search",
    html: htmlParts.join(""),
    hasMatches: true,
  };
}

export function buildEditorRowSearchHighlights(
  sections,
  searchQuery,
  visibleLanguageCodes = null,
  options = {},
) {
  const highlights = new Map();
  const visibleCodes = visibleLanguageCodes instanceof Set ? visibleLanguageCodes : null;
  const caseSensitive = options?.caseSensitive === true;

  for (const section of Array.isArray(sections) ? sections : []) {
    const languageCode =
      typeof section?.code === "string" && section.code.trim() ? section.code.trim() : "";
    if (!languageCode || (visibleCodes && !visibleCodes.has(languageCode))) {
      continue;
    }

    const text = String(section?.text ?? "");
    const matches = findEditorSearchMatches(text, searchQuery, languageCode, {
      caseSensitive,
    });
    const highlight = buildEditorSearchHighlightMarkup(text, matches);
    if (highlight.hasMatches) {
      highlights.set(languageCode, highlight);
    }
  }

  return highlights;
}

export function mergeEditorTextHighlightMaps(primaryMap, fallbackMap) {
  const merged = new Map();

  if (fallbackMap instanceof Map) {
    for (const [key, value] of fallbackMap.entries()) {
      merged.set(key, value);
    }
  }

  if (primaryMap instanceof Map) {
    for (const [key, value] of primaryMap.entries()) {
      merged.set(key, value);
    }
  }

  return merged;
}
