import { normalizeEditorFieldImage } from "./editor-images.js";
import {
  extractInlineMarkupVisibleText,
  renderSanitizedInlineMarkupHtml,
  renderSanitizedInlineMarkupWithHighlights,
} from "./editor-inline-markup.js";
import {
  EDITOR_ROW_TEXT_STYLE_CENTERED,
  EDITOR_ROW_TEXT_STYLE_HEADING1,
  EDITOR_ROW_TEXT_STYLE_HEADING2,
  EDITOR_ROW_TEXT_STYLE_INDENTED,
  EDITOR_ROW_TEXT_STYLE_PARAGRAPH,
  EDITOR_ROW_TEXT_STYLE_QUOTE,
  normalizeEditorRowTextStyle,
} from "./editor-row-text-style.js";

export const EDITOR_MODE_TRANSLATE = "translate";
export const EDITOR_MODE_PREVIEW = "preview";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function normalizeEditorMode(value) {
  return value === EDITOR_MODE_PREVIEW
    ? EDITOR_MODE_PREVIEW
    : EDITOR_MODE_TRANSLATE;
}

export function normalizeEditorPreviewSearchState(value) {
  const query = typeof value?.query === "string" ? value.query : "";
  const activeMatchIndex = Number.parseInt(String(value?.activeMatchIndex ?? ""), 10);
  const totalMatchCount = Number.parseInt(String(value?.totalMatchCount ?? ""), 10);
  return {
    query,
    activeMatchIndex: Number.isInteger(activeMatchIndex) && activeMatchIndex >= 0 ? activeMatchIndex : 0,
    totalMatchCount: Number.isInteger(totalMatchCount) && totalMatchCount >= 0 ? totalMatchCount : 0,
  };
}

function previewSearchQuery(searchState) {
  return String(normalizeEditorPreviewSearchState(searchState).query ?? "").trim();
}

function previewTextValue(value) {
  return typeof value === "string" ? value : String(value ?? "");
}

function previewImageCaptionValue(row, languageCode) {
  return previewTextValue(row?.imageCaptions?.[languageCode]);
}

function previewFieldValue(row, languageCode) {
  return previewTextValue(row?.fields?.[languageCode]);
}

function previewFootnoteValue(row, languageCode) {
  return previewTextValue(row?.footnotes?.[languageCode]);
}

export function buildEditorPreviewDocument(rows, languageCode) {
  if (!languageCode) {
    return [];
  }

  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    if (!row || row.lifecycleState === "deleted") {
      return [];
    }

    const text = previewFieldValue(row, languageCode);
    const footnote = previewFootnoteValue(row, languageCode);
    const image = normalizeEditorFieldImage(row?.images?.[languageCode]);
    const caption = previewImageCaptionValue(row, languageCode);
    const textStyle = normalizeEditorRowTextStyle(row?.textStyle);
    const blocks = [];

    if (text.trim()) {
      blocks.push({
        kind: "text",
        rowId: row.rowId ?? "",
        languageCode,
        textStyle,
        text,
      });
    }

    if (footnote.trim()) {
      blocks.push({
        kind: "footnote",
        rowId: row.rowId ?? "",
        languageCode,
        text: footnote,
      });
    }

    if (image) {
      blocks.push({
        kind: "image",
        rowId: row.rowId ?? "",
        languageCode,
        image,
        caption,
      });
    }

    return blocks;
  });
}

function countMatchesInText(text, searchQuery) {
  const normalizedQuery = String(searchQuery ?? "").trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return 0;
  }

  const haystack = extractInlineMarkupVisibleText(previewTextValue(text)).toLocaleLowerCase();
  if (!haystack) {
    return 0;
  }

  let total = 0;
  let fromIndex = 0;
  while (fromIndex <= haystack.length - normalizedQuery.length) {
    const nextIndex = haystack.indexOf(normalizedQuery, fromIndex);
    if (nextIndex < 0) {
      break;
    }

    total += 1;
    fromIndex = nextIndex + normalizedQuery.length;
  }

  return total;
}

function countPreviewSearchMatchesForBlock(block, searchQuery) {
  if (!block || !searchQuery) {
    return 0;
  }

  if (block.kind === "image") {
    return countMatchesInText(block.caption, searchQuery);
  }

  return countMatchesInText(block.text, searchQuery);
}

export function countEditorPreviewSearchMatches(blocks, searchQuery) {
  const normalizedQuery = String(searchQuery ?? "").trim();
  if (!normalizedQuery) {
    return 0;
  }

  return (Array.isArray(blocks) ? blocks : [])
    .reduce((total, block) => total + countPreviewSearchMatchesForBlock(block, normalizedQuery), 0);
}

export function normalizeEditorPreviewSearchForDocument(blocks, searchState) {
  const normalizedState = normalizeEditorPreviewSearchState(searchState);
  const query = previewSearchQuery(normalizedState);
  if (!query) {
    return {
      query: "",
      activeMatchIndex: 0,
      totalMatchCount: 0,
    };
  }

  const totalMatchCount = countEditorPreviewSearchMatches(blocks, query);
  return {
    query,
    activeMatchIndex:
      totalMatchCount > 0
        ? Math.min(normalizedState.activeMatchIndex, totalMatchCount - 1)
        : 0,
    totalMatchCount,
  };
}

export function stepEditorPreviewSearchState(blocks, searchState, direction = "next") {
  const normalizedState = normalizeEditorPreviewSearchForDocument(blocks, searchState);
  if (normalizedState.totalMatchCount <= 0) {
    return normalizedState;
  }

  const delta = direction === "previous" ? -1 : 1;
  return {
    ...normalizedState,
    activeMatchIndex:
      (normalizedState.activeMatchIndex + delta + normalizedState.totalMatchCount)
      % normalizedState.totalMatchCount,
  };
}

function renderPreviewPlainText(text) {
  return renderSanitizedInlineMarkupHtml(previewTextValue(text)).replaceAll("\n", "<br>");
}

function renderPreviewHighlightedText(text, searchState, matchCounter, languageCode = "") {
  const normalizedState = normalizeEditorPreviewSearchState(searchState);
  const query = previewSearchQuery(normalizedState);
  if (!query) {
    return renderPreviewPlainText(text);
  }

  const result = renderSanitizedInlineMarkupWithHighlights(
    previewTextValue(text),
    query,
    languageCode,
    {
      activeMatchIndex: normalizedState.activeMatchIndex,
      markRenderer(segmentHtml, range) {
        const matchIndex = matchCounter.current;
        matchCounter.current += 1;
        const isActive = matchIndex === normalizedState.activeMatchIndex;
        return `<mark class="translate-preview__search-match${isActive ? " is-active" : ""}" data-preview-search-match data-preview-search-match-index="${escapeHtml(String(matchIndex))}">${segmentHtml}</mark>`;
      },
    },
  );

  return result.html;
}

function previewTextTagForStyle(textStyle) {
  switch (normalizeEditorRowTextStyle(textStyle)) {
    case EDITOR_ROW_TEXT_STYLE_HEADING1:
      return "h1";
    case EDITOR_ROW_TEXT_STYLE_HEADING2:
      return "h2";
    case EDITOR_ROW_TEXT_STYLE_QUOTE:
      return "blockquote";
    default:
      return "p";
  }
}

function previewTextVariantForStyle(textStyle) {
  switch (normalizeEditorRowTextStyle(textStyle)) {
    case EDITOR_ROW_TEXT_STYLE_HEADING1:
      return "heading1";
    case EDITOR_ROW_TEXT_STYLE_HEADING2:
      return "heading2";
    case EDITOR_ROW_TEXT_STYLE_QUOTE:
      return "quote";
    case EDITOR_ROW_TEXT_STYLE_INDENTED:
      return "indented";
    case EDITOR_ROW_TEXT_STYLE_CENTERED:
      return "centered";
    default:
      return "paragraph";
  }
}

export function renderEditorPreviewDocumentHtml(blocks, options = {}) {
  const searchState = normalizeEditorPreviewSearchForDocument(blocks, options.searchState);
  const resolveImageSrc =
    typeof options.resolveImageSrc === "function"
      ? options.resolveImageSrc
      : (() => "");
  const matchCounter = { current: 0 };
  const html = (Array.isArray(blocks) ? blocks : [])
    .map((block) => {
      if (block?.kind === "image") {
        const imageSrc = resolveImageSrc(block.image);
        if (!imageSrc) {
          return "";
        }

        const caption = String(block.caption ?? "").trim();
        const captionHtml = caption
          ? `<figcaption class="translate-preview__image-caption" lang="${escapeHtml(block.languageCode ?? "")}">${renderPreviewHighlightedText(block.caption, searchState, matchCounter, block.languageCode)}</figcaption>`
          : "";
        return `<figure class="translate-preview__image-block" data-preview-block="image" data-row-id="${escapeHtml(block.rowId ?? "")}"><img class="translate-preview__image" src="${escapeHtml(imageSrc)}" alt="" loading="eager" />${captionHtml}</figure>`;
      }

      if (block?.kind === "footnote") {
        return `<p class="translate-preview__block translate-preview__block--footnote" data-preview-block="footnote" data-row-id="${escapeHtml(block.rowId ?? "")}" lang="${escapeHtml(block.languageCode ?? "")}"><em>${renderPreviewHighlightedText(block.text, searchState, matchCounter, block.languageCode)}</em></p>`;
      }

      if (block?.kind !== "text") {
        return "";
      }

      const tagName = previewTextTagForStyle(block.textStyle);
      const variant = previewTextVariantForStyle(block.textStyle);
      return `<${tagName} class="translate-preview__block translate-preview__block--${variant}" data-preview-block="${escapeHtml(variant)}" data-row-id="${escapeHtml(block.rowId ?? "")}" lang="${escapeHtml(block.languageCode ?? "")}">${renderPreviewHighlightedText(block.text, searchState, matchCounter, block.languageCode)}</${tagName}>`;
    })
    .filter(Boolean)
    .join("");

  return {
    html,
    searchState,
  };
}

function serializePreviewText(text) {
  return renderSanitizedInlineMarkupHtml(text).replaceAll("\n", "<br>");
}

function serializePreviewImageHtml(block) {
  const exportSrc =
    block?.image?.kind === "url"
      ? block.image.url ?? ""
      : block?.image?.path ?? "";
  if (!exportSrc) {
    return "";
  }

  const caption = String(block.caption ?? "").trim();
  return [
    '<figure style="margin: 1.5em auto; text-align: center;">',
    `<img src="${escapeHtml(exportSrc)}" alt="" style="display: block; margin: 0 auto; max-width: 100%; max-height: 700px; width: auto; height: auto;" />`,
    caption
      ? `<figcaption style="margin-top: 0.6em; text-align: center;">${serializePreviewText(block.caption)}</figcaption>`
      : "",
    "</figure>",
  ].join("");
}

function serializePreviewTextBlock(block) {
  if (block?.kind === "footnote") {
    return `<p><em>${serializePreviewText(block.text)}</em></p>`;
  }

  const normalizedStyle = normalizeEditorRowTextStyle(block?.textStyle);
  if (normalizedStyle === EDITOR_ROW_TEXT_STYLE_HEADING1) {
    return `<h1>${serializePreviewText(block.text)}</h1>`;
  }
  if (normalizedStyle === EDITOR_ROW_TEXT_STYLE_HEADING2) {
    return `<h2>${serializePreviewText(block.text)}</h2>`;
  }
  if (normalizedStyle === EDITOR_ROW_TEXT_STYLE_QUOTE) {
    return `<blockquote>${serializePreviewText(block.text)}</blockquote>`;
  }
  if (normalizedStyle === EDITOR_ROW_TEXT_STYLE_INDENTED) {
    return `<p style="padding-left: 2em;">${serializePreviewText(block.text)}</p>`;
  }
  if (normalizedStyle === EDITOR_ROW_TEXT_STYLE_CENTERED) {
    return `<center><p>${serializePreviewText(block.text)}</p></center>`;
  }

  return `<p>${serializePreviewText(block.text)}</p>`;
}

export function serializeEditorPreviewHtml(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .map((block) => {
      if (block?.kind === "image") {
        return serializePreviewImageHtml(block);
      }

      return serializePreviewTextBlock(block);
    })
    .filter(Boolean)
    .join("\n");
}
