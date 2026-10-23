import { describeInlineMarkupSelection, toggleInlineMarkupSelection } from "./editor-inline-markup.js";

// Format each fragment independently so stored markup cannot span a cue edge.
// Missing/duplicated markers remain untouched until save-time validation.
export function toggleSrtGroupInlineStyle(options, markers) {
  const boundaries = markers.flatMap((marker) => {
    const found = [];
    let position = options.value.indexOf(marker);
    while (position >= 0) {
      found.push({ position, marker });
      position = options.value.indexOf(marker, position + marker.length);
    }
    return found;
  }).sort((a, b) => a.position - b.position);
  const segments = [];
  let start = 0;
  for (const boundary of boundaries) {
    segments.push({ start, end: boundary.position, marker: boundary.marker });
    start = boundary.position + boundary.marker.length;
  }
  segments.push({ start, end: options.value.length, marker: "" });
  const selected = segments.filter((segment) => options.selectionStart === options.selectionEnd
    ? options.selectionStart >= segment.start && options.selectionStart <= segment.end
    : options.selectionStart < segment.end && options.selectionEnd > segment.start);
  if (options.style === "ruby" && selected.length > 1) return { changed: false, error: "Select text within one subtitle fragment to add ruby text." };
  const active = (segment) => describeInlineMarkupSelection(options.value.slice(segment.start, segment.end),
    Math.max(0, options.selectionStart - segment.start), Math.min(segment.end - segment.start, options.selectionEnd - segment.start)).activeStyles?.[options.style] === true;
  const enable = !selected.every(active);
  let value = "";
  let selectionStart = null;
  let selectionEnd = null;
  let changed = false;
  for (const segment of segments) {
    let text = options.value.slice(segment.start, segment.end);
    if (selected.includes(segment)) {
      const localStart = Math.max(0, options.selectionStart - segment.start);
      const localEnd = Math.min(text.length, options.selectionEnd - segment.start);
      const result = active(segment) === enable ? { value: text, selectionStart: localStart, selectionEnd: localEnd }
        : toggleInlineMarkupSelection({ ...options, value: text, selectionStart: localStart, selectionEnd: localEnd });
      selectionStart ??= value.length + result.selectionStart;
      selectionEnd = value.length + result.selectionEnd;
      text = result.value;
      changed ||= result.changed === true;
    }
    value += text + segment.marker;
  }
  return { value, changed, selectionStart: selectionStart ?? options.selectionStart,
    selectionEnd: selectionEnd ?? options.selectionEnd, selectionDirection: options.selectionDirection };
}
