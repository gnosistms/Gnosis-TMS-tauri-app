// Display markers never enter stored cue text. The session owns their identity;
// missing markers move text to the earliest cue, never erase a cue or its timing.
import { parseInlineMarkup, collectTextSegments } from "./editor-inline-markup/parser.js";
import { mapInlineMarkupVisiblePositionToRawInsertionOffset } from "./editor-inline-markup/ranges.js";

function balanceFragmentMarkup(parts, markers) {
  const text = composeSrtGroupText(parts, markers);
  const ranges = [];
  let start = 0;
  for (const [index, part] of parts.entries()) {
    ranges.push({ start, end: start + part.length });
    start += part.length + (markers[index]?.length ?? 0);
  }
  const nodes = parseInlineMarkup(text).nodes;
  const spansBoundary = (items) => items.some((node) => node.type === "element"
    && (ranges.some((range) => node.openEnd <= range.end && node.closeStart > range.end)
      || spansBoundary(node.children ?? [])));
  if (!spansBoundary(nodes)) return parts;
  // Clone a spanning tag around each cue's own text. Retain the original tag
  // spellings/attributes and all text; ordinary untouched cues stay byte exact.
  const slice = (items, range) => items.map((node) => {
    if (node.rawEnd <= range.start || node.rawStart >= range.end) return "";
    if (node.type === "text") return text.slice(Math.max(node.rawStart, range.start), Math.min(node.rawEnd, range.end));
    if (node.rawStart >= range.start && node.rawEnd <= range.end) return text.slice(node.rawStart, node.rawEnd);
    const children = slice(node.children ?? [], range);
    return children ? text.slice(node.openStart, node.openEnd) + children + text.slice(node.closeStart, node.closeEnd) : "";
  }).join("");
  return ranges.map((range) => slice(nodes, range));
}
export function createSrtGroupText(texts) {
  const parts = texts.map((text) => String(text ?? ""));
  let prefix = "";
  while (parts.some((text) => text.includes(`⟦${prefix}`))) prefix += "#";
  const markers = parts.slice(1).map((_, index) => `⟦${prefix}${index + 1}⟧`);
  return { markers, text: composeSrtGroupText(parts, markers) };
}

export function composeSrtGroupText(parts, markers) {
  return parts.map((part, index) => `${index ? markers[index - 1] : ""}${part}`).join("");
}

export function srtGroupEditHasChanges(edit) {
  return edit.draft !== edit.savedDraft || edit.forceSave === true;
}

// A clean session is a cache of canonical text, not an authoritative draft.
// Dirty sessions retain their original text and concurrency base across sync.
export function srtGroupEditMatchesMembers(edit, members) {
  return edit.memberRowIds.length === members.length
    && members.every((row, index) => row?.rowId === edit.memberRowIds[index])
    && (srtGroupEditHasChanges(edit)
      || composeSrtGroupText(members.map((row) => row.fields?.[edit.languageCode] ?? ""), edit.markers) === edit.savedDraft);
}

export function normalizeSrtGroupText(value, markers) {
  const text = String(value ?? "");
  const found = [];
  for (const [index, marker] of markers.entries()) {
    const position = text.indexOf(marker);
    if (position < 0) continue;
    if (text.indexOf(marker, position + marker.length) >= 0) {
      return { error: `Separation marker ${index + 1} appears more than once. Remove the duplicate before saving.` };
    }
    found.push({ index, position, marker });
  }
  found.sort((a, b) => a.position - b.position);
  if (found.some((item, index) => index > 0 && item.index < found[index - 1].index)) {
    return { error: "Separation markers are out of order. Put them in numerical order before saving." };
  }
  const parts = Array(markers.length + 1).fill("");
  let start = 0;
  let fragment = 0;
  for (const item of found) {
    parts[fragment] = text.slice(start, item.position);
    fragment = item.index + 1;
    start = item.position + item.marker.length;
  }
  parts[fragment] = text.slice(start);
  const balanced = balanceFragmentMarkup(parts, markers);
  return { parts: balanced, text: composeSrtGroupText(balanced, markers), error: "" };
}

export function locateSrtGroupPosition(value, markers, offset) {
  const normalized = normalizeSrtGroupText(value, markers);
  if (normalized.error) return null;
  let start = 0;
  let fragment = 0;
  const locate = (end) => {
    const visibleOffset = collectTextSegments(parseInlineMarkup(value).nodes).reduce((length, segment) => length
      + Math.max(0, Math.min(segment.rawEnd, end) - Math.max(segment.rawStart, start)), 0);
    return { fragment, offset: mapInlineMarkupVisiblePositionToRawInsertionOffset(normalized.parts[fragment], visibleOffset) };
  };
  const boundaries = markers.map((marker, index) => ({ marker, index, position: value.indexOf(marker) }))
    .filter((item) => item.position >= 0).sort((a, b) => a.position - b.position);
  for (const boundary of boundaries) {
    if (offset <= boundary.position) return locate(offset);
    if (offset < boundary.position + boundary.marker.length) return null;
    start = boundary.position + boundary.marker.length;
    fragment = boundary.index + 1;
  }
  return locate(Math.min(value.length, offset));
}

export function joinSrtFragmentTexts(texts, languageCode = "") {
  const separator = /^(?:zh|ja|th|lo|km|my)(?:-|$)/i.test(languageCode) ? "" : " ";
  return texts.reduce((joined, value) => {
    const text = String(value ?? "");
    if (!joined || !text) return joined + text;
    return joined + (/[\s]$/u.test(joined) || /^\s/u.test(text) ? "" : separator) + text;
  }, "");
}

// Highlight offsets refer to marker-free visible text, while the combined
// textarea/display includes numbered markers. Preserve that distinction.
export function mapSrtGroupOffset(offset, visibleParts, markers, code) {
  let joined = "";
  let displayStart = 0;
  for (const [index, part] of visibleParts.entries()) {
    const nextJoined = joinSrtFragmentTexts([joined, part], code);
    const joinedStart = nextJoined.length - part.length;
    if (offset <= nextJoined.length) return displayStart + Math.max(0, offset - joinedStart);
    joined = nextJoined;
    displayStart += part.length + (markers[index]?.length ?? 0);
  }
  return displayStart;
}
