import { escapeHtml } from "../lib/ui.js";
import { mapSrtGroupOffset } from "./editor-srt-group-text.js";
import { extractInlineMarkupVisibleText, renderSanitizedInlineMarkupWithEditorHighlightState } from "./editor-inline-markup.js";

export function renderSrtHistorySelector(row, chapter) {
  if (!row?.srtGroup) return "";
  return `<div class="translation-srt-history-selector segmented-control" role="group" aria-label="Subtitle fragment history">
    ${row.srtGroup.memberRowIds.map((id, index) => `<button type="button" data-action="select-editor-srt-history:${escapeHtml(id)}"
      class="segmented-control__button${chapter.activeRowId === id ? " is-active" : ""}"
      aria-pressed="${chapter.activeRowId === id}">Fragment ${index + 1}</button>`).join("")}</div>`;
}

export function renderSrtStaticText(language, glossaryHighlightHtml) {
  const parts = language.srtParts.map((part) => extractInlineMarkupVisibleText(part));
  const mapOffset = (value) => mapSrtGroupOffset(Number(value), parts, language.srtMarkers, language.code);
  const mappedGlossary = glossaryHighlightHtml.replace(/(data-text-(?:start|end)=")([0-9]+)(")/g,
    (_, start, value, end) => start + mapOffset(value) + end);
  let html = renderSanitizedInlineMarkupWithEditorHighlightState(language.text, {
    glossaryHighlightHtml: mappedGlossary,
    searchRanges: (language.searchHighlightRanges ?? []).map((range) => ({ ...range, start: mapOffset(range.start), end: mapOffset(range.end) })),
  });
  for (const marker of language.srtMarkers) html = html.replaceAll(marker,
    `<span class="translation-srt-marker" title="Subtitle boundary">${escapeHtml(marker)}</span>`);
  return html;
}

