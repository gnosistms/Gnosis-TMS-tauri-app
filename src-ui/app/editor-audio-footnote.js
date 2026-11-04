// Where an export cannot play audio, a row's audio becomes a footnote on the
// row's text that reads "caption: address". Mirrors audio_footnote_text and
// strip_caption_end_punctuation in chapter_export.rs; both sides check
// tests/fixtures/audio-footnote/caption-cases.json.

import { editorFieldImageDisplayName } from "./editor-images.js";
import { extractInlineMarkupVisibleText } from "./editor-inline-markup.js";

// Audio is refused on a row with no text in that language: the footnote that
// carries it in print exports needs text to attach to.
export function audioNeedsRowTextMessage(languageName = "") {
  const name = String(languageName ?? "").trim();
  return `Write this row's ${name ? `${name} ` : ""}text before adding audio. Print exports put the audio link in a footnote on that text.`;
}

export function editorRowHasTextForAudio(row, languageCode) {
  return extractInlineMarkupVisibleText(String(row?.fields?.[languageCode] ?? "")).trim().length > 0;
}

// Punctuation that would sit badly before the ": ". Closing quotes and
// brackets are not in it, so a quoted title stays balanced.
const CAPTION_END_PUNCTUATION = new Set([
  ".", ",", ";", ":", "!", "?", "…", "。", "．", "，", "、", "；", "：", "！", "？", "،", "؛",
  "؟", "।", "॥",
]);

function escapeAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&#39;");
}

// The caption without its ending punctuation (and the whitespace around it),
// looking past inline tags, so "Evening <em>talk.</em>" becomes
// "Evening <em>talk</em>". An entity such as "&amp;" counts as text.
export function stripCaptionEndPunctuation(caption) {
  const text = String(caption ?? "");
  let end = text.length;
  const removed = [];
  while (end > 0) {
    const head = text.slice(0, end);
    const last = Array.from(head).at(-1);
    if (last === ">") {
      const tagStart = head.lastIndexOf("<");
      if (tagStart < 0) {
        break;
      }
      end = tagStart;
      continue;
    }
    if (last === ";") {
      const amp = head.lastIndexOf("&", head.length - 2);
      const name = amp >= 0 ? head.slice(amp + 1, -1) : "";
      if (/^[#A-Za-z0-9]+$/.test(name)) {
        break;
      }
    }
    if (!/\s/u.test(last) && !CAPTION_END_PUNCTUATION.has(last)) {
      break;
    }
    end -= last.length;
    removed.push([end, end + last.length]);
  }
  let stripped = text;
  // `removed` runs from the end backwards, so earlier offsets stay valid.
  for (const [start, stop] of removed) {
    stripped = stripped.slice(0, start) + stripped.slice(stop);
  }
  return stripped.trim();
}

function captionHasVisibleText(caption) {
  return caption.replace(/<[^>]*>/g, "").trim().length > 0;
}

// "Caption: address", or the address alone without a caption. The address is
// a link when the format has links. Uploaded audio has no public address, so
// its file name stands in.
export function audioFootnoteText(image, caption, { links = true } = {}) {
  let target;
  if (image?.kind === "url") {
    const url = String(image.url ?? "");
    const visible = url.replace(/[<>]/g, "");
    target = links ? `<a href="${escapeAttribute(url)}">${visible}</a>` : visible;
  } else {
    target = editorFieldImageDisplayName(image).replace(/[<>]/g, "");
  }
  const stripped = stripCaptionEndPunctuation(caption);
  return captionHasVisibleText(stripped) ? `${stripped}: ${target}` : target;
}
