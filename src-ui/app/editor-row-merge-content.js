import {
  normalizeEditorFootnotes,
  parseUnescapedFootnoteMarkers,
} from "./editor-footnotes.js";
import { cloneRowFields } from "./editor-utils.js";
import { cloneRowImages, normalizeEditorFieldImage } from "./editor-images.js";

// Content rules for merging two adjacent editor rows. This module is the JS
// reference for the semantics implemented in Rust by
// src-tauri/src/project_import/chapter_editor/row_merge.rs — the regression
// fixture path uses it directly; the real path runs the Rust command. Keep the
// two in sync.

export function maxEditorFootnoteMarker(text, footnotes) {
  const textMax = parseUnescapedFootnoteMarkers(text).reduce(
    (highest, entry) => Math.max(highest, entry.marker),
    0,
  );
  return normalizeEditorFootnotes(footnotes).reduce(
    (highest, entry) => Math.max(highest, entry.marker),
    textMax,
  );
}

export function shiftEditorFootnoteMarkers(text, offset) {
  const source = String(text ?? "");
  if (!Number.isInteger(offset) || offset <= 0) {
    return source;
  }

  const spans = parseUnescapedFootnoteMarkers(source);
  if (spans.length === 0) {
    return source;
  }

  let result = "";
  let last = 0;
  for (const span of spans) {
    result += source.slice(last, span.index);
    result += `[${span.marker + offset}]`;
    last = span.endIndex;
  }
  return result + source.slice(last);
}

function joinParagraphs(previous, next) {
  const previousText = String(previous ?? "");
  const nextText = String(next ?? "");
  if (!previousText.trim()) {
    return nextText;
  }
  if (!nextText.trim()) {
    return previousText;
  }
  return `${previousText}\n${nextText}`;
}

/**
 * Merges the content of `nextRow` into `previousRow` (both normalized editor
 * rows) and returns the merged row's content maps plus the languages whose
 * image and caption moved out of the next row.
 *
 * Per language: body texts join with a newline; the next row's footnote
 * markers are shifted past the previous row's highest marker (in body text and
 * footnote entries) and the footnote lists concatenate. When only one row has
 * an image for a language the merged row takes it with its caption; when both
 * rows have one, images and captions stay in their original rows.
 */
export function mergeEditorRowContent(previousRow, nextRow) {
  const previousFields = cloneRowFields(previousRow?.fields);
  const nextFields = cloneRowFields(nextRow?.fields);
  const previousCaptions = cloneRowFields(previousRow?.imageCaptions);
  const nextCaptions = cloneRowFields(nextRow?.imageCaptions);
  const previousImages = cloneRowImages(previousRow?.images);
  const nextImages = cloneRowImages(nextRow?.images);
  const languageCodes = new Set([
    ...Object.keys(previousFields),
    ...Object.keys(nextFields),
  ]);

  const fields = {};
  const footnotes = {};
  const imageCaptions = {};
  const images = {};
  const movedImageLanguages = [];

  for (const code of languageCodes) {
    const previousText = previousFields[code] ?? "";
    const nextText = nextFields[code] ?? "";
    const previousEntries = normalizeEditorFootnotes(previousRow?.footnotes?.[code]);
    const nextEntries = normalizeEditorFootnotes(nextRow?.footnotes?.[code]);
    const offset = maxEditorFootnoteMarker(previousText, previousEntries);

    fields[code] = joinParagraphs(previousText, shiftEditorFootnoteMarkers(nextText, offset));
    footnotes[code] = [
      ...previousEntries,
      ...nextEntries.map((entry) => ({ marker: entry.marker + offset, text: entry.text })),
    ];

    const previousImage = normalizeEditorFieldImage(previousImages[code]);
    const nextImage = normalizeEditorFieldImage(nextImages[code]);
    const previousCaption = previousCaptions[code] ?? "";
    const nextCaption = nextCaptions[code] ?? "";
    if (previousImage && nextImage) {
      // Both rows hold an image for this language: leave the images and their
      // captions in their original rows for the user to resolve.
      images[code] = previousImage;
      imageCaptions[code] = previousCaption;
    } else if (nextImage) {
      images[code] = nextImage;
      imageCaptions[code] = nextCaption;
      movedImageLanguages.push(code);
    } else if (previousImage) {
      images[code] = previousImage;
      imageCaptions[code] = previousCaption;
    } else {
      imageCaptions[code] = joinParagraphs(previousCaption, nextCaption);
    }
  }

  return {
    fields,
    footnotes,
    imageCaptions,
    images,
    movedImageLanguages,
  };
}
