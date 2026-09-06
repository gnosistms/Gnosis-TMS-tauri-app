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
  saveStoredEditorDerivedGlossaryEntriesForChapter,
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
          targetVariants: [{ text: "buong noi tam" }],
          noTranslation: null,
          notes: ["Dung thuat ngu cua glossary"],
          globalNotes: [],
          footnotes: [],
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

test("stored editor derived glossaries save a batch of entries in one write, merging with existing rows", () => {
  setActiveStorageLogin("tester");

  const readyEntry = (requestKey) => ({
    status: "ready",
    error: "",
    requestKey,
    translationSourceLanguageCode: "en",
    glossarySourceLanguageCode: "es",
    targetLanguageCode: "vi",
    translationSourceText: "The inner chamber glows.",
    glossarySourceText: "La camara interior brilla.",
    glossarySourceTextOrigin: "generated",
    glossaryRevisionKey: "rev-1",
    entries: [],
    matcherModel: null,
  });

  // Pre-existing row written through the singular path.
  saveStoredEditorDerivedGlossaryEntryForChapter(
    fixtureTeam,
    "project-1",
    "chapter-1",
    "row-0",
    readyEntry("req-0"),
  );

  saveStoredEditorDerivedGlossaryEntriesForChapter(fixtureTeam, "project-1", "chapter-1", {
    "row-1": readyEntry("req-1"),
    "row-2": readyEntry("req-2"),
    // Non-ready entries clear any stored value for the row instead of storing.
    "row-0": { ...readyEntry("req-stale"), status: "loading" },
    "  ": readyEntry("req-blank"),
  });

  const stored = loadStoredEditorDerivedGlossariesForChapter(fixtureTeam, "project-1", "chapter-1");
  assert.deepEqual(Object.keys(stored).sort(), ["row-1", "row-2"]);
  assert.equal(stored["row-1"].requestKey, "req-1");
  assert.equal(stored["row-2"].requestKey, "req-2");
});

const { readPersistentValue, writePersistentValue } = await import("./persistent-store.js");
const { normalizeEditorGlossaryRevisionKey } = await import("./editor-derived-glossary-state.js");

test("saving any chapter migrates legacy JSON revision keys across the whole stored map", () => {
  setActiveStorageLogin("tester");
  const legacyKey = JSON.stringify({ glossaryId: "g", terms: [{ termId: "t1" }] });
  const legacyEntry = {
    status: "ready",
    error: "",
    requestKey: "req-legacy",
    translationSourceLanguageCode: "en",
    glossarySourceLanguageCode: "es",
    targetLanguageCode: "vi",
    translationSourceText: "Old text.",
    glossarySourceText: "Texto viejo.",
    glossarySourceTextOrigin: "row",
    glossaryRevisionKey: legacyKey,
    entries: [],
  };
  // A store written before revision keys were hashed: chapter-1 is untouched
  // by the save below and must still be migrated.
  writePersistentValue(DERIVED_GLOSSARY_STORAGE_KEY, {
    "installation:42": { "project-1::chapter-1": { "row-1": legacyEntry } },
  });

  saveStoredEditorDerivedGlossaryEntryForChapter(fixtureTeam, "project-1", "chapter-2", "row-9", {
    ...legacyEntry,
    requestKey: "req-new",
    glossaryRevisionKey: "h1:0000000000000000",
  });

  const stored = readPersistentValue(DERIVED_GLOSSARY_STORAGE_KEY, null);
  const migratedKey = stored["installation:42"]["project-1::chapter-1"]["row-1"].glossaryRevisionKey;
  assert.equal(migratedKey, normalizeEditorGlossaryRevisionKey(legacyKey));
  assert.match(migratedKey, /^h1:[0-9a-f]{16}$/);
  assert.equal(
    loadStoredEditorDerivedGlossariesForChapter(fixtureTeam, "project-1", "chapter-1")["row-1"].glossaryRevisionKey,
    migratedKey,
  );
  assert.equal(
    stored["installation:42"]["project-1::chapter-2"]["row-9"].glossaryRevisionKey,
    "h1:0000000000000000",
  );
});
