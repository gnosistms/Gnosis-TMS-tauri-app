import test from "node:test";
import assert from "node:assert/strict";

import {
  createGlossaryTermEditorState,
  resetSessionState,
  state,
} from "./state.js";
import {
  addGlossaryTermVariant,
  moveGlossaryTermVariantToIndex,
  removeGlossaryTermVariant,
  updateGlossaryTermVariantNote,
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
