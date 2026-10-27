import test from "node:test";
import assert from "node:assert/strict";

import {
  GLOSSARY_ENTRY_OTHER_LANGUAGE_TOOLTIP,
  GLOSSARY_ENTRY_TOOLTIP,
  editorGlossaryEntryButtonEnabled,
  editorGlossaryEntryLanguages,
  editorGlossaryEntrySelectionFor,
  glossaryEntryLanguageRole,
  glossaryEntryTooltip,
  readEditorTextSelection,
  syncEditorGlossaryEntryButtons,
} from "./editor-glossary-entry-selection.js";

function fakePanel(rowId, languageCode) {
  const panel = {
    nodeType: 1,
    dataset: { rowId, languageCode },
    closest: (selector) => (selector === "[data-editor-language-panel]" ? panel : null),
  };
  return panel;
}

function fakeTextarea(panel, value, start, end) {
  return {
    tagName: "TEXTAREA",
    nodeType: 1,
    value,
    selectionStart: start,
    selectionEnd: end,
    closest: (selector) => (selector === "[data-editor-language-panel]" ? panel : null),
  };
}

function textNodeIn(panel) {
  return { nodeType: 3, parentElement: panel };
}

function fakeButton(rowId, languageCode) {
  const attributes = new Map([["aria-disabled", "true"]]);
  const classes = new Set(["is-disabled"]);
  const button = {
    dataset: { rowId, languageCode },
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)), contains: (name) => classes.has(name) },
    closest: (selector) => (selector === "[data-editor-glossary-entry-button]" ? button : null),
  };
  return button;
}

function fakeDocument({ activeElement = null, selection = null, buttons = [] } = {}) {
  return {
    activeElement,
    getSelection: () => selection,
    querySelectorAll: () => buttons,
  };
}

test("text highlighted in an editor text box is read without its inline markup", () => {
  const panel = fakePanel("row-1", "es");
  const value = "El <em>Ser interior</em> es   la parte";
  const start = value.indexOf("Ser");
  const textarea = fakeTextarea(panel, value, start, value.indexOf("la parte"));
  assert.deepEqual(readEditorTextSelection(fakeDocument({ activeElement: textarea })), {
    rowId: "row-1",
    languageCode: "es",
    text: "Ser interior es",
  });
  // The highlight may run backwards.
  const backwards = fakeTextarea(panel, "uno dos", 7, 4);
  assert.equal(readEditorTextSelection(fakeDocument({ activeElement: backwards })).text, "dos");
});

test("nothing counts as highlighted for a collapsed caret, spaces only, or a box outside the editor rows", () => {
  const panel = fakePanel("row-1", "es");
  assert.equal(readEditorTextSelection(fakeDocument({ activeElement: fakeTextarea(panel, "uno dos", 2, 2) })), null);
  assert.equal(readEditorTextSelection(fakeDocument({ activeElement: fakeTextarea(panel, "uno   dos", 3, 6) })), null);
  const searchBox = { tagName: "TEXTAREA", value: "alpha", selectionStart: 0, selectionEnd: 5, closest: () => null };
  assert.equal(readEditorTextSelection(fakeDocument({ activeElement: searchBox })), null);
});

test("a page highlight counts only when it starts and ends in the same language panel", () => {
  const spanish = fakePanel("row-1", "es");
  const english = fakePanel("row-1", "en");
  const within = { isCollapsed: false, rangeCount: 1, anchorNode: textNodeIn(english), focusNode: textNodeIn(english),
    toString: () => "  the Inner\nBeing " };
  assert.deepEqual(readEditorTextSelection(fakeDocument({ selection: within })),
    { rowId: "row-1", languageCode: "en", text: "the Inner Being" });
  const across = { ...within, focusNode: textNodeIn(spanish) };
  assert.equal(readEditorTextSelection(fakeDocument({ selection: across })), null);
  assert.equal(readEditorTextSelection(fakeDocument({ selection: { ...within, isCollapsed: true } })), null);
});

test("only the button of the highlighted row and language is enabled", () => {
  const panel = fakePanel("row-1", "vi");
  const buttons = [fakeButton("row-1", "es"), fakeButton("row-1", "vi"), fakeButton("row-2", "vi")];
  const textarea = fakeTextarea(panel, "Đấng Nội Tại là", 0, 12);
  syncEditorGlossaryEntryButtons(fakeDocument({ activeElement: textarea, buttons }));
  assert.deepEqual(buttons.map((button) => button.getAttribute("aria-disabled")), ["true", "false", "true"]);
  assert.equal(buttons[1].classList.contains("is-disabled"), false);
  assert.equal(editorGlossaryEntryButtonEnabled("row-1", "vi"), true, "a redraw keeps the enabled look");
  assert.equal(editorGlossaryEntryButtonEnabled("row-1", "es"), false);

  syncEditorGlossaryEntryButtons(fakeDocument({ activeElement: fakeTextarea(panel, "Đấng", 4, 4), buttons }));
  assert.deepEqual(buttons.map((button) => button.getAttribute("aria-disabled")), ["true", "true", "true"]);
  assert.equal(editorGlossaryEntryButtonEnabled("row-1", "vi"), false);
});

test("a keyboard user who tabs from the highlight to its button keeps the highlight", () => {
  const panel = fakePanel("row-1", "vi");
  const buttons = [fakeButton("row-1", "es"), fakeButton("row-1", "vi")];
  syncEditorGlossaryEntryButtons(fakeDocument({ activeElement: fakeTextarea(panel, "Đấng Nội Tại", 0, 4), buttons }));
  const onButton = fakeDocument({ activeElement: buttons[1], buttons });
  syncEditorGlossaryEntryButtons(onButton);
  assert.equal(buttons[1].getAttribute("aria-disabled"), "false");
  assert.deepEqual(editorGlossaryEntrySelectionFor("row-1", "vi", onButton), { rowId: "row-1", languageCode: "vi", text: "Đấng" });
  assert.equal(editorGlossaryEntrySelectionFor("row-1", "es", onButton), null, "another panel's button gets nothing");

  syncEditorGlossaryEntryButtons(fakeDocument({ activeElement: null, buttons }));
  assert.equal(buttons[1].getAttribute("aria-disabled"), "true", "focus elsewhere forgets it");
});

test("languages are compared with the glossary's languages, regional and base codes included", () => {
  const codes = { sourceCode: "es", targetCode: "zh-Hant" };
  assert.equal(glossaryEntryLanguageRole({ code: "es" }, codes), "source");
  assert.equal(glossaryEntryLanguageRole({ code: "zh_hant" }, codes), "target");
  assert.equal(glossaryEntryLanguageRole({ code: "vi-2", baseCode: "es" }, codes), "source");
  assert.equal(glossaryEntryLanguageRole({ code: "en" }, codes), "other");
  assert.equal(glossaryEntryLanguageRole({ code: "en" }, { sourceCode: "es", targetCode: "" }), null);
  assert.equal(glossaryEntryTooltip("other"), GLOSSARY_ENTRY_OTHER_LANGUAGE_TOOLTIP);
  for (const role of ["source", "target", null]) assert.equal(glossaryEntryTooltip(role), GLOSSARY_ENTRY_TOOLTIP);
});

test("the glossary's languages come from the loaded glossary, then its list record, then the chapter", () => {
  const record = { sourceLanguage: { code: "es" }, targetLanguage: { code: "vi" } };
  assert.deepEqual(editorGlossaryEntryLanguages({ glossary: { sourceLanguage: { code: "en" }, targetLanguage: { code: "fr" } } }, record, "es"),
    { sourceCode: "en", targetCode: "fr" });
  assert.deepEqual(editorGlossaryEntryLanguages({ glossary: { status: "loading" } }, record, "pt"), { sourceCode: "es", targetCode: "vi" });
  assert.deepEqual(editorGlossaryEntryLanguages({}, null, "es"), { sourceCode: "es", targetCode: "" });
});
