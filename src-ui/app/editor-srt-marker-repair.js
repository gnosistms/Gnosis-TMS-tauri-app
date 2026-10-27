import { normalizeSrtGroupText } from "./editor-srt-group-text.js";

// Literal bracket text already present in a cue is not a UI separator. The
// session's generated prefix keeps its real separators distinct from literals.
function literalRanges(text, originalTexts, markers) {
  const actualMarkers = markers.flatMap((marker) => {
    const ranges = [];
    for (let index = text.indexOf(marker); index >= 0; index = text.indexOf(marker, index + marker.length)) {
      ranges.push([index, index + marker.length]);
    }
    return ranges;
  });
  const literals = new Set(originalTexts.flatMap((value) => String(value ?? "").match(/⟦[^⟦⟧]*⟧|⟦[^⟦⟧\s]*|[^⟦⟧\s]*⟧/gu) ?? []));
  const ranges = [];
  for (const literal of literals) {
    for (let start = text.indexOf(literal); start >= 0; start = text.indexOf(literal, start + literal.length)) {
      const end = start + literal.length;
      if (!actualMarkers.some(([left, right]) => start < right && end > left)) ranges.push([start, end]);
    }
  }
  return ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
}

export function repairSrtGroupMarkers(value, markers, originalTexts = []) {
  const raw = String(value ?? "");
  const prefix = /^⟦(#+)/u.exec(markers[0] ?? "")?.[1] ?? "";
  const number = new RegExp(`^([ \t]*)${prefix ? `(?:${prefix})?` : ""}([0-9０-９]+)`, "u");
  const protectedRanges = literalRanges(raw, originalTexts, markers);
  const found = [];
  let text = "";
  let rangeIndex = 0;
  for (let index = 0; index < raw.length;) {
    while (protectedRanges[rangeIndex]?.[1] <= index) rangeIndex += 1;
    const protectedRange = protectedRanges[rangeIndex];
    if (protectedRange && protectedRange[0] <= index) {
      text += raw.slice(index, protectedRange[1]);
      index = protectedRange[1];
      continue;
    }
    const opening = raw[index] === "⟦";
    const match = number.exec(raw.slice(index + (opening ? 1 : 0)));
    if (match && (opening || match[1] === "")) {
      const digitsEnd = index + (opening ? 1 : 0) + match[0].length;
      const close = /^[ \t]*⟧/u.exec(raw.slice(digitsEnd));
      if (opening || close) {
        const digits = match[2].normalize("NFKC").replace(/^0+(?=[0-9])/u, "");
        const token = `⟦${prefix}${digits}⟧`;
        text += token;
        found.push(token);
        index = digitsEnd + (close?.[0].length ?? 0);
        continue;
      }
      text += match[0];
      index = digitsEnd;
      continue;
    }
    if (raw[index] !== "⟦" && raw[index] !== "⟧") text += raw[index];
    index += 1;
  }
  let previous = -1;
  const seen = new Set();
  let error = "";
  for (const token of found) {
    const index = markers.indexOf(token);
    if (index < 0) error ||= `Unexpected separation marker ${token}.`;
    else if (seen.has(token)) error ||= `Separation marker ${index + 1} appears more than once. Remove the duplicate before saving.`;
    else if (index < previous) error ||= "Separation markers are out of order. Put them in numerical order before saving.";
    if (index >= 0) { seen.add(token); previous = index; }
  }
  if (error) {
    if (seen.size === 0 && markers.length) text += markers[0];
    return { text, error, corrected: text !== raw };
  }
  const normalized = normalizeSrtGroupText(text, markers);
  return { ...normalized, corrected: text !== raw || seen.size !== markers.length };
}
