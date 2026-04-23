import test from "node:test";
import assert from "node:assert/strict";

const {
  createGlossaryEditorState,
  createGlossaryTermEditorState,
  resetSessionState,
  state,
} = await import("../app/state.js");
const {
  GLOSSARY_EMPTY_TARGET_VARIANT_SENTINEL,
} = await import("../app/glossary-shared.js");
const { renderGlossaryTermEditorModal } = await import("./glossary-term-editor-modal.js");

function installModalFixture() {
  resetSessionState();
  state.glossaryEditor = {
    ...createGlossaryEditorState(),
    glossaryId: "glossary-1",
    sourceLanguage: { code: "ja", name: "Japanese" },
    targetLanguage: { code: "ko", name: "Korean" },
  };
  state.glossaryTermEditor = {
    ...createGlossaryTermEditorState(),
    isOpen: true,
    sourceTerms: ["<ruby>漢字<rt>かんじ</rt></ruby>"],
    targetTerms: ["<ruby>한자<rt>한자</rt></ruby>"],
  };
}

test.afterEach(() => {
  resetSessionState();
});

test("glossary term modal renders localized ruby buttons as visible lane controls", () => {
  installModalFixture();

  const html = renderGlossaryTermEditorModal(state);

  assert.match(html, />振<\/span><\/button>/);
  assert.match(html, /ルビを挿入/);
  assert.match(html, />주<\/span><\/button>/);
  assert.match(html, /발음 표기 추가/);
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /tabindex="-1"/);
  assert.doesNotMatch(html, /Ruby syntax:/);
});

test("glossary term modal places each ruby button before its add-variant button", () => {
  installModalFixture();

  const html = renderGlossaryTermEditorModal(state);

  assert.ok(
    html.indexOf('data-action="toggle-glossary-term-inline-style:ruby:source"')
      < html.indexOf('data-action="add-glossary-term-variant:source"'),
  );
  assert.ok(
    html.indexOf('data-action="toggle-glossary-term-inline-style:ruby:target"')
      < html.indexOf('data-action="add-glossary-term-variant:target"'),
  );
});

test("glossary term modal renders the target no-translation button between ruby and add", () => {
  installModalFixture();

  const html = renderGlossaryTermEditorModal(state);

  assert.ok(
    html.indexOf('data-action="toggle-glossary-term-inline-style:ruby:target"')
      < html.indexOf('data-action="add-glossary-term-empty-variant:target"'),
  );
  assert.ok(
    html.indexOf('data-action="add-glossary-term-empty-variant:target"')
      < html.indexOf('data-action="add-glossary-term-variant:target"'),
  );
  assert.match(
    html,
    /Add an empty variant to indicated that it&#39;s ok to omit this word from the translation\./,
  );
  assert.match(html, />⊘<\/span><\/button>/);
});

test("glossary term modal renders empty target variants as disabled placeholder rows", () => {
  installModalFixture();
  state.glossaryTermEditor.targetTerms = [GLOSSARY_EMPTY_TARGET_VARIANT_SENTINEL];

  const html = renderGlossaryTermEditorModal(state);

  assert.match(html, /term-variant-row__shell--disabled/);
  assert.match(html, /term-variant-row__input--disabled/);
  assert.match(html, /\[No translation\]/);
  assert.doesNotMatch(
    html,
    /term-variant-row__shell--disabled[\s\S]*data-glossary-term-variant-input/,
  );
});
