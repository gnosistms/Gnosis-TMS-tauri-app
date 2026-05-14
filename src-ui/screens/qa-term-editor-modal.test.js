import test from "node:test";
import assert from "node:assert/strict";

const {
  createQaListEditorState,
  createQaTermEditorState,
  resetSessionState,
  state,
} = await import("../app/state.js");
const { renderQaTermEditorModal } = await import("./qa-term-editor-modal.js");

function installModalFixture() {
  resetSessionState();
  state.qaListEditor = {
    ...createQaListEditorState(),
    qaListId: "qa-list-1",
    language: { code: "vi", name: "Vietnamese" },
  };
  state.qaTermEditor = {
    ...createQaTermEditorState(),
    isOpen: true,
    text: "bản ngã",
    notes: "Use carefully.",
  };
}

test.afterEach(() => {
  resetSessionState();
});

test("QA term modal uses shared textarea styling for both fields", () => {
  installModalFixture();

  const html = renderQaTermEditorModal(state);

  assert.match(html, /class="field__textarea"[\s\S]*data-qa-term-text-input/);
  assert.match(html, /class="field__textarea"[\s\S]*data-qa-term-notes-input/);
  assert.doesNotMatch(html, /term-variant-row__input/);
});
