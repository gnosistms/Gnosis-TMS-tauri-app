import test from "node:test";
import assert from "node:assert/strict";

const localStorageState = new Map();

const fakeLocalStorage = {
  getItem(key) {
    return localStorageState.has(key) ? localStorageState.get(key) : null;
  },
  setItem(key, value) {
    localStorageState.set(key, String(value));
  },
  removeItem(key) {
    localStorageState.delete(key);
  },
  clear() {
    localStorageState.clear();
  },
  key(index) {
    return [...localStorageState.keys()][index] ?? null;
  },
  get length() {
    return localStorageState.size;
  },
};

globalThis.window = {
  localStorage: fakeLocalStorage,
};

const { removePersistentValue } = await import("./persistent-store.js");
const {
  clearActiveStorageLogin,
  setActiveStorageLogin,
} = await import("./team-storage.js");
const {
  loadStoredEditorAssistantChapterData,
  saveStoredEditorAssistantChapterData,
} = await import("./editor-ai-assistant-cache.js");

const ASSISTANT_STORAGE_KEY = "gnosis-tms-editor-ai-assistant:tester";
const ACTIVE_STORAGE_LOGIN_KEY = "gnosis-tms-active-storage-login";

const fixtureTeam = {
  installationId: 42,
};

test.afterEach(() => {
  clearActiveStorageLogin();
  removePersistentValue(ASSISTANT_STORAGE_KEY);
  removePersistentValue(ACTIVE_STORAGE_LOGIN_KEY);
  localStorageState.clear();
});

test("stored assistant chapter data round-trips per team/project/chapter", () => {
  setActiveStorageLogin("tester");

  saveStoredEditorAssistantChapterData(
    fixtureTeam,
    "project-1",
    "chapter-1",
    {
      threadsByKey: {
        "row-1::vi": {
          rowId: "row-1",
          targetLanguageCode: "vi",
          items: [{
            id: "item-1",
            type: "user-message",
            createdAt: "2026-04-21T12:00:00.000Z",
            text: "Explain this line.",
            summary: "Explain this line.",
            sourceLanguageCode: "es",
            targetLanguageCode: "vi",
          }],
          providerContinuityByModelKey: {
            "openai::gpt-5.4": {
              providerResponseId: "resp_1",
            },
          },
          lastTouchedAt: "2026-04-21T12:01:00.000Z",
        },
      },
      chapterArtifacts: {
        documentDigestsBySourceLanguage: {
          es: {
            sourceLanguageCode: "es",
            summary: "Document summary",
            revisionKey: "rev-1",
            createdAt: "2026-04-21T12:02:00.000Z",
          },
        },
      },
    },
  );

  assert.deepEqual(
    loadStoredEditorAssistantChapterData(fixtureTeam, "project-1", "chapter-1"),
    {
      threadsByKey: {
        "row-1::vi": {
          rowId: "row-1",
          targetLanguageCode: "vi",
          items: [{
            id: "item-1",
            type: "user-message",
            createdAt: "2026-04-21T12:00:00.000Z",
            text: "Explain this line.",
            summary: "Explain this line.",
            sourceLanguageCode: "es",
            targetLanguageCode: "vi",
            promptText: "",
            draftTranslationText: "",
            applyStatus: "idle",
            applyError: "",
            appliedAt: null,
            details: {},
          }],
          providerContinuityByModelKey: {
            "openai::gpt-5.4": {
              providerResponseId: "resp_1",
            },
          },
          lastTouchedAt: "2026-04-21T12:01:00.000Z",
        },
      },
      chapterArtifacts: {
        documentDigestsBySourceLanguage: {
          es: {
            sourceLanguageCode: "es",
            summary: "Document summary",
            revisionKey: "rev-1",
            createdAt: "2026-04-21T12:02:00.000Z",
          },
        },
      },
    },
  );
});
