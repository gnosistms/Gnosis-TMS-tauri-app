// Occurrences inside sampled passages: which proposed entry each belongs to,
// the sentence around it, and the marked passage text shown to the model.

import { isNonSpaceDelimitedLanguage } from "./language-word-boundaries.js";

const WORD_RE = /[\p{L}\p{N}_]+/gu;
const SENTENCE_END_RE = /[.!?…。！？]+["'»”)\]]*(?=\s|$)|[。！？]/gu;

/** Lower-case, accent-free text with the same length for precomposed input. */
export function fold(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
}

function foldKeepingOffsets(text) {
  const folded = [...String(text)].map((character) => {
    const single = fold(character);
    return single.length === character.length ? single : character.toLowerCase();
  }).join("");
  return folded.length === text.length ? folded : String(text).toLowerCase();
}

function strip(text, start, end) {
  let s = start;
  let e = end;
  while (s < e && /\s/u.test(text[s])) s += 1;
  while (e > s && /\s/u.test(text[e - 1])) e -= 1;
  return [s, e];
}

/** [start, end) of the sentence containing text[start:end]. */
export function sentenceBounds(text, start, end) {
  let sentenceStart = 0;
  SENTENCE_END_RE.lastIndex = 0;
  for (const match of String(text).matchAll(SENTENCE_END_RE)) {
    const matchEnd = match.index + match[0].length;
    if (matchEnd <= start) {
      sentenceStart = matchEnd;
    } else if (match.index >= end) {
      return strip(text, sentenceStart, matchEnd);
    }
  }
  return strip(text, sentenceStart, text.length);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pattern for one surface form. Space-delimited languages match whole words;
 * languages written without spaces (Chinese, Japanese, Thai…) match the form
 * anywhere in the text, like the editor's glossary matcher.
 */
function surfacePattern(surface, languageCode = "") {
  const noSpaces = isNonSpaceDelimitedLanguage(languageCode);
  const words = fold(surface).match(WORD_RE) ?? [];
  if (!words.length) {
    return null;
  }
  const body = words.map(escapeRegExp).join(noSpaces ? "[^\\p{L}\\p{N}_]*" : "[^\\p{L}\\p{N}_]+");
  return noSpaces
    ? new RegExp(body, "gu")
    : new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, "gu");
}

/** [{start, end, entryId}] for every expression-entry match in the text. */
export function expressionSpans(text, entries, languageCode = "") {
  const folded = foldKeepingOffsets(text);
  const spans = [];
  for (const entry of entries) {
    if (entry.kind !== "expression") continue;
    for (const surface of entry.match?.length ? entry.match : entry.sourceTerms) {
      const pattern = surfacePattern(surface, languageCode);
      if (!pattern) continue;
      for (const match of folded.matchAll(pattern)) {
        spans.push({ start: match.index, end: match.index + match[0].length, entryId: entry.id });
      }
    }
  }
  return spans;
}

/** The word entry whose source terms contain this surface form, if any. */
function wordEntryFor(surface, entries) {
  const key = fold(surface).trim();
  return entries.find(
    (entry) => entry.kind !== "expression"
      && entry.sourceTerms.some((term) => fold(term).trim() === key),
  ) ?? null;
}

/**
 * One record per matched occurrence in each sampled passage. An occurrence
 * inside an expression goes to the (longest) expression entry, like the TMS
 * longest-match glossary matcher; otherwise to the word entry that lists its
 * surface form; otherwise it is "unassigned" and reported, never guessed.
 */
export function buildOccurrences(items, entries, idPrefix = "o", languageCode = "") {
  const occurrences = [];
  items.forEach((item, itemIndex) => {
    const text = item.text;
    const spans = expressionSpans(text, entries, languageCode);
    item.occurrences.forEach((occurrence, occurrenceIndex) => {
      let entryId = wordEntryFor(occurrence.surface, entries)?.id ?? "unassigned";
      let markStart = occurrence.start;
      let markEnd = occurrence.end;
      const covering = spans.filter(
        (span) => span.start <= occurrence.start && occurrence.end <= span.end,
      );
      if (covering.length) {
        const longest = covering.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
        entryId = longest.entryId;
        markStart = longest.start;
        markEnd = longest.end;
      }
      const [sentenceStart, sentenceEnd] = sentenceBounds(text, markStart, markEnd);
      occurrences.push({
        occId: `${idPrefix}${String(itemIndex + 1).padStart(3, "0")}.${occurrenceIndex + 1}`,
        itemId: item.itemId,
        entryId,
        start: occurrence.start,
        end: occurrence.end,
        surface: occurrence.surface,
        markStart,
        markEnd,
        marked: text.slice(markStart, markEnd),
        sentenceStart,
        sentenceEnd,
      });
    });
  });
  return occurrences;
}

function clipHead(text, length) {
  if (text.length <= length) return text;
  const cut = text.lastIndexOf(" ", length);
  return `${text.slice(0, cut > 0 ? cut : length)}…`;
}

function clipTail(text, length) {
  if (text.length <= length) return text;
  const cut = text.indexOf(" ", text.length - length);
  return `…${text.slice(cut + 1)}`;
}

/** Passage text around the given occurrences with ⟦…⟧ [id] markers. */
export function markedPassage(item, occurrences, { window = 900, neighbourChars = 280 } = {}) {
  const text = item.text;
  let a = Math.min(...occurrences.map((o) => o.sentenceStart));
  let b = Math.max(...occurrences.map((o) => o.sentenceEnd));
  if (b - a < window) {
    const pad = Math.floor((window - (b - a)) / 2);
    let wideStart = Math.max(0, a - pad);
    let wideEnd = Math.min(text.length, b + pad);
    if (wideStart > 0) {
      const space = text.indexOf(" ", wideStart);
      wideStart = space >= 0 && space < a ? space + 1 : a;
    }
    if (wideEnd < text.length) {
      const space = text.lastIndexOf(" ", wideEnd);
      wideEnd = space > b ? space : b;
    }
    a = Math.min(a, wideStart);
    b = Math.max(b, wideEnd);
  }
  const marks = [...occurrences].sort((x, y) => x.markStart - y.markStart);
  let body = "";
  let position = a;
  for (const occurrence of marks) {
    body += text.slice(position, occurrence.markStart);
    body += `⟦${text.slice(occurrence.markStart, occurrence.markEnd)}⟧ [${occurrence.occId}]`;
    position = occurrence.markEnd;
  }
  body += text.slice(position, b);
  body = `${a > 0 ? "…" : ""}${body}${b < text.length ? "…" : ""}`;
  const parts = [];
  if (item.contextBefore?.length) {
    parts.push(`(previous passage) ${clipTail(item.contextBefore.at(-1), neighbourChars)}`);
  }
  parts.push(body);
  if (item.contextAfter?.length) {
    parts.push(`(next passage) ${clipHead(item.contextAfter[0], neighbourChars)}`);
  }
  if (item.existingTranslation) {
    parts.push(`(existing translation of this passage, not authoritative) ${clipHead(item.existingTranslation, 600)}`);
  }
  return parts.join("\n");
}

/** Short snippet with the occurrence in ⟦ ⟧, for the proposal packet. */
export function snippet(text, start, end, radius = 110) {
  const a = Math.max(0, start - radius);
  const b = Math.min(text.length, end + radius);
  return `${a > 0 ? "…" : ""}${text.slice(a, start)}⟦${text.slice(start, end)}⟧${text.slice(end, b)}${b < text.length ? "…" : ""}`;
}
