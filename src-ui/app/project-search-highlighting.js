import { findEditorSearchMatches } from "./editor-filters.js";
import { buildEditorSearchHighlightMarkup } from "./editor-search-highlighting.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildProjectSearchSnippetMarkup(text, query, languageCode = "") {
  const sourceText = String(text ?? "");
  const normalizedQuery = String(query ?? "").trim();
  if (!sourceText) {
    return "";
  }

  if (!normalizedQuery) {
    return escapeHtml(sourceText);
  }

  const matches = findEditorSearchMatches(sourceText, normalizedQuery, languageCode);
  const highlight = buildEditorSearchHighlightMarkup(sourceText, matches);
  return highlight.hasMatches ? highlight.html : escapeHtml(sourceText);
}
