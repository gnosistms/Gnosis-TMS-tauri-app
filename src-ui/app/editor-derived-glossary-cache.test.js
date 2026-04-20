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
  loadStoredEditorDerivedGlossariesForChapter,
  removeStoredEditorDerivedGlossaryEntryForChapter,
  saveStoredEditorDerivedGlossaryEntryForChapter,
} = await import("./editor-derived-glossary-cache.js");

const DERIVED_GLOSSARY_STORAGE_KEY = "gnosis-tms-editor-derived-glossaries:tester";
const ACTIVE_STORAGE_LOGIN_KEY = "gnosis-tms-active-storage-login";

const fixtureTeam = {
  installationId: 42,
};

test.afterEach(() => {
  clearActiveStorageLogin();
  removePersistentValue(DERIVED_GLOSSARY_STORAGE_KEY);
  removePersistentValue(ACTIVE_STORAGE_LOGIN_KEY);
  localStorageState.clear();
});

test("stored editor derived glossaries round-trip per chapter locally", () => {
  setActiveStorageLogin("tester");

  saveStoredEditorDerivedGlossaryEntryForChapter(
    fixtureTeam,
    "project-1",
    "chapter-1",
    "row-1",
    {
      status: "ready",
      error: "",
      requestKey: "req-1",
      translationSourceLanguageCode: "en",
      glossarySourceLanguageCode: "es",
      targetLanguageCode: "vi",
      translationSourceText: "The inner chamber glows.",
      glossarySourceText: "La camara interior brilla.",
      glossarySourceTextOrigin: "generated",
      glossaryRevisionKey: "rev-1",
      entries: [{
        sourceTerm: "inner chamber",
        glossarySourceTerm: "camara interior",
        targetVariants: ["buong noi tam"],
        notes: ["Dung thuat ngu cua glossary"],
      }],
      matcherModel: {
        ignored: true,
      },
    },
  );

  assert.deepEqual(
    loadStoredEditorDerivedGlossariesForChapter(fixtureTeam, "project-1", "chapter-1"),
    {
      "row-1": {
        status: "ready",
        error: "",
        requestKey: "req-1",
        translationSourceLanguageCode: "en",
        glossarySourceLanguageCode: "es",
        targetLanguageCode: "vi",
        translationSourceText: "The inner chamber glows.",
        glossarySourceText: "La camara interior brilla.",
        glossarySourceTextOrigin: "generated",
        glossaryRevisionKey: "rev-1",
        entries: [{
          sourceTerm: "inner chamber",
          glossarySourceTerm: "camara interior",
          targetVariants: ["buong noi tam"],
          notes: ["Dung thuat ngu cua glossary"],
        }],
      },
    },
  );
});

test("stored editor derived glossaries remove a row entry cleanly", () => {
  setActiveStorageLogin("tester");

  saveStoredEditorDerivedGlossaryEntryForChapter(
    fixtureTeam,
    "project-1",
    "chapter-1",
    "row-1",
    {
      status: "ready",
      requestKey: "req-1",
      translationSourceLanguageCode: "en",
      glossarySourceLanguageCode: "es",
      targetLanguageCode: "vi",
      translationSourceText: "The inner chamber glows.",
      glossarySourceText: "La camara interior brilla.",
      glossarySourceTextOrigin: "generated",
      glossaryRevisionKey: "rev-1",
      entries: [],
      matcherModel: null,
    },
  );

  removeStoredEditorDerivedGlossaryEntryForChapter(
    fixtureTeam,
    "project-1",
    "chapter-1",
    "row-1",
  );

  assert.deepEqual(
    loadStoredEditorDerivedGlossariesForChapter(fixtureTeam, "project-1", "chapter-1"),
    {},
  );
});
