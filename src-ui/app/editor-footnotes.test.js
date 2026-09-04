import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEditorFootnoteInsertion,
  applyEditorFootnoteText,
  editorFootnoteMarkerSequence,
  editorFootnoteMarkerSequencesEqual,
  editorFootnotesForAiReview,
  mergeEditorFootnoteCorrections,
  normalizeEditorFootnotes,
  normalizeEditorRowFootnotesForSave,
  serializeEditorFootnotesForLegacy,
} from "./editor-footnotes.js";

test("glossary footnote insertion sticks a fresh marker to the hovered term end", () => {
  assert.deepEqual(
    buildEditorFootnoteInsertion(
      "The Kabbaalah teaching continues.",
      [{ marker: 1, text: "Existing note" }],
      13,
      "Glossary footnote",
    ),
    {
      marker: 2,
      text: "The Kabbaalah[2] teaching continues.",
      footnotes: [
        { marker: 1, text: "Existing note" },
        { marker: 2, text: "Glossary footnote" },
      ],
    },
  );
});

test("single-footnote updates reject structured values instead of stringifying them", () => {
  const original = [
    { marker: 1, text: "One" },
    { marker: 2, text: "Two" },
  ];

  assert.throws(
    () => applyEditorFootnoteText(original, 1, original),
    new TypeError("Footnote text must be a string."),
  );
  assert.deepEqual(original, [
    { marker: 1, text: "One" },
    { marker: 2, text: "Two" },
  ]);
});

test("AI Review footnote helpers preserve markers and merge text by marker", () => {
  const original = [
    { marker: 1, text: "One" },
    { marker: 2, text: "Two" },
    { marker: 3, text: "Three" },
  ];

  assert.deepEqual(editorFootnotesForAiReview(original), original);
  assert.deepEqual(
    mergeEditorFootnoteCorrections(original, [
      { marker: 3, text: "Three corrected" },
      { marker: 1, text: "One corrected" },
    ]),
    {
      ok: true,
      footnotes: [
        { marker: 1, text: "One corrected" },
        { marker: 2, text: "Two" },
        { marker: 3, text: "Three corrected" },
      ],
      reason: "",
    },
  );
});

test("AI Review footnote helpers reject invalid, unknown, and duplicate markers", () => {
  const original = [{ marker: 9, text: "Nine" }];

  assert.equal(mergeEditorFootnoteCorrections(original, [{ marker: 0, text: "Zero" }]).reason, "invalid-marker");
  assert.equal(mergeEditorFootnoteCorrections(original, [{ marker: 1, text: "One" }]).reason, "unknown-marker");
  assert.equal(
    mergeEditorFootnoteCorrections(original, [
      { marker: 9, text: "First" },
      { marker: 9, text: "Second" },
    ]).reason,
    "duplicate-marker",
  );
});

test("AI Review footnote helpers preserve empty corrections and reject invented serialized markers", () => {
  assert.deepEqual(
    mergeEditorFootnoteCorrections(
      [{ marker: 1, text: "One" }],
      [{ marker: 1, text: "" }],
    ),
    {
      ok: true,
      footnotes: [{ marker: 1, text: "" }],
      reason: "",
    },
  );
  assert.equal(
    mergeEditorFootnoteCorrections(
      [{ marker: 1, text: "One" }],
      [{ marker: 1, text: "[9] Invented" }],
    ).reason,
    "serialization-marker-change",
  );
  assert.equal(
    mergeEditorFootnoteCorrections(
      [{ marker: 1, text: "One" }, { marker: 2, text: "Two" }],
      [{ marker: 1, text: "Corrected\n\n[9] Invented" }],
    ).reason,
    "serialization-marker-change",
  );
});

test("AI Review marker sequence ignores escaped literals and preserves ordered identity", () => {
  assert.deepEqual(editorFootnoteMarkerSequence("A[1] B\\[99\\] C[2]"), [1, 2]);
  assert.equal(editorFootnoteMarkerSequencesEqual("A[1] B[2]", "A changed [1] B changed [2]"), true);
  assert.equal(editorFootnoteMarkerSequencesEqual("A[1] B[2]", "A[2] B[1]"), false);
  assert.equal(editorFootnoteMarkerSequencesEqual("A[1] B[2]", "A[1]"), false);
});

test("normalizeEditorFootnotes reads legacy single and labeled multi-footnote text", () => {
  assert.deepEqual(normalizeEditorFootnotes("Legacy note"), [
    { marker: 1, text: "Legacy note" },
  ]);
  assert.deepEqual(normalizeEditorFootnotes("[1] First\n\n[2] Second"), [
    { marker: 1, text: "First" },
    { marker: 2, text: "Second" },
  ]);
});

test("normalizeEditorFootnotes reads adjacent blank legacy markers as separate notes", () => {
  assert.deepEqual(normalizeEditorFootnotes("[1] fdsfd\n\n[2] [3]"), [
    { marker: 1, text: "fdsfd" },
    { marker: 2, text: "" },
    { marker: 3, text: "" },
  ]);
});

test("normalizeEditorFootnotes trims leading/trailing whitespace left by deleting a sibling footnote", () => {
  // A leading newline survives in the unlabeled single-note fallback and renders
  // as a blank line above the note in the pre-wrap display. Trim it instead.
  assert.deepEqual(normalizeEditorFootnotes("\n\nhttps://example.org/path"), [
    { marker: 1, text: "https://example.org/path" },
  ]);
  assert.deepEqual(normalizeEditorFootnotes([{ marker: 1, text: "\n  spaced  \n" }]), [
    { marker: 1, text: "spaced" },
  ]);
});

test("normalizeEditorFootnotes preserves inline marker references in note text", () => {
  assert.deepEqual(normalizeEditorFootnotes("[1] see [3]"), [
    { marker: 1, text: "see [3]" },
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

test("serializeEditorFootnotesForLegacy canonicalizes adjacent blank legacy markers", () => {
  assert.equal(
    serializeEditorFootnotesForLegacy("[1] fdsfd\n\n[2] [3]"),
    "[1] fdsfd\n\n[2]\n\n[3]",
  );
});

test("serializeEditorFootnotesForLegacy keeps single notes readable and labels multiple notes", () => {
  assert.equal(serializeEditorFootnotesForLegacy([{ marker: 1, text: "One" }]), "One");
  assert.equal(serializeEditorFootnotesForLegacy([{ marker: 1, text: "" }]), "[1]");
  assert.equal(serializeEditorFootnotesForLegacy([{ marker: 2, text: "Two" }]), "[2] Two");
  assert.equal(
    serializeEditorFootnotesForLegacy([
      { marker: 1, text: "One" },
      { marker: 2, text: "Two" },
    ]),
    "[1] One\n\n[2] Two",
  );
});

test("serializeEditorFootnotesForLegacy round trips a referenced empty first footnote", () => {
  const serialized = serializeEditorFootnotesForLegacy([{ marker: 1, text: "" }]);

  assert.deepEqual(normalizeEditorFootnotes(serialized), [{ marker: 1, text: "" }]);
});
