import { buildInlineMarkupSearchHighlightMarkup } from "./editor-inline-markup.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildEditorSearchHighlightKey(languageCode, contentKind = "field") {
  const normalizedLanguageCode =
    typeof languageCode === "string" && languageCode.trim() ? languageCode.trim() : "";
  const normalizedContentKind = contentKind === "footnote" ? "footnote" : "field";
  return normalizedLanguageCode ? `${normalizedLanguageCode}:${normalizedContentKind}` : "";
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
    const contentKind = section?.contentKind === "footnote" ? "footnote" : "field";

    const text = String(section?.text ?? "");
    const highlight = buildInlineMarkupSearchHighlightMarkup(text, searchQuery, languageCode, {
      caseSensitive,
    });
    if (highlight.hasMatches) {
      highlights.set(buildEditorSearchHighlightKey(languageCode, contentKind), highlight);
    }
  }

  return highlights;
}

export function buildEditorSearchHighlightMarkup(text, matches) {
  const sourceText = String(text ?? "");
  const normalizedMatches = (Array.isArray(matches) ? matches : [])
    .map((match) => ({
      start: Number.parseInt(match?.start ?? "", 10),
      end: Number.parseInt(match?.end ?? "", 10),
    }))
    .filter((match) => Number.isInteger(match.start) && Number.isInteger(match.end) && match.end > match.start)
    .sort((left, right) => left.start - right.start);
  if (!sourceText || normalizedMatches.length === 0) {
    return {
      kind: "search",
      html: "",
      hasMatches: false,
      ranges: [],
    };
  }

  let cursor = 0;
  let html = "";
  for (const match of normalizedMatches) {
    if (match.start > cursor) {
      html += escapeHtml(sourceText.slice(cursor, match.start));
    }

    html += `<mark class="translation-language-panel__search-match">${escapeHtml(sourceText.slice(match.start, match.end))}</mark>`;
    cursor = match.end;
  }

  if (cursor < sourceText.length) {
    html += escapeHtml(sourceText.slice(cursor));
  }

  return {
    kind: "search",
    html,
    hasMatches: true,
    ranges: normalizedMatches,
  };
}
