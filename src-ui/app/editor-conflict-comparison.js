import { diff_match_patch, DIFF_DELETE, DIFF_INSERT } from "../lib/vendor/diff-match-patch.js";
import { parseInlineMarkup } from "./editor-inline-markup/parser.js";

const engine = new diff_match_patch();
engine.Diff_Timeout = 0.15;
const MAX_TOKENS = 12000;
const MAX_TEXT = 50000;

// A complete inline element is one merge token. Never splice a link, ruby, or
// formatting wrapper from pieces belonging to different versions.
function tokens(value) {
  const source = String(value ?? "");
  const result = parseInlineMarkup(source).nodes.flatMap((node) => {
    const raw = source.slice(node.rawStart, node.rawEnd);
    return node.type === "element" ? [raw] : raw.match(/\\*\[\d+\]|\r\n|\r|\n|[ \t]+|[\p{L}\p{M}\p{N}_]+|[^\s]/gu) ?? [];
  });
  return result.join("") === source ? result : [source];
}

export function conflictSourceDiff(previous, current) {
  const before = String(previous ?? ""), after = String(current ?? "");
  if (before === after) return [{ change: "", text: after }];
  const left = tokens(before), right = tokens(after);
  if (before.length + after.length > MAX_TEXT || left.length + right.length > MAX_TOKENS) {
    return [{ change: "delete", text: before }, { change: "insert", text: after }];
  }
  const identities = new Map();
  const encode = (items) => items.map((item) => {
    if (!identities.has(item)) identities.set(item, String.fromCharCode(identities.size + 1));
    return identities.get(item);
  }).join("");
  const diffs = engine.diff_main(encode(left), encode(right), false);
  let l = 0, r = 0;
  return diffs.map((diff) => {
    const op = diff[0], encoded = diff[1];
    const length = encoded.length;
    const text = (op === DIFF_INSERT ? right.slice(r, r + length) : left.slice(l, l + length)).join("");
    if (op !== DIFF_INSERT) l += length;
    if (op !== DIFF_DELETE) r += length;
    return { change: op === DIFF_INSERT ? "insert" : op === DIFF_DELETE ? "delete" : "", text };
  });
}

function patches(base, next) {
  let cursor = 0, pending = null;
  const result = [];
  for (const { change, text } of conflictSourceDiff(base, next)) {
    if (!change) {
      if (pending) result.push(pending);
      pending = null;
      cursor += text.length;
    } else {
      pending ??= { start: cursor, end: cursor, text: "" };
      if (change === "delete") { cursor += text.length; pending.end = cursor; }
      else pending.text += text;
    }
  }
  if (pending) result.push(pending);
  return result;
}

// Match the stored footnote migration, including blank lines crossing inline
// tags. This is a suggestion only; the user still explicitly accepts it.
function paragraphMigration(value) {
  const source = value.replace(/\r\n?/g, "\n");
  const blank = new Set();
  const parsed = parseInlineMarkup(source);
  let previous = null;
  const visit = (nodes) => {
    for (const node of nodes) {
      if (node.type === "element") {
        if (node.tag === "hr") previous = null;
        else visit(node.children);
      } else {
        for (let i = node.rawStart; i < node.rawEnd; i++) {
          if (source[i] === "\n") {
            if (previous !== null) { blank.add(previous); blank.add(i); }
            previous = i;
          } else if (source[i] !== " " && source[i] !== "\t") previous = null;
        }
      }
    }
  };
  visit(parsed.nodes);
  return source.split("").map((character, index) => character === "\n" && !blank.has(index) ? "\n\n" : character).join("");
}

function preservesLineBreaks(base, next) {
  return conflictSourceDiff(base, next).every(({ change, text }) => !change || !/[\r\n]/.test(text));
}

export function buildConflictComparison(base, local, remote, { footnote = false } = {}) {
  const result = { combined: null, localParagraphMigration: false, remoteParagraphMigration: false };
  if (base === null || base === undefined) return result;
  if (local === remote) return { ...result, combined: local };
  if (local === base) return { ...result, combined: remote };
  if (remote === base) return { ...result, combined: local };
  if (footnote && typeof local === "string" && typeof remote === "string" && typeof base === "string") {
    const migrated = paragraphMigration(base);
    if (migrated !== base && local === migrated && preservesLineBreaks(base, remote)) return { ...result, combined: paragraphMigration(remote), localParagraphMigration: true };
    if (migrated !== base && remote === migrated && preservesLineBreaks(base, local)) return { ...result, combined: paragraphMigration(local), remoteParagraphMigration: true };
  }
  if ([base, local, remote].some((v) => typeof v !== "string" || v.length > MAX_TEXT / 2)) return result;
  const left = patches(base, local), right = patches(base, remote);
  const same = (a, b) => a.start === b.start && a.end === b.end && a.text === b.text;
  for (const a of left) for (const b of right) {
    if (same(a, b)) continue;
    const overlaps = a.start === a.end ? a.start >= b.start && a.start <= b.end
      : b.start === b.end ? b.start >= a.start && b.start <= a.end
        : a.start < b.end && b.start < a.end;
    if (overlaps) return result;
  }
  const edits = [...left, ...right.filter((b) => !left.some((a) => same(a, b)))].sort((a, b) => b.start - a.start);
  let combined = base;
  for (const edit of edits) combined = combined.slice(0, edit.start) + edit.text + combined.slice(edit.end);
  return { ...result, combined };
}
