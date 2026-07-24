import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_TIMING_DURATION_MS,
  chapterHasSrtSourceFormat,
  cloneRowTimings,
  computeChapterTimingErrors,
  computeTimingErrors,
  effectiveRowTiming,
  formatTimingMs,
  parseTimingInput,
  rowTimingsEqual,
  timingValuesEqual,
} from "./editor-timing.js";

test("formatTimingMs renders canonical SRT timestamps", () => {
  assert.equal(formatTimingMs(0), "00:00:00,000");
  assert.equal(formatTimingMs(3_723_004), "01:02:03,004");
  assert.equal(formatTimingMs(360_000_000), "100:00:00,000");
  assert.equal(formatTimingMs(Number.NaN), "00:00:00,000");
  assert.equal(formatTimingMs(-5), "00:00:00,000");
});

test("parseTimingInput accepts canonical and tolerant timestamp forms", () => {
  assert.equal(parseTimingInput("00:00:01,000"), 1000);
  assert.equal(parseTimingInput("01:02:03,004"), 3_723_004);
  assert.equal(parseTimingInput("00:00:01.500"), 1500);
  assert.equal(parseTimingInput("0:00:01,5"), 1500);
  assert.equal(parseTimingInput("100:00:00,000"), 360_000_000);
  assert.equal(parseTimingInput("02:03"), 123_000);
  assert.equal(parseTimingInput("02:03,250"), 123_250);
  assert.equal(parseTimingInput("  00:00:02,000  "), 2000);
});

test("parseTimingInput rejects invalid timestamps", () => {
  assert.equal(parseTimingInput(""), null);
  assert.equal(parseTimingInput("abc"), null);
  assert.equal(parseTimingInput("00:61:00,000"), null);
  assert.equal(parseTimingInput("00:00:61,000"), null);
  assert.equal(parseTimingInput("00:00:00,0000"), null);
  assert.equal(parseTimingInput("1:2:3:4"), null);
  assert.equal(parseTimingInput("00:00:01,000 --> 00:00:02,000"), null);
});

test("parse and format round-trip", () => {
  for (const text of ["00:00:00,000", "01:02:03,004", "12:34:56,789"]) {
    assert.equal(formatTimingMs(parseTimingInput(text)), text);
  }
});

test("effectiveRowTiming prefers the language override over the row base timing", () => {
  const row = {
    timings: { vi: { startMs: 1500, endMs: 2600 } },
    srtTiming: { startMs: 1000, endMs: 2000 },
  };
  assert.deepEqual(effectiveRowTiming(row, "vi"), { startMs: 1500, endMs: 2600 });
  assert.deepEqual(effectiveRowTiming(row, "en"), { startMs: 1000, endMs: 2000 });
  assert.equal(effectiveRowTiming({ timings: {}, srtTiming: null }, "en"), null);
});

test("timing equality helpers", () => {
  assert.equal(timingValuesEqual(null, null), true);
  assert.equal(timingValuesEqual({ startMs: 1, endMs: 2 }, { startMs: 1, endMs: 2 }), true);
  assert.equal(timingValuesEqual({ startMs: 1, endMs: 2 }, { startMs: 1, endMs: 3 }), false);
  assert.equal(timingValuesEqual({ startMs: 1, endMs: 2 }, null), false);
  assert.equal(
    rowTimingsEqual({ en: { startMs: 1, endMs: 2 } }, { en: { startMs: 1, endMs: 2 } }),
    true,
  );
  assert.equal(rowTimingsEqual({ en: { startMs: 1, endMs: 2 } }, {}), false);
  assert.equal(rowTimingsEqual({}, {}), true);
});

test("cloneRowTimings drops malformed entries and copies values", () => {
  const source = {
    en: { startMs: 1, endMs: 2 },
    vi: { startMs: "bad", endMs: 2 },
    zz: null,
  };
  const cloned = cloneRowTimings(source);
  assert.deepEqual(cloned, { en: { startMs: 1, endMs: 2 } });
  cloned.en.startMs = 99;
  assert.equal(source.en.startMs, 1);
});

test("computeTimingErrors marks too-short rows on both inputs", () => {
  const errors = computeTimingErrors([
    { startMs: 0, endMs: MIN_TIMING_DURATION_MS - 1 },
    { startMs: 1000, endMs: 2000 },
  ]);
  assert.deepEqual(errors[0], { startError: true, endError: true });
  assert.deepEqual(errors[1], { startError: false, endError: false });
});

test("computeTimingErrors exempts empty-text entries from the minimum duration", () => {
  const errors = computeTimingErrors([
    { startMs: 0, endMs: 10, emptyText: true },
    { startMs: 100, endMs: 110, emptyText: false },
  ]);
  assert.deepEqual(errors[0], { startError: false, endError: false });
  assert.deepEqual(errors[1], { startError: true, endError: true });
});

test("empty-text entries still participate in overlap checks", () => {
  const errors = computeTimingErrors([
    { startMs: 0, endMs: 2000, emptyText: true },
    { startMs: 1500, endMs: 4000 },
  ]);
  assert.deepEqual(errors[0], { startError: false, endError: true });
  assert.deepEqual(errors[1], { startError: true, endError: false });
});

test("computeChapterTimingErrors exempts rows whose text is empty in that language", () => {
  const rows = [
    {
      rowId: "row-1",
      lifecycleState: "active",
      fields: { en: "spoken line", vi: "" },
      timings: {},
      srtTiming: { startMs: 0, endMs: 100 },
    },
  ];

  const errorsByRowId = computeChapterTimingErrors(rows, ["en", "vi"]);

  // Too short in en (has text); exempt in vi (still empty).
  assert.deepEqual(errorsByRowId.get("row-1"), {
    en: { startError: true, endError: true },
  });
});

test("computeTimingErrors treats end-before-start as too short", () => {
  const errors = computeTimingErrors([{ startMs: 5000, endMs: 1000 }]);
  assert.deepEqual(errors[0], { startError: true, endError: true });
});

test("computeTimingErrors marks both rows of an overlapping pair", () => {
  const errors = computeTimingErrors([
    { startMs: 0, endMs: 2000 },
    { startMs: 1500, endMs: 3000 },
  ]);
  assert.deepEqual(errors[0], { startError: false, endError: true });
  assert.deepEqual(errors[1], { startError: true, endError: false });
});

test("computeTimingErrors accepts exact adjacency", () => {
  const errors = computeTimingErrors([
    { startMs: 0, endMs: 2000 },
    { startMs: 2000, endMs: 3000 },
  ]);
  assert.deepEqual(errors[0], { startError: false, endError: false });
  assert.deepEqual(errors[1], { startError: false, endError: false });
});

test("computeTimingErrors skips untimed rows without breaking adjacency", () => {
  const errors = computeTimingErrors([
    { startMs: 0, endMs: 2000 },
    null,
    { startMs: 1500, endMs: 3000 },
  ]);
  assert.deepEqual(errors[0], { startError: false, endError: true });
  assert.deepEqual(errors[1], { startError: false, endError: false });
  assert.deepEqual(errors[2], { startError: true, endError: false });
});

test("computeChapterTimingErrors evaluates each language independently and skips deleted rows", () => {
  const rows = [
    {
      rowId: "row-1",
      lifecycleState: "active",
      timings: {},
      srtTiming: { startMs: 0, endMs: 2000 },
    },
    {
      rowId: "row-deleted",
      lifecycleState: "deleted",
      timings: {},
      srtTiming: { startMs: 100, endMs: 200 },
    },
    {
      rowId: "row-2",
      lifecycleState: "active",
      // The vi override overlaps row-1; en inherits clean base timing.
      timings: { vi: { startMs: 1500, endMs: 3000 } },
      srtTiming: { startMs: 2500, endMs: 3500 },
    },
  ];

  const errorsByRowId = computeChapterTimingErrors(rows, ["en", "vi"]);

  assert.equal(errorsByRowId.has("row-deleted"), false);
  assert.deepEqual(errorsByRowId.get("row-2"), {
    vi: { startError: true, endError: false },
  });
  assert.deepEqual(errorsByRowId.get("row-1"), {
    vi: { startError: false, endError: true },
  });
});

test("chapterHasSrtSourceFormat", () => {
  assert.equal(chapterHasSrtSourceFormat(["srt"]), true);
  assert.equal(chapterHasSrtSourceFormat(["docx"]), false);
  assert.equal(chapterHasSrtSourceFormat([]), false);
  assert.equal(chapterHasSrtSourceFormat(null), false);
});
