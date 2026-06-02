export function normalizeEditorFootnotes(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => ({
        marker: normalizeFootnoteMarker(entry?.marker, index + 1),
        text: typeof entry?.text === "string" ? entry.text : String(entry?.text ?? ""),
      }))
      .filter((entry) => Number.isInteger(entry.marker) && entry.marker > 0);
  }

  const text = typeof value === "string" ? value : String(value ?? "");
  if (!text.trim()) {
    return [];
  }

  const parsed = parseLabeledFootnoteText(text);
  return parsed.length > 0 ? parsed : [{ marker: 1, text }];
}

export function cloneRowFootnotes(footnotes) {
  return Object.fromEntries(
    Object.entries(footnotes && typeof footnotes === "object" ? footnotes : {}).map(([code, value]) => [
      code,
      normalizeEditorFootnotes(value),
    ]),
  );
}

export function serializeEditorFootnotesForLegacy(footnotes) {
  const normalized = normalizeEditorFootnotes(footnotes);
  if (normalized.length === 0) {
    return "";
  }
  if (normalized.length === 1) {
    return normalized[0].marker === 1 ? normalized[0].text : serializeLabeledFootnoteEntry(normalized[0]);
  }
  return normalized
    .map(serializeLabeledFootnoteEntry)
    .join("\n\n");
}

export function editorFootnotesPlainText(footnotes) {
  return normalizeEditorFootnotes(footnotes)
    .map((entry) => entry.text)
    .join("\n\n");
}

export function editorFootnotesHaveText(footnotes) {
  return normalizeEditorFootnotes(footnotes)
    .some((entry) => entry.text.trim().length > 0);
}

export function rowFootnoteMarkerText(marker) {
  return `[${normalizeFootnoteMarker(marker, 1)}]`;
}

export function unescapeLiteralFootnoteMarkers(text) {
  return String(text ?? "")
    .replaceAll(/\\\[(\d+)\\\]/g, "[$1]")
    .replaceAll(/\\\[(\d+)\]/g, "[$1]");
}

export function parseUnescapedFootnoteMarkers(text) {
  const markers = [];
  const source = String(text ?? "");
  const markerPattern = /\[(\d+)\]/g;
  let match = markerPattern.exec(source);
  while (match) {
    const slashCount = countPrecedingSlashes(source, match.index);
    if (slashCount % 2 === 0) {
      markers.push({
        marker: Number.parseInt(match[1], 10),
        index: match.index,
        endIndex: markerPattern.lastIndex,
        raw: match[0],
      });
    }
    match = markerPattern.exec(source);
  }
  return markers;
}

export function nextEditorFootnoteMarker(text, footnotes) {
  const used = new Set([
    ...normalizeEditorFootnotes(footnotes).map((entry) => entry.marker),
    ...parseUnescapedFootnoteMarkers(text).map((entry) => entry.marker),
  ]);
  let marker = 1;
  while (used.has(marker)) {
    marker += 1;
  }
  return marker;
}

export function applyEditorFootnoteText(footnotes, marker, text) {
  const normalizedMarker = normalizeFootnoteMarker(marker, 1);
  const entries = normalizeEditorFootnotes(footnotes);
  const index = entries.findIndex((entry) => entry.marker === normalizedMarker);
  const nextEntry = { marker: normalizedMarker, text: typeof text === "string" ? text : String(text ?? "") };
  if (index < 0) {
    return [...entries, nextEntry].sort((left, right) => left.marker - right.marker);
  }
  return entries.map((entry, entryIndex) => (entryIndex === index ? nextEntry : entry));
}

export function ensureEditorFootnoteEntry(footnotes, marker) {
  const normalizedMarker = normalizeFootnoteMarker(marker, 1);
  const entries = normalizeEditorFootnotes(footnotes);
  if (entries.some((entry) => entry.marker === normalizedMarker)) {
    return entries;
  }
  return [...entries, { marker: normalizedMarker, text: "" }].sort((left, right) => left.marker - right.marker);
}

export function normalizeEditorRowFootnotesForSave(text, footnotes) {
  const nextText = String(text ?? "");
  const markersInText = new Set(parseUnescapedFootnoteMarkers(nextText).map((entry) => entry.marker));
  const entries = normalizeEditorFootnotes(footnotes)
    .filter((entry) => entry.text.trim() || markersInText.has(entry.marker))
    .sort((left, right) => left.marker - right.marker);

  return {
    text: nextText,
    footnotes: entries,
  };
}

function normalizeFootnoteMarker(value, fallback) {
  const marker = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(marker) && marker > 0 ? marker : fallback;
}

function serializeLabeledFootnoteEntry(entry) {
  const label = `[${entry.marker}]`;
  return entry.text ? `${label} ${entry.text}` : label;
}

function parseLabeledFootnoteText(text) {
  const source = String(text ?? "");
  const matches = [];
  const markerPattern = /\[(\d+)\]\s*/g;
  let candidate = markerPattern.exec(source);
  while (candidate) {
    const markerStart = candidate.index ?? 0;
    const markerEnd = markerPattern.lastIndex;
    const previousMatch = matches.at(-1);
    const startsAtSourceStart = source.slice(0, markerStart).trim().length === 0;
    const startsLine = isFootnoteMarkerAtLineStart(source, markerStart);
    const followsBlankPreviousEntry = previousMatch
      ? source.slice(previousMatch.contentStart, markerStart).trim().length === 0
      : false;

    if (startsAtSourceStart || startsLine || followsBlankPreviousEntry) {
      matches.push({
        marker: candidate[1],
        markerStart,
        contentStart: markerEnd,
      });
    }
    candidate = markerPattern.exec(source);
  }

  if (matches.length === 0 || source.slice(0, matches[0].markerStart).trim().length > 0) {
    return [];
  }

  return matches.map((match, index) => {
    const start = match.contentStart;
    const end = index + 1 < matches.length ? matches[index + 1].markerStart : source.length;
    return {
      marker: normalizeFootnoteMarker(match.marker, index + 1),
      text: source.slice(start, end).trim(),
    };
  });
}

function isFootnoteMarkerAtLineStart(source, markerStart) {
  const lineStart = source.lastIndexOf("\n", markerStart - 1) + 1;
  return source.slice(lineStart, markerStart).trim().length === 0;
}

function countPrecedingSlashes(text, index) {
  let count = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) {
    count += 1;
  }
  return count;
}
