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

test("QA term modal renders case-sensitive and regex checkboxes below the term", () => {
  installModalFixture();
  state.qaTermEditor.isCaseSensitive = true;
  state.qaTermEditor.isRegularExpression = true;

  const html = renderQaTermEditorModal(state);
  const termIndex = html.indexOf("data-qa-term-text-input");
  const caseIndex = html.indexOf("data-qa-term-case-sensitive-input");
  const regexIndex = html.indexOf("data-qa-term-regular-expression-input");

  assert.ok(termIndex >= 0 && caseIndex > termIndex && regexIndex > caseIndex);
  assert.match(html, /data-qa-term-case-sensitive-input[\s\S]*checked/);
  assert.match(html, /data-qa-term-regular-expression-input[\s\S]*checked/);
  assert.match(html, /term found in the translation text must exactly match the case/);
  assert.match(html, /regular expression search rather than plain text/);
});
