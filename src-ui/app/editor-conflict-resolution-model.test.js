import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEditorFieldImage } from "./editor-images.js";

import {
  buildEditorConflictResolutionModalState,
  buildEditorConflictResolutionSaveState,
  buildEditorConflictResolutionVersionSelection,
  editorConflictResolutionShowsFootnotes,
  editorConflictResolutionShowsImages,
} from "./editor-conflict-resolution-model.js";

function buildImageConflictRow(overrides = {}) {
  return {
    rowId: "row-1",
    fields: { es: "Hola" },
    footnotes: {},
    imageCaptions: {},
    images: { es: { kind: "url", url: "https://example.com/local.png" } },
    conflictState: {
      remoteRow: {
        fields: { es: "Hola" },
        footnotes: {},
        imageCaptions: {},
        images: { es: { kind: "url", url: "https://example.com/remote.png" } },
      },
      remoteVersion: { authorName: "Octocat", committedAt: "2026-04-17T10:00:00Z" },
    },
    ...overrides,
  };
}

function buildConflictRow(overrides = {}) {
  return {
    rowId: "row-1",
    fields: {
      es: "Hola",
    },
    footnotes: {
      es: "Local note",
    },
    conflictState: {
      remoteRow: {
        fields: {
          es: "Hola",
        },
        footnotes: {
          es: "Remote note",
        },
      },
      remoteVersion: {
        authorName: "Octocat",
        committedAt: "2026-04-17T10:00:00Z",
      },
    },
    ...overrides,
  };
}

test("buildEditorConflictResolutionModalState includes footnotes and defaults the final footnote to GitHub", () => {
  const modal = buildEditorConflictResolutionModalState(buildConflictRow(), "es");

  assert.equal(modal.localText, "Hola");
  assert.equal(modal.remoteText, "Hola");
  assert.equal(modal.finalText, "Hola");
  assert.equal(modal.localFootnote, "Local note");
  assert.equal(modal.remoteFootnote, "Remote note");
  assert.equal(modal.finalFootnote, "Remote note");
});

test("buildEditorConflictResolutionSaveState persists the chosen final footnote", () => {
  const saveState = buildEditorConflictResolutionSaveState(
    buildConflictRow(),
    "es",
    {
      finalText: "Hola final",
      finalFootnote: "Chosen note",
    },
  );

  assert.equal(saveState.nextLocalFields.es, "Hola final");
  assert.equal(saveState.nextLocalFootnotes.es, "Chosen note");
  assert.equal(saveState.fieldsToPersist.es, "Hola final");
  assert.equal(saveState.footnotesToPersist.es, "Chosen note");
});

test("editorConflictResolutionShowsFootnotes stays true for footnote-only conflicts", () => {
  const modal = buildEditorConflictResolutionModalState(buildConflictRow(), "es");

  assert.equal(editorConflictResolutionShowsFootnotes(modal), true);
});

test("buildEditorConflictResolutionModalState includes image URLs and defaults to GitHub", () => {
  const modal = buildEditorConflictResolutionModalState(buildImageConflictRow(), "es");

  assert.equal(modal.localImageUrl, "https://example.com/local.png");
  assert.equal(modal.remoteImageUrl, "https://example.com/remote.png");
  assert.equal(modal.finalImageUrl, "https://example.com/remote.png");
  assert.equal(editorConflictResolutionShowsImages(modal), true);
});

test("buildEditorConflictResolutionSaveState persists the resolved image URL and base", () => {
  const row = buildImageConflictRow();
  const modal = buildEditorConflictResolutionModalState(row, "es");
  modal.finalImageUrl = "https://example.com/local.png";

  const saveState = buildEditorConflictResolutionSaveState(row, "es", modal);

  assert.deepEqual(saveState.imagesToPersist, {
    es: { kind: "url", url: "https://example.com/local.png" },
  });
  assert.deepEqual(saveState.baseImages, {
    es: { kind: "url", url: "https://example.com/remote.png", path: "" },
  });
});

test("image conflicts serialize normalized UI images for the Rust save command", () => {
  for (const image of [
    { kind: "url", url: "https://example.com/remote.png" },
    { kind: "upload", path: "images/photo.png" },
  ]) {
    const row = buildImageConflictRow();
    row.conflictState.remoteRow.images.es = normalizeEditorFieldImage(image);
    const modal = buildEditorConflictResolutionModalState(row, "es");
    modal.finalImageUrl = "https://example.com/resolved.png";
    const saveState = buildEditorConflictResolutionSaveState(row, "es", modal);

    // These are String properties in EditorFieldImageInput, including the unused one.
    assert.deepEqual(saveState.baseImages, {
      es: { kind: image.kind, url: image.url ?? "", path: image.path ?? "" },
    });
    assert.deepEqual(saveState.imagesToPersist, {
      es: { kind: "url", url: "https://example.com/resolved.png" },
    });
    assert.deepEqual(row.conflictState.remoteRow.images.es, normalizeEditorFieldImage(image));
  }
});

test("image conflict bases retain null when the remote image is absent", () => {
  const row = buildImageConflictRow();
  row.conflictState.remoteRow.images = {};
  const modal = buildEditorConflictResolutionModalState(row, "es");
  modal.finalImageUrl = "";
  const saveState = buildEditorConflictResolutionSaveState(row, "es", modal);
  assert.deepEqual(saveState.baseImages, { es: null });
  assert.deepEqual(saveState.imagesToPersist, { es: null });
});

test("buildEditorConflictResolutionSaveState omits images when no image conflict", () => {
  const modal = buildEditorConflictResolutionModalState(buildConflictRow(), "es");

  const saveState = buildEditorConflictResolutionSaveState(buildConflictRow(), "es", modal);

  assert.equal(saveState.imagesToPersist, null);
  assert.equal(saveState.baseImages, null);
});

test("buildEditorConflictResolutionSaveState clears the image when resolved to empty", () => {
  const row = buildImageConflictRow();
  const modal = buildEditorConflictResolutionModalState(row, "es");
  modal.finalImageUrl = "";

  const saveState = buildEditorConflictResolutionSaveState(row, "es", modal);

  assert.deepEqual(saveState.imagesToPersist, { es: null });
});

test("buildEditorConflictResolutionVersionSelection returns the chosen side's text and footnote", () => {
  const modal = buildEditorConflictResolutionModalState(buildConflictRow(), "es");

  assert.deepEqual(buildEditorConflictResolutionVersionSelection(modal, "remote"), {
    finalText: "Hola",
    finalFootnote: "Remote note",
    finalImageCaption: "",
    finalAttribution: "",
    finalImageUrl: "",
  });
  assert.deepEqual(buildEditorConflictResolutionVersionSelection(modal, "local"), {
    finalText: "Hola",
    finalFootnote: "Local note",
    finalImageCaption: "",
    finalAttribution: "",
    finalImageUrl: "",
  });
});
