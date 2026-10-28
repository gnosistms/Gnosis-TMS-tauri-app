import {
  diff_match_patch,
  DIFF_DELETE,
  DIFF_INSERT,
} from "../../lib/vendor/diff-match-patch.js";
import {
  elementNode,
  flattenNodesToVisibleText,
  parseInlineMarkup,
  textNode,
} from "./parser.js";
import { serializeNodesAsInlineMarkupSource } from "./serialize.js";

// Diff of two inline-markup values that keeps their formatting. The result is one
// merged markup value — kept and inserted text with its current formatting, deleted
// text with its old formatting — plus visible-text ranges marking each changed run, so
// the normal highlight renderer can draw it (bold/italic/underline/ruby/links intact).
//
// Units: every code point of text is one unit carrying its formatting; a ruby element
// or a separator is one atomic unit. Units are grouped into word tokens and diffed by
// text alone, so a formatting-only change is an equal token whose units' formatting
// differs.

const diffEngine = new diff_match_patch();

// Outermost first when re-nesting a run's formatting.
const FORMAT_TAG_ORDER = ["a", "strong", "em", "u"];
const FORMAT_LABELS = {
  strong: "bold",
  em: "italic",
  u: "underline",
};

function formatToken(node) {
  if (node.tag === "a") {
    return `a ${node.attributes?.href ?? ""}`;
  }
  return node.tag;
}

function tokenTag(token) {
  return token.startsWith("a ") ? "a" : token;
}

function formatKey(tokens) {
  return [...new Set(tokens)]
    .sort((left, right) => FORMAT_TAG_ORDER.indexOf(tokenTag(left)) - FORMAT_TAG_ORDER.indexOf(tokenTag(right))
      || left.localeCompare(right))
    .join("\n");
}

function collectDiffUnits(value) {
  const units = [];
  const walk = (nodes, tokens) => {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (!node) {
        continue;
      }
      if (node.type === "text") {
        const format = formatKey(tokens);
        for (const character of node.text) {
          units.push({ identity: character, text: character, format });
        }
        continue;
      }
      if (node.tag === "ruby" || node.tag === "hr") {
        const source = serializeNodesAsInlineMarkupSource([node]);
        units.push({ identity: `\u0000${source}`, atom: node, format: formatKey(tokens) });
        continue;
      }
      walk(node.children, FORMAT_TAG_ORDER.includes(node.tag) ? [...tokens, formatToken(node)] : tokens);
    }
  };
  walk(parseInlineMarkup(value).nodes, []);
  return units;
}

// Words are the diff tokens, so a changed word reads as one deleted word and one
// inserted word rather than interleaved letters. Atoms are tokens of their own.
const wordSegmenter = typeof Intl?.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "word" })
  : null;

function groupUnitsIntoTokens(units) {
  const tokens = [];
  let textRun = [];
  const flushTextRun = () => {
    if (textRun.length === 0) {
      return;
    }
    const text = textRun.map((unit) => unit.text).join("");
    const segments = wordSegmenter
      ? [...wordSegmenter.segment(text)].map((segment) => segment.segment)
      : textRun.map((unit) => unit.text);
    let unitIndex = 0;
    for (const segment of segments) {
      const segmentUnits = [];
      let length = 0;
      while (length < segment.length && unitIndex < textRun.length) {
        length += textRun[unitIndex].text.length;
        segmentUnits.push(textRun[unitIndex]);
        unitIndex += 1;
      }
      tokens.push({ identity: segment, units: segmentUnits });
    }
    textRun = [];
  };
  for (const unit of units) {
    if (unit.atom) {
      flushTextRun();
      tokens.push({ identity: unit.identity, units: [unit] });
    } else {
      textRun.push(unit);
    }
  }
  flushTextRun();
  return tokens;
}

// Encodes each distinct token identity as one BMP character so diff_match_patch sees
// every token — word, astral code point or whole atom — as a single symbol.
function encodeTokenSequences(previousTokens, currentTokens) {
  const sentinelByIdentity = new Map();
  let nextCode = 1;
  const encode = (tokens) => tokens.map((token) => {
    let sentinel = sentinelByIdentity.get(token.identity);
    if (sentinel === undefined) {
      if (nextCode === 0xd800) {
        nextCode = 0xe000;
      }
      if (nextCode > 0xffff) {
        return null;
      }
      sentinel = String.fromCharCode(nextCode);
      nextCode += 1;
      sentinelByIdentity.set(token.identity, sentinel);
    }
    return sentinel;
  });
  const previous = encode(previousTokens);
  const current = encode(currentTokens);
  if (previous.includes(null) || current.includes(null)) {
    return null;
  }
  return { previous: previous.join(""), current: current.join("") };
}

function describeFormat(format) {
  const tokens = format ? format.split("\n") : [];
  if (tokens.length === 0) {
    return "no formatting";
  }
  return tokens
    .map((token) => (token.startsWith("a ") ? `link to ${token.slice(2)}` : FORMAT_LABELS[token] ?? token))
    .join(", ");
}

function mergeUnits(previousUnits, currentUnits) {
  const previousTokens = groupUnitsIntoTokens(previousUnits);
  const currentTokens = groupUnitsIntoTokens(currentUnits);
  const encoded = encodeTokenSequences(previousTokens, currentTokens);
  if (!encoded) {
    return [
      ...previousUnits.map((unit) => ({ ...unit, change: "delete" })),
      ...currentUnits.map((unit) => ({ ...unit, change: "insert" })),
    ];
  }

  const diffs = diffEngine.diff_main(encoded.previous, encoded.current, false);
  diffEngine.diff_cleanupSemantic(diffs);

  const merged = [];
  let previousIndex = 0;
  let currentIndex = 0;
  for (const diff of diffs) {
    const operation = diff[0];
    const tokenCount = diff[1].length;
    for (let offset = 0; offset < tokenCount; offset += 1) {
      if (operation === DIFF_DELETE) {
        merged.push(...previousTokens[previousIndex].units.map((unit) => ({ ...unit, change: "delete" })));
        previousIndex += 1;
      } else if (operation === DIFF_INSERT) {
        merged.push(...currentTokens[currentIndex].units.map((unit) => ({ ...unit, change: "insert" })));
        currentIndex += 1;
      } else {
        // Equal tokens have equal text, so their units pair up one to one.
        const previousTokenUnits = previousTokens[previousIndex].units;
        currentTokens[currentIndex].units.forEach((currentUnit, unitIndex) => {
          const previousFormat = previousTokenUnits[unitIndex]?.format ?? "";
          merged.push(
            previousFormat === currentUnit.format
              ? { ...currentUnit, change: "" }
              : { ...currentUnit, change: "format", previousFormat },
          );
        });
        previousIndex += 1;
        currentIndex += 1;
      }
    }
  }
  return merged;
}

function wrapInFormat(children, format) {
  const tokens = format ? format.split("\n") : [];
  return tokens.reduceRight((inner, token) => [
    token.startsWith("a ")
      ? elementNode("a", inner, { href: token.slice(2) })
      : elementNode(token, inner),
  ], children);
}

function unitVisibleLength(unit) {
  return unit.atom ? flattenNodesToVisibleText([unit.atom]).length : unit.text.length;
}

/**
 * @returns {{ markup: string, ranges: Array<{ start: number, end: number, change: "insert" | "delete" | "format", note: string }>, hasChanges: boolean }}
 *   `note` names the old formatting for "format" runs ("was: bold"), "" otherwise.
 */
export function buildInlineMarkupDiff(previousMarkup, currentMarkup) {
  const merged = mergeUnits(
    collectDiffUnits(previousMarkup),
    collectDiffUnits(currentMarkup),
  );

  const nodes = [];
  const ranges = [];
  let visibleCursor = 0;
  let index = 0;
  while (index < merged.length) {
    const first = merged[index];
    const runNote = first.change === "format" ? `was: ${describeFormat(first.previousFormat)}` : "";
    const children = [];
    let pendingText = "";
    const runStart = visibleCursor;
    while (
      index < merged.length
      && merged[index].change === first.change
      && merged[index].format === first.format
      && (first.change !== "format" || merged[index].previousFormat === first.previousFormat)
    ) {
      const unit = merged[index];
      if (unit.atom) {
        if (pendingText) {
          children.push(textNode(pendingText, 0, 0, 0));
          pendingText = "";
        }
        children.push(unit.atom);
      } else {
        pendingText += unit.text;
      }
      visibleCursor += unitVisibleLength(unit);
      index += 1;
    }
    if (pendingText) {
      children.push(textNode(pendingText, 0, 0, 0));
    }
    nodes.push(...wrapInFormat(children, first.format));
    if (first.change && visibleCursor > runStart) {
      ranges.push({ start: runStart, end: visibleCursor, change: first.change, note: runNote });
    }
  }

  return {
    markup: serializeNodesAsInlineMarkupSource(nodes),
    ranges,
    hasChanges: merged.some((unit) => unit.change),
  };
}
