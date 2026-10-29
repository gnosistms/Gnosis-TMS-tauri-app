// Keys in a list row's textarea, as text edits: Return starts an item at the
// current level (or outdents an empty indented item), Tab and Shift+Tab indent
// and outdent every line the selection touches. Backspace after an item's tabs
// already outdents natively. Each edit replaces [start, end) with `text` and
// then selects [selectionStart, selectionEnd).
import { LIST_MAX_LEVEL } from "./editor-list.js";

function lineStartAt(value, position) {
  return value.lastIndexOf("\n", position - 1) + 1;
}

function lineEndAt(value, position) {
  const end = value.indexOf("\n", position);
  return end < 0 ? value.length : end;
}

function leadingTabCount(line) {
  return /^\t*/.exec(line)[0].length;
}

function isBlankLine(line) {
  return !/\S/.test(line);
}

export function listReturnEdit(value, selectionStart, selectionEnd) {
  const lineStart = lineStartAt(value, selectionStart);
  const line = value.slice(lineStart, lineEndAt(value, selectionStart));
  const tabs = leadingTabCount(line);
  if (selectionStart === selectionEnd && tabs > 0 && isBlankLine(line)) {
    return {
      start: lineStart,
      end: lineStart + line.length,
      text: "\t".repeat(tabs - 1),
      selectionStart: lineStart + tabs - 1,
      selectionEnd: lineStart + tabs - 1,
    };
  }
  const text = `\n${"\t".repeat(tabs)}`;
  return {
    start: selectionStart,
    end: selectionEnd,
    text,
    selectionStart: selectionStart + text.length,
    selectionEnd: selectionStart + text.length,
  };
}

// The tab count of the nearest non-blank line above `lineStart`, or -1.
function previousItemTabs(value, lineStart) {
  let end = lineStart - 1;
  while (end > 0) {
    const start = lineStartAt(value, end);
    const line = value.slice(start, end);
    if (!isBlankLine(line)) {
      return leadingTabCount(line);
    }
    end = start - 1;
  }
  return -1;
}

export function listIndentEdit(value, selectionStart, selectionEnd, outdent = false) {
  const blockStart = lineStartAt(value, selectionStart);
  // A selection ending at the start of a line does not take that line along.
  const lastPosition = selectionEnd > selectionStart && value[selectionEnd - 1] === "\n"
    ? selectionEnd - 1
    : selectionEnd;
  const blockEnd = lineEndAt(value, Math.max(lastPosition, blockStart));
  const lines = value.slice(blockStart, blockEnd).split("\n");
  // Each line's start in the old text and the change made there (+1 / -1 / 0).
  const changes = [];
  let previousTabs = previousItemTabs(value, blockStart);
  let lineStart = blockStart;
  // A new, still empty item moves; blank lines among selected items do not.
  const movesBlankLines = lines.length === 1;
  const nextLines = lines.map((line) => {
    const tabs = leadingTabCount(line);
    let delta = 0;
    if (movesBlankLines || !isBlankLine(line)) {
      if (outdent) {
        delta = tabs > 0 ? -1 : 0;
      } else if (tabs + 1 <= previousTabs + 1 && tabs < LIST_MAX_LEVEL) {
        delta = 1;
      }
      previousTabs = tabs + delta;
    }
    changes.push({ lineStart, delta });
    lineStart += line.length + 1;
    return delta > 0 ? `\t${line}` : delta < 0 ? line.slice(1) : line;
  });
  if (changes.every(({ delta }) => delta === 0)) {
    return null;
  }
  const mapPosition = (position) => changes.reduce((mapped, { lineStart: start, delta }) => {
    if (delta > 0 && position >= start) return mapped + 1;
    if (delta < 0 && position > start) return mapped - 1;
    return mapped;
  }, position);
  return {
    start: blockStart,
    end: blockEnd,
    text: nextLines.join("\n"),
    selectionStart: mapPosition(selectionStart),
    selectionEnd: mapPosition(selectionEnd),
  };
}
