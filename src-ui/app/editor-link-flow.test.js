import test from "node:test";
import assert from "node:assert/strict";

import { applyInsertLinkToValue, submitEditorInsertLink, validateEditorLinkUrl } from "./editor-link-flow.js";
import { state } from "./state.js";

test("validateEditorLinkUrl accepts explicit http(s) urls", () => {
  assert.equal(validateEditorLinkUrl("https://example.com/page?a=1"), "https://example.com/page?a=1");
  assert.equal(validateEditorLinkUrl("  http://example.com  "), "http://example.com");
});

test("validateEditorLinkUrl normalizes scheme-less urls to https", () => {
  assert.equal(validateEditorLinkUrl("google.com/privacy"), "https://google.com/privacy");
  assert.equal(validateEditorLinkUrl("example.com"), "https://example.com");
  assert.equal(validateEditorLinkUrl("www.example.com:8080/path?a=1"), "https://www.example.com:8080/path?a=1");
  assert.equal(validateEditorLinkUrl("localhost:3000/admin"), "https://localhost:3000/admin");
  assert.equal(validateEditorLinkUrl("//cdn.example.com/lib.js"), "https://cdn.example.com/lib.js");
});

test("validateEditorLinkUrl rejects non-links", () => {
  assert.equal(validateEditorLinkUrl(""), "");
  assert.equal(validateEditorLinkUrl("not a url"), "");
  assert.equal(validateEditorLinkUrl("plainword"), "");
  assert.equal(validateEditorLinkUrl("javascript:alert(1)"), "");
  assert.equal(validateEditorLinkUrl("mailto:user@example.com"), "");
  assert.equal(validateEditorLinkUrl("data:text/html,hi"), "");
  assert.equal(validateEditorLinkUrl("ftp://example.com"), "");
  assert.equal(validateEditorLinkUrl("google.com@evil.com"), "");
  assert.equal(validateEditorLinkUrl("https://user:pass@example.com"), "https://user:pass@example.com");
});

test("applyInsertLinkToValue wraps the selection in a canonical link", () => {
  const value = "Read the page now";
  const start = value.indexOf("the page");
  const end = start + "the page".length;
  const result = applyInsertLinkToValue(value, start, end, "https://example.com");

  assert.equal(result.value, 'Read <a href="https://example.com">the page</a> now');
  assert.equal(
    result.value.slice(result.selectionStart, result.selectionEnd),
    "the page",
  );
});

test("applyInsertLinkToValue escapes ampersands in the stored href", () => {
  const result = applyInsertLinkToValue("x", 0, 1, "https://example.com/?a=1&b=2");
  assert.equal(result.value, '<a href="https://example.com/?a=1&amp;b=2">x</a>');
});

test("applyInsertLinkToValue replaces the href of an enclosing link instead of nesting", () => {
  const value = 'see <a href="https://old.example.com">linked text</a> here';
  const start = value.indexOf("linked");
  const end = start + "linked".length;
  const result = applyInsertLinkToValue(value, start, end, "https://new.example.com");

  assert.equal(result.value, 'see <a href="https://new.example.com">linked text</a> here');
  assert.equal(
    result.value.slice(result.selectionStart, result.selectionEnd),
    "linked",
  );
});

test("applyInsertLinkToValue returns null for invalid hrefs", () => {
  assert.equal(applyInsertLinkToValue("text", 0, 4, "not a url"), null);
});

test("submitEditorInsertLink inserts the link into a focused footnote field, not the main field", () => {
  class FakeTextarea {
    constructor(props) {
      Object.assign(this, { disabled: false, readOnly: false, ...props });
    }

    setSelectionRange() {}
  }

  const previous = {
    CSS: globalThis.CSS,
    document: globalThis.document,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
    editorChapter: state.editorChapter,
  };

  globalThis.CSS = { escape: (value) => String(value) };
  globalThis.HTMLTextAreaElement = FakeTextarea;

  const mainTextarea = new FakeTextarea({
    value: "Main body text",
    dataset: { rowId: "row-1", languageCode: "es" },
  });
  const footnoteTextarea = new FakeTextarea({
    value: "See note",
    dataset: {
      rowId: "row-1",
      languageCode: "es",
      contentKind: "footnote",
      footnoteMarker: "1",
    },
  });

  globalThis.document = {
    querySelector(selector) {
      return selector.includes('data-content-kind="footnote"') ? footnoteTextarea : mainTextarea;
    },
  };

  state.editorChapter = {
    chapterId: "chap-1",
    filters: {},
    insertLinkModal: {
      isOpen: true,
      mode: "url",
      rowId: "row-1",
      languageCode: "es",
      contentKind: "footnote",
      footnoteMarker: "1",
      selectionStart: 4,
      selectionEnd: 8,
      selectedText: "note",
      urlDraft: "example.com",
    },
  };

  const updateCalls = [];
  try {
    submitEditorInsertLink(() => {}, {
      updateEditorRowFieldValueForContentKind: (...args) => updateCalls.push(args),
      syncEditorRowTextareaHeight() {},
      syncEditorVirtualizationRowLayout() {},
      syncEditorGlossaryHighlightRowDom() {},
    });

    assert.equal(footnoteTextarea.value, 'See <a href="https://example.com">note</a>');
    assert.equal(mainTextarea.value, "Main body text");
    assert.equal(updateCalls.length, 1);
    assert.deepEqual(updateCalls[0].slice(0, 4), [
      "row-1",
      "es",
      'See <a href="https://example.com">note</a>',
      "footnote",
    ]);
    assert.deepEqual(updateCalls[0][4], { marker: "1" });
  } finally {
    globalThis.CSS = previous.CSS;
    globalThis.document = previous.document;
    globalThis.HTMLTextAreaElement = previous.HTMLTextAreaElement;
    state.editorChapter = previous.editorChapter;
  }
});
