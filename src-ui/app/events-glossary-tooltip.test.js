import test from "node:test";
import assert from "node:assert/strict";

class FakeElement {}
class FakeHtmlElement extends FakeElement {
  constructor({ payload, textEnd = "9", displayField = null, displayText = null, isConnected = true } = {}) {
    super();
    this.dataset = {
      editorGlossaryTooltipPayload: JSON.stringify(payload ?? {}),
      textEnd,
    };
    this.displayField = displayField;
    this.displayText = displayText;
    this.isConnected = isConnected;
  }

  closest(selector) {
    if (selector.includes("data-editor-display-field")) {
      return this.displayField;
    }
    return selector.includes("data-editor-display-text") ? this.displayText : null;
  }
}

globalThis.Element = FakeElement;
globalThis.HTMLElement = FakeHtmlElement;

const {
  glossaryFootnoteInsertionRequestForMark,
  glossaryFootnotePopoverPayloadForMark,
  glossaryPopoverContextForMark,
  glossaryTranslationCopyTextForMark,
} = await import("./events/glossary-tooltip.js");

function displayField() {
  const field = new FakeHtmlElement();
  field.dataset = { rowId: "row-1", languageCode: "vi" };
  return field;
}

test("footnote popover request accepts a footnoted target term in a closed editor", () => {
  const mark = new FakeHtmlElement({
    payload: { kind: "target", title: "Kabbalah", footnotes: ["Glossary note"] },
    textEnd: "14",
    displayField: displayField(),
    displayText: new FakeHtmlElement(),
  });

  assert.deepEqual(glossaryFootnoteInsertionRequestForMark(mark), {
    rowId: "row-1",
    languageCode: "vi",
    visibleInsertIndex: 14,
    footnoteText: "Glossary note",
  });
});

test("footnote popover request rejects source terms, unfootnoted terms, and open editors", () => {
  const closedField = displayField();
  const sourceMark = new FakeHtmlElement({
    payload: { kind: "source", footnotes: ["Glossary note"] },
    displayField: closedField,
    displayText: new FakeHtmlElement(),
  });
  const unfootnotedTarget = new FakeHtmlElement({
    payload: { kind: "target", footnotes: [] },
    displayField: closedField,
    displayText: new FakeHtmlElement(),
  });
  const openEditorTarget = new FakeHtmlElement({
    payload: { kind: "target", footnotes: ["Glossary note"] },
    displayField: null,
  });

  assert.equal(glossaryFootnoteInsertionRequestForMark(sourceMark), null);
  assert.equal(glossaryFootnoteInsertionRequestForMark(unfootnotedTarget), null);
  assert.equal(glossaryFootnoteInsertionRequestForMark(openEditorTarget), null);
});

test("source terms show glossary footnotes without enabling footnote insertion", () => {
  const sourceMark = new FakeHtmlElement({
    payload: {
      kind: "source",
      title: "Kabbalists",
      variants: ["Kabbalah scholars"],
      footnotes: ["Target footnote"],
    },
    displayField: displayField(),
    displayText: new FakeHtmlElement(),
  });

  assert.deepEqual(glossaryPopoverContextForMark(sourceMark), {
    kind: "glossary",
    payload: {
      kind: "source",
      title: "Kabbalists",
      variants: [{ text: "Kabbalah scholars", note: "" }],
      noTranslation: null,
      targetVariantNote: "",
      translatorNotes: [],
      footnotes: ["Target footnote"],
      originTerms: [],
    },
  });
  assert.equal(glossaryFootnotePopoverPayloadForMark(sourceMark), null);
  assert.equal(glossaryFootnoteInsertionRequestForMark(sourceMark), null);
});

test("unfootnoted target terms retain the ordinary glossary popover in a closed editor", () => {
  const mark = new FakeHtmlElement({
    payload: {
      kind: "target",
      title: "Li-lit",
      variants: ["Lilith"],
      translatorNotes: ["Translator guidance"],
      footnotes: [],
    },
    displayText: new FakeHtmlElement(),
  });

  assert.deepEqual(glossaryPopoverContextForMark(mark), {
    kind: "glossary",
    payload: {
      kind: "target",
      title: "Li-lit",
      variants: [{ text: "Lilith", note: "" }],
      noTranslation: null,
      targetVariantNote: "",
      translatorNotes: ["Translator guidance"],
      footnotes: [],
      originTerms: [],
    },
  });
  assert.equal(glossaryFootnoteInsertionRequestForMark(mark), null);
});

test("target glossary popovers remain hidden while their editor is open", () => {
  const mark = new FakeHtmlElement({
    payload: { kind: "target", title: "Li-lit", footnotes: [] },
    displayText: null,
  });

  assert.equal(glossaryPopoverContextForMark(mark), null);
});

test("closed read-only target terms keep the popover but not the insertion action", () => {
  const mark = new FakeHtmlElement({
    payload: { kind: "target", footnotes: ["Glossary note"] },
    displayField: null,
    displayText: new FakeHtmlElement(),
  });

  assert.deepEqual(glossaryFootnotePopoverPayloadForMark(mark)?.footnotes, ["Glossary note"]);
  assert.equal(glossaryFootnoteInsertionRequestForMark(mark), null);
});

test("target terms with multiple distinct footnotes keep the popover but disable insertion", () => {
  const mark = new FakeHtmlElement({
    payload: { kind: "target", footnotes: ["First note", "Second note"] },
    displayField: displayField(),
    displayText: new FakeHtmlElement(),
  });

  assert.deepEqual(
    glossaryFootnotePopoverPayloadForMark(mark)?.footnotes,
    ["First note", "Second note"],
  );
  assert.equal(glossaryFootnoteInsertionRequestForMark(mark), null);
});

test("a source term with exactly one translation offers it for copying", () => {
  const mark = (payload, options = {}) => new FakeHtmlElement({
    payload,
    displayText: new FakeHtmlElement(),
    ...options,
  });

  assert.equal(
    glossaryTranslationCopyTextForMark(mark({
      kind: "source",
      title: "the inner chamber of the heart",
      variants: [{ text: "căn phòng bên trong của trái tim", note: "formal" }],
    })),
    "căn phòng bên trong của trái tim",
  );
  // Stored ruby markup is copied as is, so the pasted text passes the
  // glossary's exact ruby check.
  assert.equal(
    glossaryTranslationCopyTextForMark(mark({
      kind: "source",
      variants: ["<ruby>漢字<rt>かんじ</rt></ruby>"],
    })),
    "<ruby>漢字<rt>かんじ</rt></ruby>",
  );

  for (const payload of [
    { kind: "source", variants: ["first", "second"] },
    { kind: "source", variants: [] },
    { kind: "source", variants: [{ text: "", note: "note only" }] },
    { kind: "source", variants: ["only"], noTranslation: { position: "", note: "leave out" } },
    { kind: "target", title: "only", variants: ["source"], footnotes: [] },
  ]) {
    assert.equal(glossaryTranslationCopyTextForMark(mark(payload)), null, JSON.stringify(payload));
  }
  assert.equal(
    glossaryTranslationCopyTextForMark(mark({ kind: "source", variants: ["only"] }, { isConnected: false })),
    null,
  );
});
