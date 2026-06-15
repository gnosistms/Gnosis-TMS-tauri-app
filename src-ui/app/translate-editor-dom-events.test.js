import test from "node:test";
import assert from "node:assert/strict";

import { activeElementKeepsEditorControlOpen } from "./translate-editor-dom-events.js";

function fakeElement(closestMatches = {}) {
  return {
    closest(selector) {
      return closestMatches[selector] ?? null;
    },
  };
}

test("activeElementKeepsEditorControlOpen accepts the active row language cluster", () => {
  const cluster = { dataset: { rowId: "row-1", languageCode: "es" } };
  const doc = {
    activeElement: fakeElement({
      "[data-editor-language-cluster]": cluster,
    }),
  };

  assert.equal(activeElementKeepsEditorControlOpen("row-1", "es", doc, null), true);
});

test("activeElementKeepsEditorControlOpen accepts the active insert-link modal input", () => {
  const doc = {
    activeElement: fakeElement({
      "[data-editor-insert-link-url-input]": {},
    }),
  };
  const chapterState = {
    insertLinkModal: {
      isOpen: true,
      mode: "url",
      rowId: "row-1",
      languageCode: "es",
    },
  };

  assert.equal(activeElementKeepsEditorControlOpen("row-1", "es", doc, chapterState), true);
});

test("activeElementKeepsEditorControlOpen rejects unrelated insert-link modal input", () => {
  const doc = {
    activeElement: fakeElement({
      "[data-editor-insert-link-url-input]": {},
    }),
  };

  assert.equal(
    activeElementKeepsEditorControlOpen("row-1", "es", doc, {
      insertLinkModal: {
        isOpen: true,
        mode: "url",
        rowId: "row-2",
        languageCode: "es",
      },
    }),
    false,
  );
  assert.equal(
    activeElementKeepsEditorControlOpen("row-1", "es", doc, {
      insertLinkModal: {
        isOpen: false,
        mode: "url",
        rowId: "row-1",
        languageCode: "es",
      },
    }),
    false,
  );
});
