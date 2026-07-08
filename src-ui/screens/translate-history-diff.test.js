import test from "node:test";
import assert from "node:assert/strict";

import { buildHistoryDiffSegments } from "./translate-history-shared.js";

function joinByTypes(segments, types) {
  return segments
    .filter((segment) => types.includes(segment.type))
    .map((segment) => segment.text)
    .join("");
}

test("diff preserves astral characters instead of splitting surrogate pairs", () => {
  const segments = buildHistoryDiffSegments("Party 🎉 time", "Party 🎊 time");

  // Every segment must be well-formed UTF-16 — no lone surrogates that would
  // render as U+FFFD.
  for (const segment of segments) {
    assert.ok(segment.text.isWellFormed(), `segment "${segment.text}" has a lone surrogate`);
  }
  // The emoji is replaced atomically, not corrupted into shared-surrogate noise.
  assert.equal(joinByTypes(segments, ["equal", "delete"]), "Party 🎉 time");
  assert.equal(joinByTypes(segments, ["equal", "insert"]), "Party 🎊 time");
  assert.ok(
    segments.some((s) => s.type === "delete" && s.text === "🎉"),
    "the old emoji is a clean delete",
  );
  assert.ok(
    segments.some((s) => s.type === "insert" && s.text === "🎊"),
    "the new emoji is a clean insert",
  );
});

test("diff round-trips plain ASCII edits", () => {
  const segments = buildHistoryDiffSegments("the cat sat", "the dog sat");

  assert.equal(joinByTypes(segments, ["equal", "delete"]), "the cat sat");
  assert.equal(joinByTypes(segments, ["equal", "insert"]), "the dog sat");
});

test("diff handles flag sequences (paired regional indicators) without corruption", () => {
  const segments = buildHistoryDiffSegments("go 🇯🇵 now", "go 🇰🇷 now");

  for (const segment of segments) {
    assert.ok(segment.text.isWellFormed(), `segment "${segment.text}" has a lone surrogate`);
  }
  assert.equal(joinByTypes(segments, ["equal", "delete"]), "go 🇯🇵 now");
  assert.equal(joinByTypes(segments, ["equal", "insert"]), "go 🇰🇷 now");
});
