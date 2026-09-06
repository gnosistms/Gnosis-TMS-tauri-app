import test from "node:test";
import assert from "node:assert/strict";

globalThis.document = {
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  },
};
globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async () => null,
    },
    event: {
      listen: async () => () => {},
    },
  },
  setTimeout() {
    return 1;
  },
  clearTimeout() {},
};

const { editorPersistenceTestApi } = await import("./editor-persistence-flow.js");
const { normalizeEditorRowForPersist } = editorPersistenceTestApi;

test("save-time smart quotes touch only the columns that changed since the last persist", () => {
  const row = {
    rowId: "row-1",
    fields: { en: "It's here", es: "It's aqui", vi: "" },
    persistedFields: { en: "It's here", es: "", vi: "" },
    footnotes: {},
    persistedFootnotes: {},
    imageCaptions: { en: 'Say "hi"', es: "" },
    persistedImageCaptions: { en: 'Say "hi"', es: "" },
  };

  const normalized = normalizeEditorRowForPersist(row);

  // The es column is what this save is about: smartened.
  assert.equal(normalized.fields.es, "It\u2019s aqui");
  // The untouched en column keeps its straight quotes, in the field and the caption.
  assert.equal(normalized.fields.en, "It's here");
  assert.equal(normalized.imageCaptions.en, 'Say "hi"');
});

test("save-time smart quotes cover every column of a row without persisted tracking", () => {
  const row = {
    rowId: "row-1",
    fields: { en: "It's here", es: "It's aqui" },
    footnotes: {},
    imageCaptions: {},
  };

  const normalized = normalizeEditorRowForPersist(row);

  assert.equal(normalized.fields.en, "It\u2019s here");
  assert.equal(normalized.fields.es, "It\u2019s aqui");
});
