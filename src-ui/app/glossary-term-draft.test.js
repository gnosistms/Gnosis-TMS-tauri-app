import test from "node:test";
import assert from "node:assert/strict";

import {
  createGlossaryTermEditorState,
  resetSessionState,
  state,
} from "./state.js";
import { setStudioEditorHandler } from "./glossary-research-studio-editor-bridge.js";
import {
  addGlossaryTermVariant,
  openStudioEntryEditor,
  submitGlossaryTermEditor,
  moveGlossaryTermVariantToIndex,
  removeGlossaryTermVariant,
  updateGlossaryTermVariantNote,
  updateGlossaryTermVariant,
} from "./glossary-term-draft.js";
import {
  GLOSSARY_EMPTY_TARGET_VARIANT_SENTINEL,
  sanitizeEditableTargetTermPairs,
} from "./glossary-shared.js";

test.afterEach(() => {
  resetSessionState();
});

function openDraft(targetTerms = ["alpha", "beta"], targetVariantNotes = ["A", "B"]) {
  state.glossaryTermEditor = {
    ...createGlossaryTermEditorState(),
    isOpen: true,
    targetTerms,
    targetVariantNotes,
  };
}

test("target variant note edits stay aligned through add, remove, and move", () => {
  openDraft();

  updateGlossaryTermVariantNote(1, "Updated B");
  addGlossaryTermVariant("target");
  updateGlossaryTermVariantNote(2, "C");
  moveGlossaryTermVariantToIndex("target", 2, 0);
  removeGlossaryTermVariant("target", 1);

  assert.deepEqual(state.glossaryTermEditor.targetTerms, ["", "beta"]);
  assert.deepEqual(state.glossaryTermEditor.targetVariantNotes, ["C", "Updated B"]);
});

test("case-only source variants within a draft are marked together", () => {
  openDraft();
  state.glossaryTermEditor.sourceTerms = ["Íntimo", "ÍNTIMO", "intimo"];
  state.glossaryTermEditor.sourceTermDuplicateWarning = "Check duplicates";
  updateGlossaryTermVariant("source", 1, " ÍNTIMO ");
  assert.deepEqual(state.glossaryTermEditor.redundantSourceVariantIndices, [0, 1]);
  updateGlossaryTermVariant("source", 1, "Other");
  assert.deepEqual(state.glossaryTermEditor.redundantSourceVariantIndices, []);
});

test("target pair sanitizing merges duplicate notes and keeps empty variant notes", () => {
  const result = sanitizeEditableTargetTermPairs(
    ["alpha", "alpha", GLOSSARY_EMPTY_TARGET_VARIANT_SENTINEL],
    ["First", "Second", "Omit when redundant."],
  );

  assert.deepEqual(result, {
    targetTerms: ["alpha", ""],
    targetVariantNotes: ["First\n\nSecond", "Omit when redundant."],
  });
});

test("target pair sanitizing keeps a raw blank row when it has a note", () => {
  const result = sanitizeEditableTargetTermPairs(
    ["alpha", ""],
    ["", "Omit when redundant."],
  );

  assert.deepEqual(result, {
    targetTerms: ["alpha", ""],
    targetVariantNotes: ["", "Omit when redundant."],
  });
});

test("saving the research entry under test hands the edit to the study, not the glossary", async () => {
  const renders = [];
  const received = [];
  setStudioEditorHandler(async (event, origin, value) => {
    received.push([event, origin.studyId, value]);
    if (value.targetTerms.includes("refused")) throw new Error("Meaning 2 would have no translation.");
  });
  try {
    openStudioEntryEditor(() => renders.push("open"), { sourceTerms: ["antítesis"], targetTerms: ["antithesis", " polarity "],
      targetVariantNotes: ["Logic.", ""], notesToTranslators: "General.", footnote: "" }, { studyId: "study", meaningId: "m" });
    assert.equal(state.glossaryTermEditor.isOpen, true);
    await submitGlossaryTermEditor(() => renders.push("render"));
    assert.deepEqual(received, [["entry", "study", { targetTerms: ["antithesis", "polarity"], targetVariantNotes: ["Logic.", ""],
      notesToTranslators: "General.", footnote: "" }]]);
    assert.equal(state.glossaryTermEditor.isOpen, false);

    openStudioEntryEditor(() => {}, { sourceTerms: ["antítesis"], targetTerms: ["refused"] }, { studyId: "study", meaningId: "m" });
    await submitGlossaryTermEditor(() => {});
    assert.equal(state.glossaryTermEditor.isOpen, true);
    assert.equal(state.glossaryTermEditor.error, "Meaning 2 would have no translation.");
    assert.equal(state.glossaryTermEditor.status, "idle");
  } finally { setStudioEditorHandler(null); }
});
