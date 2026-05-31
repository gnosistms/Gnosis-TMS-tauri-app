import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeEditorFootnotes,
  normalizeEditorRowFootnotesForSave,
  serializeEditorFootnotesForLegacy,
} from "./editor-footnotes.js";

test("normalizeEditorFootnotes reads legacy single and labeled multi-footnote text", () => {
  assert.deepEqual(normalizeEditorFootnotes("Legacy note"), [
    { marker: 1, text: "Legacy note" },
  ]);
  assert.deepEqual(normalizeEditorFootnotes("[1] First\n\n[2] Second"), [
    { marker: 1, text: "First" },
    { marker: 2, text: "Second" },
  ]);
});

test("normalizeEditorRowFootnotesForSave keeps saved row text unchanged for missing markers", () => {
  assert.deepEqual(
    normalizeEditorRowFootnotesForSave("Body", [{ marker: 1, text: "Note" }]),
    {
      text: "Body",
      footnotes: [{ marker: 1, text: "Note" }],
    },
  );
});

test("normalizeEditorRowFootnotesForSave deletes empty unreferenced footnotes and preserves referenced empty ones without renumbering", () => {
  assert.deepEqual(
    normalizeEditorRowFootnotesForSave("Body [2]", [
      { marker: 1, text: "" },
      { marker: 2, text: "" },
    ]),
    {
      text: "Body [2]",
      footnotes: [{ marker: 2, text: "" }],
    },
  );
});

test("normalizeEditorRowFootnotesForSave leaves duplicate and unknown text markers untouched", () => {
  assert.deepEqual(
    normalizeEditorRowFootnotesForSave("A [2] B [2] C [100]", [
      { marker: 2, text: "Second note" },
    ]),
    {
      text: "A [2] B [2] C [100]",
      footnotes: [{ marker: 2, text: "Second note" }],
    },
  );
});

test("serializeEditorFootnotesForLegacy keeps single notes readable and labels multiple notes", () => {
  assert.equal(serializeEditorFootnotesForLegacy([{ marker: 1, text: "One" }]), "One");
  assert.equal(serializeEditorFootnotesForLegacy([{ marker: 2, text: "Two" }]), "[2] Two");
  assert.equal(
    serializeEditorFootnotesForLegacy([
      { marker: 1, text: "One" },
      { marker: 2, text: "Two" },
    ]),
    "[1] One\n\n[2] Two",
  );
});
