import { escapeHtml } from "../lib/ui.js";
import { extractInlineMarkupVisibleText } from "./editor-inline-markup.js";
import {
  normalizeEditorFootnotes,
  parseUnescapedFootnoteMarkers,
} from "./editor-footnotes.js";

function renderStaticInlineFootnoteMarker(segmentHtml, range) {
  const marker = Number.parseInt(String(range?.marker ?? ""), 10);
  if (!Number.isInteger(marker) || marker <= 0) {
    return segmentHtml;
  }

  return `<sup class="translation-language-panel__inline-footnote" aria-label="Footnote ${escapeHtml(marker)}">${escapeHtml(marker)}</sup>`;
}

export function buildStaticInlineFootnoteMarkerRanges(text, footnotes) {
  const validMarkers = new Set(
    normalizeEditorFootnotes(footnotes).map((entry) => entry.marker),
  );
  if (validMarkers.size === 0) {
    return [];
  }

  return parseUnescapedFootnoteMarkers(extractInlineMarkupVisibleText(text))
    .filter((entry) => validMarkers.has(entry.marker))
    .map((entry) => ({
      start: entry.index,
      end: entry.endIndex,
      marker: entry.marker,
      priority: 30,
      markRenderer: renderStaticInlineFootnoteMarker,
    }));
}
