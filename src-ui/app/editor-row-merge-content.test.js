import test from "node:test";
import assert from "node:assert/strict";

import {
  maxEditorFootnoteMarker,
  mergeEditorRowContent,
  shiftEditorFootnoteMarkers,
} from "./editor-row-merge-content.js";

function row(overrides = {}) {
  return {
    rowId: "row-1",
    lifecycleState: "active",
    fields: {},
    footnotes: {},
    imageCaptions: {},
    images: {},
    ...overrides,
  };
}

test("maxEditorFootnoteMarker covers body text markers and footnote entries", () => {
  assert.equal(maxEditorFootnoteMarker("", []), 0);
  assert.equal(maxEditorFootnoteMarker("see [3]", [{ marker: 1, text: "one" }]), 3);
  assert.equal(maxEditorFootnoteMarker("see [2]", [{ marker: 5, text: "five" }]), 5);
});

test("shiftEditorFootnoteMarkers shifts only unescaped markers", () => {
  assert.equal(shiftEditorFootnoteMarkers("see [1] and \\[2] and [3]", 2), "see [3] and \\[2] and [5]");
  assert.equal(shiftEditorFootnoteMarkers("double escape \\\\[1]", 2), "double escape \\\\[3]");
  assert.equal(shiftEditorFootnoteMarkers("no markers", 2), "no markers");
  assert.equal(shiftEditorFootnoteMarkers("[1]", 0), "[1]");
});

test("mergeEditorRowContent joins body text with a newline per language", () => {
  const merged = mergeEditorRowContent(
    row({ fields: { es: "primero", vi: "một" } }),
    row({ rowId: "row-2", fields: { es: "segundo", vi: "hai" } }),
  );

  assert.equal(merged.fields.es, "primero\nsegundo");
  assert.equal(merged.fields.vi, "một\nhai");
});

test("mergeEditorRowContent skips the newline when one side is blank", () => {
  const merged = mergeEditorRowContent(
    row({ fields: { es: "" } }),
    row({ rowId: "row-2", fields: { es: "segundo" } }),
  );

  assert.equal(merged.fields.es, "segundo");
});

test("mergeEditorRowContent renumbers the next row's footnotes past the previous row's markers", () => {
  const merged = mergeEditorRowContent(
    row({
      fields: { es: "first[1] more[2]" },
      footnotes: { es: [{ marker: 1, text: "one" }, { marker: 2, text: "two" }] },
    }),
    row({
      rowId: "row-2",
      fields: { es: "second[1]" },
      footnotes: { es: [{ marker: 1, text: "uno" }] },
    }),
  );

  assert.equal(merged.fields.es, "first[1] more[2]\nsecond[3]");
  assert.deepEqual(merged.footnotes.es, [
    { marker: 1, text: "one" },
    { marker: 2, text: "two" },
    { marker: 3, text: "uno" },
  ]);
});

test("mergeEditorRowContent takes the next row's image and caption when only it has one", () => {
  const merged = mergeEditorRowContent(
    row({ fields: { es: "first" }, imageCaptions: { es: "orphan previous caption" } }),
    row({
      rowId: "row-2",
      fields: { es: "second" },
      images: { es: { kind: "url", url: "https://example.com/next.png" } },
      imageCaptions: { es: "next caption" },
    }),
  );

  assert.equal(merged.images.es.url, "https://example.com/next.png");
  assert.equal(merged.imageCaptions.es, "next caption");
  assert.deepEqual(merged.movedImageLanguages, ["es"]);
});

test("mergeEditorRowContent leaves images and captions alone when both rows have one", () => {
  const merged = mergeEditorRowContent(
    row({
      fields: { es: "first" },
      images: { es: { kind: "url", url: "https://example.com/previous.png" } },
      imageCaptions: { es: "previous caption" },
    }),
    row({
      rowId: "row-2",
      fields: { es: "second" },
      images: { es: { kind: "url", url: "https://example.com/next.png" } },
      imageCaptions: { es: "next caption" },
    }),
  );

  assert.equal(merged.fields.es, "first\nsecond");
  assert.equal(merged.images.es.url, "https://example.com/previous.png");
  assert.equal(merged.imageCaptions.es, "previous caption");
  assert.deepEqual(merged.movedImageLanguages, []);
});

test("mergeEditorRowContent keeps the previous row's image when the next row has none", () => {
  const merged = mergeEditorRowContent(
    row({
      fields: { es: "first" },
      images: { es: { kind: "url", url: "https://example.com/previous.png" } },
      imageCaptions: { es: "previous caption" },
    }),
    row({
      rowId: "row-2",
      fields: { es: "second" },
      imageCaptions: { es: "orphan next caption" },
    }),
  );

  assert.equal(merged.images.es.url, "https://example.com/previous.png");
  assert.equal(merged.imageCaptions.es, "previous caption");
  assert.deepEqual(merged.movedImageLanguages, []);
});

test("mergeEditorRowContent merges languages that exist on only one row", () => {
  const merged = mergeEditorRowContent(
    row({ fields: { es: "primero" } }),
    row({ rowId: "row-2", fields: { fr: "deuxième" } }),
  );

  assert.equal(merged.fields.es, "primero");
  assert.equal(merged.fields.fr, "deuxième");
});
