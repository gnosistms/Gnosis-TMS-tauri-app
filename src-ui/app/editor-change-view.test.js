import test from "node:test";
import assert from "node:assert/strict";

import { buildEditorSectionChangeView } from "./editor-change-view.js";
import { mergeChangedAfterMyEditRows } from "./editor-changed-after-my-edit-flow.js";
import { renderTranslationContentRow } from "./editor-row-render.js";

globalThis.window ??= {};

function baselineRow(fields, textStyle = "paragraph") {
  return {
    rowId: "row-1",
    baselineTextStyle: textStyle,
    baselineFields: Object.fromEntries(Object.entries(fields).map(([code, field]) => [code, {
      plainText: "",
      footnote: "",
      imageCaption: "",
      image: null,
      imageDataUrl: null,
      ...field,
    }])),
  };
}

function section(overrides = {}) {
  return {
    code: "fa",
    name: "Persian",
    text: "",
    footnote: "",
    footnotes: [],
    imageCaption: "",
    image: null,
    hasVisibleFootnote: false,
    hasVisibleImage: false,
    hasVisibleImageCaption: false,
    isFootnoteEditorOpen: false,
    isImageCaptionEditorOpen: false,
    isImageUrlEditorOpen: false,
    isImageUploadEditorOpen: false,
    isImageUrlSubmitting: false,
    showInvalidImageUrl: false,
    showAddFootnoteButton: true,
    showAddImageButtons: false,
    showAddImageCaptionButton: false,
    isTextEditorOpen: false,
    canEdit: true,
    markerSaveState: { status: "idle", languageCode: null, kind: null, error: "" },
    ...overrides,
  };
}

function renderRow(sectionValue, textStyle = "paragraph") {
  return renderTranslationContentRow({
    kind: "row",
    id: "row-1",
    rowId: "row-1",
    lifecycleState: "active",
    textStyle,
    canEdit: true,
    hasConflict: false,
    sections: [sectionValue],
  });
}

test("unchanged row has no change view", () => {
  const view = buildEditorSectionChangeView({
    baselineRow: baselineRow({ fa: { plainText: "کتاب" } }),
    section: section({ text: "کتاب" }),
    textStyle: "paragraph",
  });
  assert.equal(view, null);
});

test("changed text shows green and red runs, fenced against letter joining", () => {
  const current = section({ text: "من مقاله را خواندم" });
  const changeView = buildEditorSectionChangeView({
    baselineRow: baselineRow({ fa: { plainText: "من کتاب را خواندم" } }),
    section: current,
    textStyle: "paragraph",
  });
  const html = renderRow({ ...current, changeView });
  assert.match(html, /‌<span class="history-diff__delete">کتاب<\/span>‌/);
  assert.match(html, /‌<span class="history-diff__insert">مقاله<\/span>‌/);
});

test("formatting-only change is marked with its old formatting in a tooltip", () => {
  const current = section({ code: "es", text: "El <strong>gato</strong>" });
  const changeView = buildEditorSectionChangeView({
    baselineRow: baselineRow({ es: { plainText: "El gato" } }),
    section: current,
    textStyle: "paragraph",
  });
  const html = renderRow({ ...current, changeView });
  assert.match(html, /<strong><span class="history-diff__format"[^>]*was: no formatting[^>]*>gato<\/span><\/strong>/);
});

test("added footnote is green; deleted footnote keeps its box in red", () => {
  const current = section({
    code: "es",
    text: "uno [2]",
    footnote: "[2] nueva nota",
    footnotes: [{ marker: 2, text: "nueva nota" }],
    hasVisibleFootnote: true,
  });
  const changeView = buildEditorSectionChangeView({
    baselineRow: baselineRow({ es: { plainText: "uno [1]", footnote: "[1] nota vieja" } }),
    section: current,
    textStyle: "paragraph",
  });
  assert.deepEqual(changeView.footnotes.map((entry) => [entry.marker, entry.change]), [[1, "delete"], [2, "insert"]]);
  const html = renderRow({ ...current, changeView });
  assert.match(html, /history-diff__insert">nueva nota/);
  assert.match(html, /footnote-editor-row--deleted[\s\S]*\[1\][\s\S]*history-diff__delete">nota vieja/);
});

test("replaced image: new one outlined green, old one shown with a red X", () => {
  const current = section({
    code: "es",
    image: { kind: "url", url: "https://example.com/new.png" },
    hasVisibleImage: true,
  });
  const changeView = buildEditorSectionChangeView({
    baselineRow: baselineRow({ es: { image: { kind: "url", url: "https://example.com/old.png" } } }),
    section: current,
    textStyle: "paragraph",
  });
  const html = renderRow({ ...current, changeView });
  assert.match(html, /image-preview--change-previous[\s\S]*old\.png[\s\S]*image-change-x/);
  assert.match(html, /image-preview--change-insert/);
});

test("removed image is still shown, crossed out, with its caption struck through", () => {
  const current = section({ code: "es" });
  const changeView = buildEditorSectionChangeView({
    baselineRow: baselineRow({ es: {
      image: { kind: "upload", path: "images/a.png", fileName: "a.png" },
      imageDataUrl: "data:image/png;base64,AAAA",
      imageCaption: "pie de foto",
    } }),
    section: current,
    textStyle: "paragraph",
  });
  const html = renderRow({ ...current, changeView });
  assert.match(html, /src="data:image\/png;base64,AAAA"/);
  assert.match(html, /image-change-x/);
  assert.match(html, /history-diff__delete">pie de foto/);
});

test("text style change colours the new style green and the old one red", () => {
  const current = section({ code: "es", text: "Título" });
  const changeView = buildEditorSectionChangeView({
    baselineRow: baselineRow({ es: { plainText: "Título" } }, "paragraph"),
    section: current,
    textStyle: "heading1",
  });
  assert.deepEqual(changeView.textStyle, { previous: "paragraph", current: "heading1" });
  const html = renderRow({ ...current, changeView }, "heading1");
  assert.match(html, /translation-language-panel__editor--style-changed/);
  assert.match(html, /change-insert"[^>]*data-text-style="heading1"/);
  assert.match(html, /change-delete"[^>]*data-text-style="paragraph"/);
});

test("refresh after sync adds rows and keeps the ones already shown", () => {
  const first = mergeChangedAfterMyEditRows(null, [{ rowId: "a", baselineTextStyle: "paragraph" }], "ch");
  const refreshed = mergeChangedAfterMyEditRows(first, [
    { rowId: "a", baselineTextStyle: "heading1" },
    { rowId: "b", baselineTextStyle: "paragraph" },
  ], "ch");
  assert.deepEqual([...refreshed.rowIds], ["a", "b"]);
  // A row on screen keeps the baseline it was first shown with.
  assert.equal(refreshed.rowsById.get("a").baselineTextStyle, "paragraph");
  const afterMyEdit = mergeChangedAfterMyEditRows(refreshed, [], "ch");
  assert.deepEqual([...afterMyEdit.rowIds], ["a", "b"]);
});
