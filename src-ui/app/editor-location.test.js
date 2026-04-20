import test from "node:test";
import assert from "node:assert/strict";

import {
  pendingTranslateAnchorRowId,
  queueTranslateRowAnchor,
} from "./scroll-state.js";
import { saveStoredEditorLocation } from "./editor-preferences.js";
import { setActiveStorageLogin } from "./team-storage.js";
import {
  queuePendingEditorLocationRestore,
  skipNextEditorLocationRestore,
} from "./editor-location.js";

function readyTranslateState(chapterId) {
  return {
    screen: "translate",
    editorChapter: {
      status: "ready",
      chapterId,
      mode: "translate",
      rows: [{ rowId: "row-1" }],
    },
  };
}

test("queuePendingEditorLocationRestore queues the saved row when restore is enabled", () => {
  const login = "editor-location-restore";
  const chapterId = "chapter-restore";
  setActiveStorageLogin(login);
  queueTranslateRowAnchor(null);
  saveStoredEditorLocation(chapterId, {
    rowId: "row-saved",
    languageCode: "en",
    offsetTop: 12,
  }, login);

  queuePendingEditorLocationRestore(readyTranslateState(chapterId));

  assert.equal(pendingTranslateAnchorRowId(), "row-saved");

  queueTranslateRowAnchor(null);
  setActiveStorageLogin(null);
});

test("queuePendingEditorLocationRestore ignores preview mode", () => {
  const login = "editor-location-preview";
  const chapterId = "chapter-preview";
  setActiveStorageLogin(login);
  queueTranslateRowAnchor(null);
  saveStoredEditorLocation(chapterId, {
    rowId: "row-saved",
    languageCode: "en",
    offsetTop: 12,
  }, login);

  queuePendingEditorLocationRestore({
    screen: "translate",
    editorChapter: {
      status: "ready",
      chapterId,
      mode: "preview",
      rows: [{ rowId: "row-1" }],
    },
  });

  assert.equal(pendingTranslateAnchorRowId(), "");

  queueTranslateRowAnchor(null);
  setActiveStorageLogin(null);
});

test("skipNextEditorLocationRestore bypasses the saved row restore for that chapter", () => {
  const login = "editor-location-skip";
  const chapterId = "chapter-skip";
  setActiveStorageLogin(login);
  queueTranslateRowAnchor(null);
  saveStoredEditorLocation(chapterId, {
    rowId: "row-saved",
    languageCode: "en",
    offsetTop: 12,
  }, login);

  skipNextEditorLocationRestore(chapterId);
  queuePendingEditorLocationRestore(readyTranslateState(chapterId));

  assert.equal(pendingTranslateAnchorRowId(), "");

  queueTranslateRowAnchor(null);
  setActiveStorageLogin(null);
});
