import test from "node:test";
import assert from "node:assert/strict";
import { srtGroupSnapshot, validSrtGroupAiResults } from "./editor-srt-group-ai.js";

const rows = [{ rowId: "a", fields: { en: "Hello", vi: "" } }, { rowId: "b", fields: { en: "world", vi: "" } }];

test("group AI accepts exact cue assignments, including intentionally blank translations", () => {
  assert.equal(validSrtGroupAiResults(rows, { rows: [{ rowId: "b", translatedText: "" }, { rowId: "a", translatedText: "Hello world" }] }, "translate"), true);
  assert.equal(validSrtGroupAiResults(rows, { rows: [{ rowId: "a", suggestedText: "sentence", reviewed: false }, { rowId: "b", suggestedText: "", reviewed: false }] }, "grammar"), true);
});

test("group AI rejects missing, duplicate, unknown and malformed assignments", () => {
  const a = { rowId: "a", translatedText: "text" };
  const b = { rowId: "b", translatedText: "" };
  for (const payload of [{ rows: [a] }, { rows: [a, a] }, { rows: [a, { ...b, rowId: "other" }] },
    { rows: [a, b], unknownRowIds: ["other"] }, { rows: [a, { rowId: "b" }] }, { rows: [a, null] }]) {
    assert.equal(validSrtGroupAiResults(rows, payload, "translate"), false);
  }
});

test("stale response snapshots cover non-first member text, attachments, conflicts and membership", () => {
  const captured = srtGroupSnapshot(rows);
  for (const patch of [{ fields: { en: "changed", vi: "" } }, { footnotes: { vi: [{ marker: 1, text: "note" }] } },
    { imageCaptions: { vi: "caption" } }, { freshness: "conflict" }, { lifecycleState: "deleted" }]) {
    assert.notEqual(srtGroupSnapshot([rows[0], { ...rows[1], ...patch }]), captured);
  }
  assert.notEqual(srtGroupSnapshot(rows.toReversed()), captured);
  assert.equal(srtGroupSnapshot(rows.map((row) => ({ ...row, lifecycleState: "active", freshness: "fresh" }))), captured);
});
