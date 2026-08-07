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

  // Adjacent markers separate with a superscript comma (the footmisc/AMA
  // convention), so [1][2] reads as notes 1 and 2 rather than note 12.
  const separator = range?.adjacentToPrevious
    ? `<sup class="translation-language-panel__inline-footnote translation-language-panel__inline-footnote--separator" aria-hidden="true">,</sup>`
    : "";
  return `${separator}<sup class="translation-language-panel__inline-footnote" aria-label="Footnote ${escapeHtml(marker)}">${escapeHtml(marker)}</sup>`;
}

export function buildStaticInlineFootnoteMarkerRanges(text, footnotes) {
  const validMarkers = new Set(
    normalizeEditorFootnotes(footnotes).map((entry) => entry.marker),
  );
  if (validMarkers.size === 0) {
    return [];
  }

  const ranges = parseUnescapedFootnoteMarkers(extractInlineMarkupVisibleText(text))
    .filter((entry) => validMarkers.has(entry.marker))
    .map((entry) => ({
      start: entry.index,
      end: entry.endIndex,
      marker: entry.marker,
      priority: 30,
      markRenderer: renderStaticInlineFootnoteMarker,
    }));
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start === ranges[index - 1].end) {
      ranges[index].adjacentToPrevious = true;
    }
  }
  return ranges;
}
