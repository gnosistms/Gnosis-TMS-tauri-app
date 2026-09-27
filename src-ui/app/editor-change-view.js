import { escapeHtml, tooltipAttributes } from "../lib/ui.js";
import {
  buildInlineMarkupDiff,
  renderSanitizedInlineMarkupWithRanges,
} from "./editor-inline-markup.js";
import { normalizeEditorFootnotes } from "./editor-footnotes.js";
import { normalizeEditorRowTextStyle } from "./editor-row-text-style.js";
import { convertLocalFileSrc } from "./runtime.js";

// What the "Changed after my last edit" filter shows for one language of one row: the
// changes since the baseline (my last edit, or the row as created), drawn on the static
// field displays. The text editor itself never sees any of this.
//
// A section's change view:
//   textDiff       — inline-markup diff of the main text, or null when unchanged
//   captionDiff    — same for the image caption
//   footnotes      — [{ marker, diff, change: "insert" | "delete" | "" }] per marker, or
//                    null when no footnote changed
//   image          — { previous: { src, label } | null, currentChanged: bool } or null
//   textStyle      — { previous, current } when the row text style changed, else null

const DIFF_CACHE_LIMIT = 4000;
const diffCache = new Map();

function cachedMarkupDiff(previousMarkup, currentMarkup) {
  const key = `${previousMarkup}\u0000${currentMarkup}`;
  let diff = diffCache.get(key);
  if (!diff) {
    if (diffCache.size >= DIFF_CACHE_LIMIT) {
      diffCache.clear();
    }
    diff = buildInlineMarkupDiff(previousMarkup, currentMarkup);
    diffCache.set(key, diff);
  }
  return diff;
}

function changedMarkupDiff(previousMarkup, currentMarkup) {
  const previous = String(previousMarkup ?? "");
  const current = String(currentMarkup ?? "");
  if (previous === current) {
    return null;
  }
  const diff = cachedMarkupDiff(previous, current);
  return diff.hasChanges ? diff : null;
}

function footnoteChanges(previousFootnote, currentFootnotes) {
  const previousByMarker = new Map(
    normalizeEditorFootnotes(previousFootnote).map((entry) => [entry.marker, entry.text]),
  );
  const currentByMarker = new Map(
    normalizeEditorFootnotes(currentFootnotes).map((entry) => [entry.marker, entry.text]),
  );
  const markers = [...new Set([...previousByMarker.keys(), ...currentByMarker.keys()])]
    .sort((left, right) => left - right);
  let anyChanged = false;
  const entries = markers.map((marker) => {
    const previous = previousByMarker.get(marker);
    const current = currentByMarker.get(marker);
    const diff = changedMarkupDiff(previous ?? "", current ?? "");
    anyChanged ||= Boolean(diff);
    return {
      marker,
      diff,
      change: previous === undefined ? "insert" : current === undefined ? "delete" : "",
    };
  });
  return anyChanged ? entries : null;
}

function imageIdentity(image) {
  if (!image || typeof image !== "object") {
    return "";
  }
  return [image.kind ?? "", image.url ?? "", image.path ?? ""].join("\u0000");
}

function previousImageView(baselineField) {
  const image = baselineField?.image;
  if (!image) {
    return null;
  }
  const src = baselineField.imageDataUrl
    || (image.kind === "url" ? image.url ?? "" : convertLocalFileSrc(image.filePath ?? ""));
  if (!src) {
    return null;
  }
  return {
    src,
    label: image.kind === "url" ? image.url ?? "" : image.fileName ?? image.path ?? "",
  };
}

/**
 * @param {object} options
 * @param {object | null} options.baselineRow  one row of load_gtms_editor_changed_after_my_edit
 * @param {object} options.section             the editor screen model's language section
 * @param {string} options.textStyle            the row's current text style
 */
export function buildEditorSectionChangeView({ baselineRow, section, textStyle }) {
  if (!baselineRow || !section?.code) {
    return null;
  }
  const baselineField = baselineRow.baselineFields?.[section.code] ?? null;
  const previousImageId = imageIdentity(baselineField?.image);
  const currentImageId = imageIdentity(section.image);
  const imageChanged = previousImageId !== currentImageId;
  const previousTextStyle = normalizeEditorRowTextStyle(baselineRow.baselineTextStyle);
  const currentTextStyle = normalizeEditorRowTextStyle(textStyle);

  const view = {
    textDiff: changedMarkupDiff(baselineField?.plainText ?? "", section.text ?? ""),
    captionDiff: changedMarkupDiff(baselineField?.imageCaption ?? "", section.imageCaption ?? ""),
    footnotes: footnoteChanges(baselineField?.footnote ?? "", section.footnotes ?? section.footnote),
    image: imageChanged
      ? { previous: previousImageId ? previousImageView(baselineField) : null, currentChanged: Boolean(currentImageId) }
      : null,
    textStyle: previousTextStyle === currentTextStyle
      ? null
      : { previous: previousTextStyle, current: currentTextStyle },
  };
  return view.textDiff || view.captionDiff || view.footnotes || view.image || view.textStyle
    ? view
    : null;
}

// Deleted and inserted runs sit side by side in the merged text. In joining scripts
// (Persian, Arabic) the last letter of a deleted word would join the first letter of the
// inserted one, so both kinds of run are fenced with zero-width non-joiners.
const ZWNJ = "‌";

function renderChangeMark(segmentHtml, range) {
  if (range.change === "insert") {
    return `${ZWNJ}<span class="history-diff__insert">${segmentHtml}</span>${ZWNJ}`;
  }
  if (range.change === "delete") {
    return `${ZWNJ}<span class="history-diff__delete">${segmentHtml}</span>${ZWNJ}`;
  }
  return `<span class="history-diff__format"${tooltipAttributes(range.note, { side: "top" })}>${segmentHtml}</span>`;
}

export function renderEditorChangeDiffHtml(diff) {
  return renderSanitizedInlineMarkupWithRanges(
    diff.markup,
    diff.ranges.map((range) => ({ ...range, markRenderer: renderChangeMark })),
  );
}

export function renderEditorChangePreviousImage(previousImage, { captionHtml = "" } = {}) {
  if (!previousImage?.src) {
    return "";
  }
  return `
    <div class="translation-language-panel__image-row translation-language-panel__image-row--change-previous">
      <span
        class="translation-language-panel__image-preview translation-language-panel__image-preview--change-previous"
        ${tooltipAttributes(previousImage.label ? `Previous image: ${previousImage.label}` : "Previous image", { side: "top", align: "start" })}
      >
        <img class="translation-language-panel__image" src="${escapeHtml(previousImage.src)}" alt="" loading="eager" referrerpolicy="no-referrer" />
        <svg class="translation-language-panel__image-change-x" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path class="translation-language-panel__image-change-x-halo" d="M4 4 96 96 M96 4 4 96" />
          <path d="M4 4 96 96 M96 4 4 96" />
        </svg>
      </span>
      ${captionHtml
        ? `<div class="translation-language-panel__image-caption-shell translation-language-panel__image-caption-shell--display"><div class="translation-language-panel__image-caption-display"><span class="translation-language-panel__image-caption-text">${captionHtml}</span></div></div>`
        : ""}
    </div>
  `;
}
