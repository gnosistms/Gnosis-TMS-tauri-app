import assert from "node:assert/strict";
import test from "node:test";

import {
  collectIndexSections,
  normalizeIndexKey,
  selectIndexKeys,
} from "./alphabet-index-scroll.js";

test("normalizeIndexKey maps Latin letters, strips diacritics, and falls back cleanly", () => {
  assert.equal(normalizeIndexKey("Árabe"), "A");
  assert.equal(normalizeIndexKey(" Vietnamese"), "V");
  assert.equal(normalizeIndexKey("123 Notes"), "#");
  assert.equal(normalizeIndexKey(""), "#");
  assert.equal(normalizeIndexKey("東京"), "#");
});

test("normalizeIndexKey accepts custom alphabets", () => {
  assert.equal(normalizeIndexKey("東京", { alphabet: ["東"], fallbackKey: "Other" }), "東");
  assert.equal(normalizeIndexKey("Alpha", { alphabet: ["東"], fallbackKey: "Other" }), "Other");
});

test("collectIndexSections groups by first normalized key and preserves first target", () => {
  const firstA = { label: "Árabe" };
  const secondA = { label: "Afrikaans" };
  const vietnamese = { label: "Vietnamese" };
  const sections = collectIndexSections([vietnamese, firstA, secondA], {
    getLabel: (item) => item.label,
    getTarget: (item) => item,
  });

  assert.deepEqual(sections.map((section) => section.key), ["A", "V"]);
  assert.equal(sections[0].target, firstA);
  assert.deepEqual(sections[0].items, [firstA, secondA]);
});

test("collectIndexSections can include disabled missing alphabet entries", () => {
  const sections = collectIndexSections([{ label: "Spanish" }], {
    alphabet: ["A", "S", "Z"],
    includeMissing: true,
  });

  assert.deepEqual(
    sections.map((section) => [section.key, section.disabled]),
    [
      ["A", true],
      ["S", false],
      ["Z", true],
    ],
  );
});

test("selectIndexKeys samples long indexes while keeping the endpoints", () => {
  const sections = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((key) => ({ key }));
  const keys = selectIndexKeys(sections, { maxItems: 5 });

  assert.deepEqual(keys, ["A", "G", "N", "T", "Z"]);
});
