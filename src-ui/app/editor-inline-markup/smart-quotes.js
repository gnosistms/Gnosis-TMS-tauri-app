// Converts straight quotation marks (" and ') in inline-markup text into
// typographic ("curly") quotes, following the rules SmartyPants and its refined
// descendant (docutils `smartquotes.py`) use — the same rules Vellum applies.
//
// The decision for each quote is made from the character immediately before it and,
// as a tiebreaker, the character immediately after — it never matches pairs or tracks
// nesting depth. Both neighbours are read from the *visible* text with tags treated as
// transparent (so `<b>He</b>'s` sees the "e", and a quote can open before a link and
// close after it), while tag delimiters and the href inside <a …> are never rewritten.
// Paragraph separators (<hr>) act as boundaries, so a quote right after one opens.
//
//   Double quote " :
//     - opening “ when preceded by a boundary (start / whitespace / ( [ { / dash /
//       an open curly quote / ¿ ¡) AND followed by a non-space character;
//     - closing ” when preceded by any other non-space character, or when followed by
//       whitespace / end (the tiebreaker that resolves otherwise-ambiguous cases);
//     - opening “ otherwise.
//
//   Single quote ' :
//     - apostrophe/closing ’ after a letter or digit (it's, John's, dogs');
//     - opening ‘ after a boundary when followed by a word/punctuation character;
//     - closing ’ otherwise.
//
// English-only refinements (applied only when the field's language is English, so they
// never misfire on the Vietnamese or Spanish content this app also handles — e.g. a
// Vietnamese quotation starting with the word "em"):
//     - decade abbreviations:  the '80s  ->  the ’80s
//     - leading-apostrophe elisions:  'twas 'tis 'til 'em 'cause 'round 'bout 'n'
//       ->  ’twas ’tis …   (Vellum ships a curated list of these; this mirrors it.)
//
// Already-curly quotes are left alone, so the transform is idempotent and safe to run
// on every save.

import { parseInlineMarkup } from "./parser.js";
import { serializeNodesAsInlineMarkupSource } from "./serialize.js";

const LEFT_DOUBLE = "“";
const RIGHT_DOUBLE = "”";
const LEFT_SINGLE = "‘";
const RIGHT_SINGLE = "’"; // also the apostrophe glyph

// Characters that, when they precede a straight quote, mark a boundary at which a quote
// opens. Includes the curly opening quotes themselves (so nested quotes open) and the
// Spanish inverted marks.
const OPEN_BRACKETS = new Set(["(", "[", "{", LEFT_DOUBLE, LEFT_SINGLE, "¿", "¡"]);
const DASHES = new Set(["-", "–", "—"]);

// Leading-apostrophe elisions, matched case-insensitively against the text right after
// a single quote. `\b` keeps 'tis from firing inside a quoted "'tissue".
const ELISION = /^(?:twas|tis|til|em|cause|round|bout|nuff|n)\b/i;
const DECADE = /^\d\ds/; // '80s, '90s

function isWhitespace(char) {
  return char === null || /\s/u.test(char);
}

function isWordChar(char) {
  return char !== null && /\p{L}|\p{N}/u.test(char);
}

// A boundary before a quote: start of text, whitespace, an opening bracket, or a dash.
function isBoundaryBefore(char) {
  return char === null || isWhitespace(char) || OPEN_BRACKETS.has(char) || DASHES.has(char);
}

function decideDouble(prev, next) {
  if (isBoundaryBefore(prev) && next !== null && !isWhitespace(next)) {
    return LEFT_DOUBLE;
  }
  if (prev !== null && !isWhitespace(prev) && !OPEN_BRACKETS.has(prev) && !DASHES.has(prev)) {
    return RIGHT_DOUBLE;
  }
  if (next === null || isWhitespace(next)) {
    return RIGHT_DOUBLE;
  }
  return LEFT_DOUBLE;
}

function decideSingle(prev, next, ahead, isEnglish) {
  if (isEnglish && DECADE.test(ahead)) {
    return RIGHT_SINGLE;
  }
  if (isEnglish && isBoundaryBefore(prev) && ELISION.test(ahead)) {
    return RIGHT_SINGLE;
  }
  if (isWordChar(prev)) {
    return RIGHT_SINGLE;
  }
  if (isBoundaryBefore(prev)) {
    return next !== null && !isWhitespace(next) ? LEFT_SINGLE : RIGHT_SINGLE;
  }
  return RIGHT_SINGLE;
}

// Flattens the parsed markup into one cell per visible character, tags transparent. A
// separator becomes a boundary cell so the preceding/following-character rules see a
// paragraph break as whitespace.
function collectVisibleCells(nodes, cells) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node) {
      continue;
    }
    if (node.type === "text") {
      const text = node.text ?? "";
      for (let index = 0; index < text.length; index += 1) {
        cells.push({ node, index, char: text[index] });
      }
    } else if (node.tag === "hr") {
      cells.push({ boundary: true, char: "\n" });
    } else {
      collectVisibleCells(node.children, cells);
    }
  }
}

// Rewrites straight quotes in an inline-markup string to typographic quotes. `language`
// is a BCP-47 tag (e.g. "en", "en-US", "vi"); the English-only refinements apply only
// when it starts with "en". Returns the input unchanged when nothing needs converting.
export function smartenInlineMarkupQuotes(value, { language } = {}) {
  const source = String(value ?? "");
  if (!source.includes('"') && !source.includes("'")) {
    return source;
  }

  const parsed = parseInlineMarkup(source);
  const cells = [];
  collectVisibleCells(parsed.nodes, cells);
  const flat = cells.map((cell) => cell.char);
  const isEnglish = typeof language === "string" && language.toLowerCase().startsWith("en");

  let changed = false;
  for (let k = 0; k < cells.length; k += 1) {
    const cell = cells[k];
    if (cell.boundary || (cell.char !== '"' && cell.char !== "'")) {
      continue;
    }
    const prev = k > 0 ? flat[k - 1] : null;
    const next = k + 1 < flat.length ? flat[k + 1] : null;
    const replacement =
      cell.char === '"'
        ? decideDouble(prev, next)
        : decideSingle(prev, next, flat.slice(k + 1, k + 9).join(""), isEnglish);
    if (replacement !== cell.char) {
      cell.char = replacement;
      changed = true;
    }
  }

  if (!changed) {
    return source;
  }

  // Write the converted characters back into their source text nodes. Straight and
  // curly quotes are both single UTF-16 code units, so indices stay aligned.
  const rewritten = new Map();
  for (const cell of cells) {
    if (cell.boundary) {
      continue;
    }
    if (!rewritten.has(cell.node)) {
      rewritten.set(cell.node, (cell.node.text ?? "").split(""));
    }
    rewritten.get(cell.node)[cell.index] = cell.char;
  }
  for (const [node, chars] of rewritten) {
    node.text = chars.join("");
  }

  return serializeNodesAsInlineMarkupSource(parsed.nodes);
}
