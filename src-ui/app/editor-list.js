// List rows: one row holds a whole list. Each line of the row text is an item,
// and the tabs that start a line give its nesting level. The row's text style
// picks the list style; how each level looks follows from it. The Rust exports
// follow the same rules (chapter_editor/list_style.rs). See
// plans/list-row-style-plan.md.
import { splitHtmlParagraphs } from "./editor-footnote-paragraphs.js";
import { extractInlineMarkupVisibleText, splitInlineMarkupTextIntoLines } from "./editor-inline-markup.js";
import {
  EDITOR_ROW_TEXT_STYLE_LIST_BULLET,
  EDITOR_ROW_TEXT_STYLE_LIST_LETTER,
  EDITOR_ROW_TEXT_STYLE_LIST_NUMBER,
  EDITOR_ROW_TEXT_STYLE_LIST_ROMAN,
  normalizeEditorRowTextStyle,
} from "./editor-row-text-style.js";

// Nine levels, the most Word numbering allows.
export const LIST_MAX_LEVEL = 8;

// Local, like editor-preview.js: ../lib/ui.js imports SVG assets, which the
// Node-side export specs cannot load.
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const LEVEL_FORMATS = {
  [EDITOR_ROW_TEXT_STYLE_LIST_BULLET]: ["disc", "circle", "square"],
  [EDITOR_ROW_TEXT_STYLE_LIST_NUMBER]: ["decimal", "lower-alpha", "lower-roman"],
  [EDITOR_ROW_TEXT_STYLE_LIST_LETTER]: ["lower-alpha", "lower-roman", "decimal"],
  [EDITOR_ROW_TEXT_STYLE_LIST_ROMAN]: ["upper-roman", "upper-alpha", "decimal", "lower-alpha", "lower-roman"],
};

const BULLET_MARKERS = {
  disc: "•",
  circle: "◦",
  square: "▪",
};

// The CSS list-style-type of a level.
export function listLevelFormat(textStyle, level) {
  const formats = LEVEL_FORMATS[normalizeEditorRowTextStyle(textStyle)] ?? LEVEL_FORMATS[EDITOR_ROW_TEXT_STYLE_LIST_BULLET];
  return formats[Math.max(0, level) % formats.length];
}

export function listFormatIsOrdered(format) {
  return !Object.hasOwn(BULLET_MARKERS, format);
}

function alphabeticCounter(value) {
  let remaining = value;
  let text = "";
  while (remaining > 0) {
    remaining -= 1;
    text = String.fromCharCode(97 + (remaining % 26)) + text;
    remaining = Math.floor(remaining / 26);
  }
  return text;
}

const ROMAN_NUMERALS = [
  [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
  [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
];

function romanCounter(value) {
  let remaining = value;
  let text = "";
  for (const [amount, numeral] of ROMAN_NUMERALS) {
    while (remaining >= amount) {
      text += numeral;
      remaining -= amount;
    }
  }
  return text;
}

function listCounterText(format, number) {
  switch (format) {
    case "lower-alpha":
      return alphabeticCounter(number);
    case "upper-alpha":
      return alphabeticCounter(number).toUpperCase();
    case "lower-roman":
      return romanCounter(number);
    case "upper-roman":
      return romanCounter(number).toUpperCase();
    default:
      return String(number);
  }
}

// The marker drawn before an item: a bullet, or its counter and a period.
export function listMarkerText(format, number) {
  return BULLET_MARKERS[format] ?? `${listCounterText(format, number)}.`;
}

// Leading tabs give the level. Tags may sit among them when formatting covers
// a whole line; they stay, the tabs go. `prefixLength` is where the item's text
// starts in the line.
function splitLeadingTabs(line, skipTags) {
  let tabs = 0;
  let kept = "";
  let cursor = 0;
  while (cursor < line.length) {
    if (line[cursor] === "\t") {
      tabs += 1;
      cursor += 1;
    } else if (skipTags && line[cursor] === "<") {
      const end = line.indexOf(">", cursor);
      if (end < 0) {
        break;
      }
      kept += line.slice(cursor, end + 1);
      cursor = end + 1;
    } else {
      break;
    }
  }
  return { tabs, content: kept + line.slice(cursor), prefixLength: cursor };
}

function visibleTextOfHtml(html) {
  return html.replace(/<[^>]*>/g, "");
}

// Levels step down freely but up by one at most, from 0; each item counts in
// its level and restarts the levels below it.
function normalizeListItems(rawItems) {
  const counters = [];
  let previousLevel = -1;
  return rawItems.map(({ tabs, content }) => {
    const level = Math.min(tabs, previousLevel + 1, LIST_MAX_LEVEL);
    counters.length = level + 1;
    counters[level] = (counters[level] ?? 0) + 1;
    previousLevel = level;
    return { level, number: counters[level], html: content };
  });
}

function listItems(lines, skipTags, visibleText) {
  return normalizeListItems(
    lines
      .map((line) => splitLeadingTabs(line, skipTags))
      .filter(({ content }) => /\S/.test(visibleText(content)))
      .map(({ tabs, content }) => ({ tabs, content: content.trim() })),
  );
}

// Items of sanitized editor HTML (highlights, footnote refs and all). Inline
// tags that span a line are closed and reopened in each item.
export function listItemsFromHtml(html) {
  return listItems(splitHtmlParagraphs(String(html ?? "")), true, visibleTextOfHtml);
}

// Items of stored row markup; each item's markup is in `markup`.
export function listItemsFromMarkup(text) {
  return listItems(splitInlineMarkupTextIntoLines(String(text ?? "")), true, extractInlineMarkupVisibleText)
    .map(({ html, ...item }) => ({ ...item, markup: html }));
}

// Items of plain visible text; each item's text is in `text`.
export function listItemsFromPlainText(text) {
  return listItems(String(text ?? "").replace(/\r\n?/g, "\n").split("\n"), false, (value) => value)
    .map(({ html, ...item }) => ({ ...item, text: html }));
}

// Each item with its marker, for outputs that write markers as text.
export function listItemsWithMarkers(items, textStyle) {
  return items.map((item) => ({
    ...item,
    marker: listMarkerText(listLevelFormat(textStyle, item.level), item.number),
  }));
}

// Nested <ul>/<ol>. `renderList(format, itemsHtml, level)` and
// `renderItem(itemHtml, childListHtml)` let callers add their own wrapping.
export function renderNestedListHtml(items, textStyle, options = {}) {
  const renderList = options.renderList ?? ((format, itemsHtml) => {
    const tagName = listFormatIsOrdered(format) ? "ol" : "ul";
    return `<${tagName} style="list-style-type:${format}">${itemsHtml}</${tagName}>`;
  });
  const renderItem = options.renderItem ?? ((itemHtml, childListHtml) => `<li>${itemHtml}${childListHtml}</li>`);
  let index = 0;
  const renderLevel = (level) => {
    let itemsHtml = "";
    while (index < items.length && items[index].level === level) {
      const item = items[index];
      index += 1;
      const childListHtml = index < items.length && items[index].level > level
        ? renderLevel(level + 1)
        : "";
      itemsHtml += renderItem(item.html, childListHtml);
    }
    return renderList(listLevelFormat(textStyle, level), itemsHtml, level);
  };
  return items.length > 0 ? renderLevel(0) : "";
}

// The closed editor field: each item a block, its marker hanging in a gutter.
export function renderEditorListFieldHtml(html, textStyle) {
  return listItemsWithMarkers(listItemsFromHtml(html), textStyle)
    .map((item) => (
      `<span class="translation-language-panel__list-item" style="--list-level:${item.level}">`
      + `<span class="translation-language-panel__list-marker" aria-hidden="true">${escapeHtml(item.marker)}</span>`
      + `${item.html}</span>`
    ))
    .join("");
}

// Markers for the open field: the textarea's own text, transparent, with each
// item's marker anchored where its text starts, so it wraps exactly like the
// textarea under it. The empty line holding the caret is the item being
// started, so it shows its marker too.
export function renderEditorListMarkerOverlayHtml(text, textStyle, caretLine = -1) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const parsed = lines.map((line) => splitLeadingTabs(line, true));
  const itemLines = parsed
    .map((entry, index) => ({ ...entry, index }))
    .filter(({ content, index }) => index === caretLine || /\S/.test(visibleTextOfHtml(content)));
  const items = listItemsWithMarkers(normalizeListItems(itemLines), textStyle);
  const markers = new Map(itemLines.map((line, position) => [line.index, items[position].marker]));
  return lines.map((line, index) => {
    if (!markers.has(index)) {
      return escapeHtml(line);
    }
    const { prefixLength } = parsed[index];
    return `${escapeHtml(line.slice(0, prefixLength))}`
      + `<span class="translation-language-panel__list-marker-anchor">`
      + `<span class="translation-language-panel__list-marker">${escapeHtml(markers.get(index))}</span></span>`
      + escapeHtml(line.slice(prefixLength));
  }).join("\n");
}
