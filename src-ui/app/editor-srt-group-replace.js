import { extractInlineMarkupVisibleText } from "./editor-inline-markup.js";
import { parseInlineMarkup } from "./editor-inline-markup/parser.js";
import { serializeNodesAsInlineMarkupSource } from "./editor-inline-markup/serialize.js";
import { findEditorSearchMatches } from "./editor-filters.js";
import { joinSrtFragmentTexts } from "./editor-srt-group-text.js";

function replaceVisibleRange(value, start, end, replacement) {
  let inserted = false;
  const walk = (nodes) => nodes.map((node) => {
    if (node.type !== "text") return { ...node, children: walk(node.children ?? []) };
    if (node.visibleEnd <= start || node.visibleStart >= end) return node;
    const from = Math.max(0, start - node.visibleStart);
    const to = Math.min(node.text.length, end - node.visibleStart);
    const next = { ...node, text: node.text.slice(0, from) + (inserted ? "" : replacement) + node.text.slice(to) };
    inserted = true;
    return next;
  });
  return serializeNodesAsInlineMarkupSource(walk(parseInlineMarkup(value).nodes));
}

export function replaceSrtFragmentTexts(parts, code, query, replacement, caseSensitive) {
  const visible = parts.map((part) => extractInlineMarkupVisibleText(part));
  const spans = [];
  let joined = "";
  for (const [index, text] of visible.entries()) {
    joined = joinSrtFragmentTexts([joined, text], code);
    spans.push({ index, start: joined.length - text.length, end: joined.length });
  }
  const result = [...parts];
  for (const match of findEditorSearchMatches(joined, query, code, { caseSensitive }).reverse()) {
    const touched = spans.filter((span) => match.start < span.end && match.end > span.start);
    for (const [position, span] of touched.entries()) {
      result[span.index] = replaceVisibleRange(result[span.index], Math.max(0, match.start - span.start),
        Math.min(visible[span.index].length, match.end - span.start), position === 0 ? replacement : "");
    }
  }
  return result;
}
