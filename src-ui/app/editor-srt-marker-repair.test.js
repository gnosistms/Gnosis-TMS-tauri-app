import test from "node:test";
import assert from "node:assert/strict";
import { repairSrtGroupMarkers } from "./editor-srt-marker-repair.js";
import { createSrtGroupText } from "./editor-srt-group-text.js";

const markers = ["⟦1⟧", "⟦2⟧"];

test("missing brackets close immediately around the adjacent complete number", () => {
  for (const raw of ["a⟦1b⟦2c", "a1⟧b2⟧c", "a⟦1⟧b2⟧c", "a⟦⟦1⟧⟧b⟦2⟧c"]) {
    const result = repairSrtGroupMarkers(raw, markers);
    assert.equal(result.error, "", raw);
    assert.equal(result.text, "a⟦1⟧b⟦2⟧c", raw);
    assert.equal(result.corrected, true);
    assert.deepEqual(result.parts, ["a", "b", "c"]);
  }
});

test("stray nonnumeric brackets are removed without deleting ordinary text", () => {
  const result = repairSrtGroupMarkers("⟦word⟧ a⟦1⟧b⟦2⟧c ⟦", markers);
  assert.equal(result.text, "word a⟦1⟧b⟦2⟧c ");
  assert.equal(result.corrected, true);
  assert.deepEqual(result.parts, ["word a", "b", "c "]);
});

test("numeric spelling is normalized; missing separators are proposed using the earlier rule", () => {
  assert.equal(repairSrtGroupMarkers("a⟦ ０１ ⟧b⟦ 02 ⟧c", markers).text, "a⟦1⟧b⟦2⟧c");
  assert.equal(repairSrtGroupMarkers("a⟦\t1\t⟧b⟦2⟧c", markers).text, "a⟦1⟧b⟦2⟧c");
  assert.deepEqual(repairSrtGroupMarkers("ab⟦2⟧c", markers).parts, ["ab", "", "c"]);
  assert.equal(repairSrtGroupMarkers("abc", markers).text, "abc⟦1⟧⟦2⟧");
  assert.equal(repairSrtGroupMarkers("", markers).text, "⟦1⟧⟦2⟧");
  assert.equal(repairSrtGroupMarkers("a⟦1⟧b⟦2⟧c", markers).corrected, false);
});

test("repairs consume complete multi-digit marker numbers and are idempotent", () => {
  const expected = Array.from({ length: 12 }, (_, index) => `⟦${index + 1}⟧`);
  const raw = expected.map((token, index) => `text${token.replace(index % 2 ? "⟦" : "⟧", "")}`).join("");
  const repaired = repairSrtGroupMarkers(raw, expected);
  assert.equal(repaired.error, "");
  assert.equal(repaired.text, expected.map((token) => `text${token}`).join(""));
  assert.equal(repairSrtGroupMarkers(repaired.text, expected).corrected, false);
});

test("duplicates, order, and unexpected numbers remain errors; offer a sample when none is usable", () => {
  for (const raw of ["a⟦1⟧b⟦1⟧c", "a⟦2⟧b⟦1⟧c", "a⟦0⟧b", "a⟦99⟧b", "a⟦99999999999999999999⟧b"]) {
    const result = repairSrtGroupMarkers(raw, markers);
    assert.ok(result.error, raw);
    assert.equal(result.parts, undefined);
    assert.equal(result.text, /⟦[12]⟧/u.test(raw) ? raw : `${raw}⟦1⟧`);
  }
});

test("collision-prefixed separators repair without reinterpreting literal cue brackets", () => {
  const parts = ["literal ⟦1⟧", "second", "last"];
  const spec = createSrtGroupText(parts);
  assert.equal(repairSrtGroupMarkers(spec.text, spec.markers, parts).corrected, false);
  const result = repairSrtGroupMarkers("literal ⟦1⟧⟦#1second#2⟧last", spec.markers, parts);
  assert.deepEqual(result.parts, parts);
});
