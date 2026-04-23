import test from "node:test";
import assert from "node:assert/strict";

import { mergeDirtyEditorRowWithRemote, mergeEditorRowVersions } from "./editor-row-merge.js";

function rowFixture(overrides = {}) {
  return {
    rowId: "row-1",
    fields: { es: "hola", en: "hello" },
    footnotes: { es: "", en: "" },
    imageCaptions: { es: "", en: "" },
    images: {},
    baseFields: { es: "hola", en: "hello" },
    baseFootnotes: { es: "", en: "" },
    baseImageCaptions: { es: "", en: "" },
    baseImages: {},
    fieldStates: {
      es: { reviewed: false, pleaseCheck: false },
      en: { reviewed: false, pleaseCheck: false },
    },
    persistedFieldStates: {
      es: { reviewed: false, pleaseCheck: false },
      en: { reviewed: false, pleaseCheck: false },
    },
    ...overrides,
  };
}

function remoteRowFixture(overrides = {}) {
  return {
    rowId: "row-1",
    orderKey: "00001",
    lifecycleState: "active",
    fields: { es: "hola", en: "hello" },
    footnotes: { es: "", en: "" },
    imageCaptions: { es: "", en: "" },
    images: {},
    fieldStates: {
      es: { reviewed: false, pleaseCheck: false },
      en: { reviewed: false, pleaseCheck: false },
    },
    ...overrides,
  };
}

test("mergeDirtyEditorRowWithRemote auto-merges disjoint language text changes", () => {
  const result = mergeDirtyEditorRowWithRemote(
    rowFixture({
      fields: { es: "hola", en: "hello local" },
    }),
    remoteRowFixture({
      fields: { es: "hola remoto", en: "hello" },
    }),
  );

  assert.equal(result.status, "merged");
  assert.deepEqual(result.mergedFields, {
    es: "hola remoto",
    en: "hello local",
  });
});

test("mergeDirtyEditorRowWithRemote promotes same-language text overlaps to conflict", () => {
  const result = mergeDirtyEditorRowWithRemote(
    rowFixture({
      fields: { es: "hola local", en: "hello" },
    }),
    remoteRowFixture({
      fields: { es: "hola remoto", en: "hello" },
    }),
  );

  assert.equal(result.status, "conflict");
  assert.deepEqual(result.conflicts, [{ languageCode: "es", contentKind: "field" }]);
});

test("mergeEditorRowVersions resolves simultaneous marker edits to the safer state", () => {
  const result = mergeEditorRowVersions({
    baseFields: { es: "hola", en: "hello" },
    baseFootnotes: { es: "", en: "" },
    baseImageCaptions: { es: "", en: "" },
    baseImages: {},
    baseFieldStates: {
      es: { reviewed: false, pleaseCheck: false },
      en: { reviewed: false, pleaseCheck: false },
    },
    localFields: { es: "hola", en: "hello local" },
    localFootnotes: { es: "", en: "" },
    localImageCaptions: { es: "", en: "" },
    localImages: {},
    localFieldStates: {
      es: { reviewed: false, pleaseCheck: true },
      en: { reviewed: false, pleaseCheck: false },
    },
    remoteRow: remoteRowFixture({
      fields: { es: "hola remoto", en: "hello" },
      fieldStates: {
        es: { reviewed: true, pleaseCheck: false },
        en: { reviewed: false, pleaseCheck: false },
      },
    }),
  });

  assert.equal(result.status, "merged");
  assert.deepEqual(result.mergedFieldStates.es, {
    reviewed: false,
    pleaseCheck: true,
  });
  assert.deepEqual(result.mergedFields, {
    es: "hola remoto",
    en: "hello local",
  });
});

test("mergeEditorRowVersions keeps a remote-only reviewed marker change when local markers are untouched", () => {
  const result = mergeEditorRowVersions({
    baseFields: { es: "hola", en: "hello" },
    baseFootnotes: { es: "", en: "" },
    baseImageCaptions: { es: "", en: "" },
    baseImages: {},
    baseFieldStates: {
      es: { reviewed: false, pleaseCheck: false },
      en: { reviewed: false, pleaseCheck: false },
    },
    localFields: { es: "hola", en: "hello local" },
    localFootnotes: { es: "", en: "" },
    localImageCaptions: { es: "", en: "" },
    localImages: {},
    localFieldStates: {
      es: { reviewed: false, pleaseCheck: false },
      en: { reviewed: false, pleaseCheck: false },
    },
    remoteRow: remoteRowFixture({
      fields: { es: "hola remoto", en: "hello" },
      fieldStates: {
        es: { reviewed: true, pleaseCheck: false },
        en: { reviewed: false, pleaseCheck: false },
      },
    }),
  });

  assert.equal(result.status, "merged");
  assert.deepEqual(result.mergedFieldStates.es, {
    reviewed: true,
    pleaseCheck: false,
  });
});

test("mergeDirtyEditorRowWithRemote keeps overlapping image changes conservative", () => {
  const result = mergeDirtyEditorRowWithRemote(
    rowFixture({
      baseImages: { en: { kind: "url", url: "https://example.com/base.png" } },
      images: { en: { kind: "url", url: "https://example.com/local.png" } },
    }),
    remoteRowFixture({
      images: { en: { kind: "url", url: "https://example.com/remote.png" } },
    }),
  );

  assert.equal(result.status, "unsupported");
});
