import test from "node:test";
import assert from "node:assert/strict";

const cloneValue = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
};

const localStorageState = new Map();
const invokeLog = [];
let invokeHandler = async () => null;

const fakeApp = {
  addEventListener() {},
  firstElementChild: null,
  innerHTML: "",
};

const fakeDocument = {
  querySelector(selector) {
    return selector === "#app" ? fakeApp : null;
  },
  querySelectorAll() {
    return [];
  },
  body: {
    append() {},
  },
  documentElement: {
    classList: {
      remove() {},
      toggle() {},
    },
  },
  addEventListener() {},
  hidden: false,
};

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
};

globalThis.document = fakeDocument;
globalThis.performance = {
  now() {
    return 0;
  },
};
globalThis.window = {
  __TAURI__: {
    core: {
      invoke(command, payload = {}) {
        invokeLog.push({
          command,
          payload: cloneValue(payload),
        });
        return invokeHandler(command, payload);
      },
    },
    event: {
      listen: async () => () => {},
    },
    opener: {
      openUrl() {},
    },
  },
  localStorage: fakeLocalStorage,
  navigator: {
    platform: "MacIntel",
    userAgentData: null,
  },
  setInterval() {
    return 1;
  },
  clearInterval() {},
  setTimeout(callback) {
    callback();
    return 1;
  },
  clearTimeout() {},
  requestAnimationFrame(callback) {
    callback();
    return 1;
  },
  cancelAnimationFrame() {},
  open() {},
};
globalThis.navigator = globalThis.window.navigator;

const {
  createEditorChapterState,
  resetSessionState,
  state,
} = await import("./state.js");
const { normalizeEditorRows, applyEditorUiState } = await import("./editor-state-flow.js");
const {
  applyEditorAiReview,
  runEditorAiReview,
} = await import("./editor-ai-review-flow.js");
const { runEditorAiTranslate } = await import("./editor-ai-translate-flow.js");
const {
  dismissAiSettingsAboutModal,
  loadAiSettingsPage,
  explainAiModelProbeError,
  loadAiProviderSecret,
  saveAiProviderSecret,
  selectAiProvider,
  updateAiSettingsAboutModalDontShowAgain,
  updateAiActionModel,
  updateAiProviderSecretDraft,
} = await import("./ai-settings-flow.js");
const {
  loadStoredAiActionPreferences,
  saveStoredAiActionPreferences,
} = await import("./ai-action-preferences.js");
const {
  clearStoredAiSettingsAboutDismissed,
  loadStoredAiSettingsAboutDismissed,
} = await import("./ai-settings-preferences.js");
const { pickPreferredAiModelId } = await import("./ai-action-config.js");
const { buildEditorGlossaryModel } = await import("./editor-glossary-highlighting.js");
const { resolveVisibleEditorAiReview } = await import("./editor-ai-review-state.js");
const { resolveVisibleEditorAiTranslateAction } = await import("./editor-ai-translate-state.js");

function installTranslateFixture(options = {}) {
  const languages = Array.isArray(options.languages) && options.languages.length > 0
    ? options.languages
    : [
      { code: "es", name: "Spanish" },
      { code: "vi", name: "Vietnamese" },
    ];
  const selectedSourceLanguageCode = options.selectedSourceLanguageCode ?? "es";
  const selectedTargetLanguageCode = options.selectedTargetLanguageCode ?? "vi";
  const activeLanguageCode = options.activeLanguageCode ?? selectedTargetLanguageCode;
  const fields = {
    es: "Hola",
    vi: "Texto original",
    ...(options.fields && typeof options.fields === "object" ? options.fields : {}),
  };
  resetSessionState();
  state.screen = "translate";
  state.selectedChapterId = "chapter-1";
  state.editorChapter = {
    ...createEditorChapterState(),
    status: "ready",
    chapterId: "chapter-1",
    languages,
    selectedSourceLanguageCode,
    selectedTargetLanguageCode,
    activeRowId: "row-1",
    activeLanguageCode,
    rows: normalizeEditorRows([{
      rowId: "row-1",
      fields,
      fieldStates: {},
    }]),
  };
}

test.afterEach(() => {
  invokeHandler = async () => null;
  invokeLog.length = 0;
  localStorageState.clear();
  clearStoredAiSettingsAboutDismissed();
  resetSessionState();
});

test("runEditorAiReview opens the missing-key modal when no saved key exists", async () => {
  installTranslateFixture();
  invokeHandler = async (command) => {
    if (command === "load_ai_provider_secret") {
      return null;
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await runEditorAiReview(() => {});

  assert.equal(state.aiReviewMissingKeyModal.isOpen, true);
  assert.deepEqual(
    invokeLog.map((entry) => entry.command),
    ["load_ai_provider_secret"],
  );
});

test("runEditorAiReview uses the configured provider and model", async () => {
  installTranslateFixture();
  state.aiSettings = {
    ...state.aiSettings,
    actionConfig: {
      ...state.aiSettings.actionConfig,
      detailedConfiguration: true,
      unified: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
      },
      actions: {
        ...state.aiSettings.actionConfig.actions,
        review: {
          providerId: "gemini",
          modelId: "gemini-2.0-flash",
        },
      },
    },
  };

  invokeHandler = async (command, payload = {}) => {
    if (command === "load_ai_provider_secret") {
      assert.equal(payload.providerId, "gemini");
      return "gm-key";
    }
    if (command === "run_ai_review") {
      assert.deepEqual(payload, {
        request: {
          providerId: "gemini",
          modelId: "gemini-2.0-flash",
          text: "Texto original",
          languageCode: "vi",
        },
      });
      return {
        suggestedText: "Texto revisado",
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await runEditorAiReview(() => {});

  assert.equal(state.editorChapter.aiReview.status, "ready");
  assert.equal(state.editorChapter.aiReview.suggestedText, "Texto revisado");
});

test("runEditorAiTranslate uses the configured translate action and persists into the target field", async () => {
  installTranslateFixture();
  state.aiSettings = {
    ...state.aiSettings,
    actionConfig: {
      ...state.aiSettings.actionConfig,
      detailedConfiguration: true,
      unified: {
        providerId: "gemini",
        modelId: "gemini-2.0-flash",
      },
      actions: {
        ...state.aiSettings.actionConfig.actions,
        translate1: {
          providerId: "openai",
          modelId: "gpt-5.4-mini",
        },
      },
    },
  };

  let persistCount = 0;
  invokeHandler = async (command, payload = {}) => {
    if (command === "load_ai_provider_secret") {
      assert.equal(payload.providerId, "openai");
      return "oa-key";
    }
    if (command === "run_ai_translation") {
      assert.deepEqual(payload, {
        request: {
          providerId: "openai",
          modelId: "gpt-5.4-mini",
          text: "Hola",
          sourceLanguage: "Spanish",
          targetLanguage: "Vietnamese",
        },
      });
      return {
        translatedText: "Xin chao",
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await runEditorAiTranslate(() => {}, "translate1", {
    updateEditorRowFieldValue(rowId, languageCode, nextValue) {
      const row = state.editorChapter.rows.find((entry) => entry.rowId === rowId);
      row.fields[languageCode] = nextValue;
      row.saveStatus = "dirty";
    },
    async persistEditorRowOnBlur(_render, rowId) {
      persistCount += 1;
      const row = state.editorChapter.rows.find((entry) => entry.rowId === rowId);
      row.persistedFields = { ...row.fields };
      row.saveStatus = "idle";
    },
  });

  assert.equal(persistCount, 1);
  assert.equal(state.editorChapter.rows[0].fields.vi, "Xin chao");
  assert.equal(state.editorChapter.rows[0].persistedFields.vi, "Xin chao");
  assert.equal(state.editorChapter.aiTranslate.translate1.status, "idle");
});

test("runEditorAiTranslate uses the active alternate language as the translation target", async () => {
  installTranslateFixture({
    languages: [
      { code: "es", name: "Spanish" },
      { code: "vi", name: "Vietnamese" },
      { code: "fr", name: "French" },
    ],
    activeLanguageCode: "fr",
    fields: {
      fr: "Texte original",
    },
  });
  state.aiSettings = {
    ...state.aiSettings,
    actionConfig: {
      ...state.aiSettings.actionConfig,
      detailedConfiguration: true,
      actions: {
        ...state.aiSettings.actionConfig.actions,
        translate1: {
          providerId: "openai",
          modelId: "gpt-5.4-mini",
        },
      },
    },
  };

  let persistCount = 0;
  invokeHandler = async (command, payload = {}) => {
    if (command === "load_ai_provider_secret") {
      assert.equal(payload.providerId, "openai");
      return "oa-key";
    }
    if (command === "run_ai_translation") {
      assert.deepEqual(payload, {
        request: {
          providerId: "openai",
          modelId: "gpt-5.4-mini",
          text: "Hola",
          sourceLanguage: "Spanish",
          targetLanguage: "French",
        },
      });
      return {
        translatedText: "Bonjour",
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await runEditorAiTranslate(() => {}, "translate1", {
    updateEditorRowFieldValue(rowId, languageCode, nextValue) {
      const row = state.editorChapter.rows.find((entry) => entry.rowId === rowId);
      row.fields[languageCode] = nextValue;
      row.saveStatus = "dirty";
    },
    async persistEditorRowOnBlur(_render, rowId) {
      persistCount += 1;
      const row = state.editorChapter.rows.find((entry) => entry.rowId === rowId);
      row.persistedFields = { ...row.fields };
      row.saveStatus = "idle";
    },
  });

  assert.equal(persistCount, 1);
  assert.equal(state.editorChapter.rows[0].fields.fr, "Bonjour");
  assert.equal(state.editorChapter.rows[0].persistedFields.fr, "Bonjour");
  assert.equal(state.editorChapter.rows[0].fields.vi, "Texto original");
  assert.equal(state.editorChapter.aiTranslate.translate1.status, "idle");
});

test("runEditorAiTranslate sends glossary hints for matched source-language terms", async () => {
  installTranslateFixture({
    fields: {
      es: "La gnostica habla.",
      vi: "",
    },
  });
  const glossary = {
    status: "ready",
    error: "",
    glossaryId: "glossary-1",
    repoName: "glossary-1",
    title: "Glossary",
    sourceLanguage: {
      code: "es",
      name: "Spanish",
    },
    targetLanguage: {
      code: "vi",
      name: "Vietnamese",
    },
    terms: [{
      termId: "t1",
      sourceTerms: ["gnostica", "gnostico"],
      targetTerms: ["hoc tro gnosis", "cua gnosis"],
      notesToTranslators: "Lien quan den Gnosis",
      footnote: "Chu thich bo sung",
    }],
    matcherModel: null,
  };
  glossary.matcherModel = buildEditorGlossaryModel(glossary);
  state.editorChapter = {
    ...state.editorChapter,
    glossary,
  };
  state.aiSettings = {
    ...state.aiSettings,
    actionConfig: {
      ...state.aiSettings.actionConfig,
      detailedConfiguration: true,
      actions: {
        ...state.aiSettings.actionConfig.actions,
        translate1: {
          providerId: "openai",
          modelId: "gpt-5.4-mini",
        },
      },
    },
  };

  invokeHandler = async (command, payload = {}) => {
    if (command === "load_ai_provider_secret") {
      assert.equal(payload.providerId, "openai");
      return "oa-key";
    }
    if (command === "run_ai_translation") {
      assert.deepEqual(payload, {
        request: {
          providerId: "openai",
          modelId: "gpt-5.4-mini",
          text: "La gnostica habla.",
          sourceLanguage: "Spanish",
          targetLanguage: "Vietnamese",
          glossaryHints: [{
            sourceTerm: "gnostica",
            targetVariants: ["hoc tro gnosis", "cua gnosis"],
            notes: ["Lien quan den Gnosis"],
          }],
        },
      });
      return {
        translatedText: "Ban dich",
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await runEditorAiTranslate(() => {}, "translate1", {
    updateEditorRowFieldValue(rowId, languageCode, nextValue) {
      const row = state.editorChapter.rows.find((entry) => entry.rowId === rowId);
      row.fields[languageCode] = nextValue;
      row.saveStatus = "dirty";
    },
    async persistEditorRowOnBlur(_render, rowId) {
      const row = state.editorChapter.rows.find((entry) => entry.rowId === rowId);
      row.persistedFields = { ...row.fields };
      row.saveStatus = "idle";
    },
  });

  assert.equal(state.editorChapter.rows[0].fields.vi, "Ban dich");
});

test("runEditorAiTranslate prepares derived glossary hints when the glossary source language differs", async () => {
  installTranslateFixture({
    languages: [
      { code: "en", name: "English" },
      { code: "es", name: "Spanish" },
      { code: "vi", name: "Vietnamese" },
    ],
    selectedSourceLanguageCode: "en",
    activeLanguageCode: "vi",
    fields: {
      en: "The inner chamber glows.",
      es: "La camara interior brilla.",
      vi: "",
    },
  });
  const glossary = {
    status: "ready",
    error: "",
    glossaryId: "glossary-1",
    repoName: "glossary-1",
    title: "Glossary",
    sourceLanguage: {
      code: "es",
      name: "Spanish",
    },
    targetLanguage: {
      code: "vi",
      name: "Vietnamese",
    },
    terms: [{
      termId: "t1",
      sourceTerms: ["camara interior"],
      targetTerms: ["buong noi tam"],
      notesToTranslators: "Dung thuat ngu cua glossary",
    }],
    matcherModel: null,
  };
  glossary.matcherModel = buildEditorGlossaryModel(glossary);
  state.editorChapter = {
    ...state.editorChapter,
    glossary,
  };
  state.aiSettings = {
    ...state.aiSettings,
    actionConfig: {
      ...state.aiSettings.actionConfig,
      detailedConfiguration: true,
      actions: {
        ...state.aiSettings.actionConfig.actions,
        translate1: {
          providerId: "openai",
          modelId: "gpt-5.4-mini",
        },
      },
    },
  };

  invokeHandler = async (command, payload = {}) => {
    if (command === "load_ai_provider_secret") {
      return "oa-key";
    }
    if (command === "prepare_editor_ai_translated_glossary") {
      assert.deepEqual(payload, {
        request: {
          providerId: "openai",
          modelId: "gpt-5.4-mini",
          translationSourceText: "The inner chamber glows.",
          translationSourceLanguage: "English",
          glossarySourceLanguage: "Spanish",
          targetLanguage: "Vietnamese",
          glossarySourceText: "La camara interior brilla.",
          glossaryTerms: [{
            glossarySourceTerms: ["camara interior"],
            targetVariants: ["buong noi tam"],
            notes: ["Dung thuat ngu cua glossary"],
          }],
        },
      });
      return {
        glossarySourceText: "La camara interior brilla.",
        entries: [{
          sourceTerm: "inner chamber",
          glossarySourceTerm: "camara interior",
          targetVariants: ["buong noi tam"],
          notes: ["Dung thuat ngu cua glossary"],
        }],
      };
    }
    if (command === "run_ai_translation") {
      assert.deepEqual(payload, {
        request: {
          providerId: "openai",
          modelId: "gpt-5.4-mini",
          text: "The inner chamber glows.",
          sourceLanguage: "English",
          targetLanguage: "Vietnamese",
          glossaryHints: [{
            sourceTerm: "inner chamber",
            targetVariants: ["buong noi tam"],
            notes: ["Dung thuat ngu cua glossary"],
          }],
        },
      });
      return {
        translatedText: "Buong noi tam sang len.",
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await runEditorAiTranslate(() => {}, "translate1", {
    updateEditorRowFieldValue(rowId, languageCode, nextValue) {
      const row = state.editorChapter.rows.find((entry) => entry.rowId === rowId);
      row.fields[languageCode] = nextValue;
      row.saveStatus = "dirty";
    },
    async persistEditorRowOnBlur(_render, rowId) {
      const row = state.editorChapter.rows.find((entry) => entry.rowId === rowId);
      row.persistedFields = { ...row.fields };
      row.saveStatus = "idle";
    },
  });

  assert.deepEqual(
    invokeLog.map((entry) => entry.command),
    [
      "load_ai_provider_secret",
      "prepare_editor_ai_translated_glossary",
      "run_ai_translation",
    ],
  );
  assert.equal(state.editorChapter.rows[0].fields.vi, "Buong noi tam sang len.");
  assert.equal(
    state.editorChapter.derivedGlossariesByRowId["row-1"]?.status,
    "ready",
  );
  assert.equal(
    state.editorChapter.derivedGlossariesByRowId["row-1"]?.glossarySourceTextOrigin,
    "row",
  );
});

test("runEditorAiTranslate reuses a generated derived glossary cache entry when the glossary-source field is empty", async () => {
  installTranslateFixture({
    languages: [
      { code: "en", name: "English" },
      { code: "es", name: "Spanish" },
      { code: "vi", name: "Vietnamese" },
    ],
    selectedSourceLanguageCode: "en",
    activeLanguageCode: "vi",
    fields: {
      en: "The inner chamber glows.",
      es: "",
      vi: "",
    },
  });
  const glossary = {
    status: "ready",
    error: "",
    glossaryId: "glossary-1",
    repoName: "glossary-1",
    title: "Glossary",
    sourceLanguage: {
      code: "es",
      name: "Spanish",
    },
    targetLanguage: {
      code: "vi",
      name: "Vietnamese",
    },
    terms: [{
      termId: "t1",
      sourceTerms: ["camara interior"],
      targetTerms: ["buong noi tam"],
      notesToTranslators: "Dung thuat ngu cua glossary",
    }],
    matcherModel: null,
  };
  glossary.matcherModel = buildEditorGlossaryModel(glossary);
  state.editorChapter = {
    ...state.editorChapter,
    glossary,
  };
  state.aiSettings = {
    ...state.aiSettings,
    actionConfig: {
      ...state.aiSettings.actionConfig,
      detailedConfiguration: true,
      actions: {
        ...state.aiSettings.actionConfig.actions,
        translate1: {
          providerId: "openai",
          modelId: "gpt-5.4-mini",
        },
      },
    },
  };

  let prepareCount = 0;
  let translateCount = 0;
  invokeHandler = async (command, payload = {}) => {
    if (command === "load_ai_provider_secret") {
      return "oa-key";
    }
    if (command === "prepare_editor_ai_translated_glossary") {
      prepareCount += 1;
      assert.equal(payload.request.glossarySourceText, "");
      return {
        glossarySourceText: "La camara interior brilla.",
        entries: [{
          sourceTerm: "inner chamber",
          glossarySourceTerm: "camara interior",
          targetVariants: ["buong noi tam"],
          notes: ["Dung thuat ngu cua glossary"],
        }],
      };
    }
    if (command === "run_ai_translation") {
      translateCount += 1;
      assert.deepEqual(payload.request.glossaryHints, [{
        sourceTerm: "inner chamber",
        targetVariants: ["buong noi tam"],
        notes: ["Dung thuat ngu cua glossary"],
      }]);
      return {
        translatedText: `Ban dich ${translateCount}`,
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  const operations = {
    updateEditorRowFieldValue(rowId, languageCode, nextValue) {
      const row = state.editorChapter.rows.find((entry) => entry.rowId === rowId);
      row.fields[languageCode] = nextValue;
      row.saveStatus = "dirty";
    },
    async persistEditorRowOnBlur(_render, rowId) {
      const row = state.editorChapter.rows.find((entry) => entry.rowId === rowId);
      row.persistedFields = { ...row.fields };
      row.saveStatus = "idle";
    },
  };

  await runEditorAiTranslate(() => {}, "translate1", operations);
  await runEditorAiTranslate(() => {}, "translate1", operations);

  assert.equal(prepareCount, 1);
  assert.equal(translateCount, 2);
  assert.equal(
    state.editorChapter.derivedGlossariesByRowId["row-1"]?.glossarySourceTextOrigin,
    "generated",
  );
  assert.deepEqual(
    invokeLog.map((entry) => entry.command),
    [
      "load_ai_provider_secret",
      "prepare_editor_ai_translated_glossary",
      "run_ai_translation",
      "load_ai_provider_secret",
      "run_ai_translation",
    ],
  );
});

test("runEditorAiTranslate opens the missing-key modal for the translate action provider", async () => {
  installTranslateFixture();
  state.aiSettings = {
    ...state.aiSettings,
    actionConfig: {
      ...state.aiSettings.actionConfig,
      detailedConfiguration: true,
      actions: {
        ...state.aiSettings.actionConfig.actions,
        translate2: {
          providerId: "deepseek",
          modelId: "deepseek-chat",
        },
      },
    },
  };

  invokeHandler = async (command, payload = {}) => {
    if (command === "load_ai_provider_secret") {
      assert.equal(payload.providerId, "deepseek");
      return null;
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await runEditorAiTranslate(() => {}, "translate2", {
    updateEditorRowFieldValue() {},
    async persistEditorRowOnBlur() {},
  });

  assert.equal(state.aiReviewMissingKeyModal.isOpen, true);
  assert.equal(state.aiReviewMissingKeyModal.providerId, "deepseek");
});

test("applyEditorAiReview updates the editor row and clears the suggestion after save", async () => {
  installTranslateFixture();
  state.editorChapter = {
    ...state.editorChapter,
    aiReview: {
      status: "ready",
      error: "",
      rowId: "row-1",
      languageCode: "vi",
      requestKey: "req-1",
      sourceText: "Texto original",
      suggestedText: "Texto revisado",
    },
  };

  let persistCount = 0;

  await applyEditorAiReview(() => {}, {
    updateEditorRowFieldValue(rowId, languageCode, nextValue) {
      const row = state.editorChapter.rows.find((entry) => entry.rowId === rowId);
      row.fields[languageCode] = nextValue;
      row.saveStatus = "dirty";
    },
    async persistEditorRowOnBlur(_render, rowId) {
      persistCount += 1;
      const row = state.editorChapter.rows.find((entry) => entry.rowId === rowId);
      row.persistedFields = { ...row.fields };
      row.saveStatus = "idle";
    },
  });

  assert.equal(persistCount, 1);
  assert.equal(state.editorChapter.rows[0].fields.vi, "Texto revisado");
  assert.equal(state.editorChapter.rows[0].persistedFields.vi, "Texto revisado");
  assert.equal(state.editorChapter.aiReview.status, "idle");
  assert.equal(
    invokeLog.some((entry) => entry.command === "run_ai_review"),
    false,
  );
});

test("AI key load and save flows populate and persist aiSettings state", async () => {
  resetSessionState();
  state.screen = "aiKey";
  state.aiSettings = {
    ...state.aiSettings,
    returnScreen: "teams",
  };

  let savedPayload = null;
  invokeHandler = async (command, payload = {}) => {
    if (command === "load_ai_provider_secret") {
      return "sk-existing";
    }
    if (command === "list_ai_provider_models") {
      return [{ id: "gpt-5.4-mini", label: "gpt-5.4-mini" }];
    }
    if (command === "save_ai_provider_secret") {
      savedPayload = payload;
      return null;
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await loadAiProviderSecret(() => {});
  assert.equal(state.aiSettings.status, "ready");
  assert.equal(state.aiSettings.apiKey, "sk-existing");
  assert.equal(state.aiSettings.hasLoaded, true);

  updateAiProviderSecretDraft("  sk-updated  ");
  await saveAiProviderSecret(() => {});

  assert.deepEqual(savedPayload, {
    providerId: "gemini",
    apiKey: "  sk-updated  ",
  });
  assert.equal(state.aiSettings.status, "ready");
  assert.equal(state.aiSettings.apiKey, "sk-updated");
  assert.equal(state.aiSettings.successMessage, "Gemini key saved.");

  updateAiProviderSecretDraft("sk-next");
  assert.equal(state.aiSettings.successMessage, "");
});

test("AI key provider selection loads and saves keys independently by provider", async () => {
  resetSessionState();
  state.screen = "aiKey";

  const storedKeys = {
    openai: "sk-openai",
    gemini: "gm-existing",
    claude: null,
    deepseek: "ds-existing",
  };

  invokeHandler = async (command, payload = {}) => {
    if (command === "load_ai_provider_secret") {
      return storedKeys[payload.providerId] ?? null;
    }
    if (command === "list_ai_provider_models") {
      return [{ id: "gpt-5.4-mini", label: "gpt-5.4-mini" }];
    }
    if (command === "save_ai_provider_secret") {
      storedKeys[payload.providerId] = String(payload.apiKey ?? "").trim() || null;
      return null;
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await loadAiProviderSecret(() => {});
  assert.equal(state.aiSettings.providerId, "gemini");
  assert.equal(state.aiSettings.apiKey, "gm-existing");

  await selectAiProvider(() => {}, "openai");
  assert.equal(state.aiSettings.providerId, "openai");
  assert.equal(state.aiSettings.apiKey, "sk-openai");

  await selectAiProvider(() => {}, "gemini");
  assert.equal(state.aiSettings.providerId, "gemini");
  assert.equal(state.aiSettings.apiKey, "gm-existing");

  updateAiProviderSecretDraft("  gm-updated  ");
  await saveAiProviderSecret(() => {});

  assert.equal(storedKeys.gemini, "gm-updated");
  assert.equal(storedKeys.openai, "sk-openai");
  assert.equal(state.aiSettings.successMessage, "Gemini key saved.");

  await selectAiProvider(() => {}, "openai");
  assert.equal(state.aiSettings.providerId, "openai");
  assert.equal(state.aiSettings.apiKey, "sk-openai");

  assert.deepEqual(
    invokeLog
      .filter((entry) => entry.command === "save_ai_provider_secret")
      .map((entry) => entry.payload),
    [{
      providerId: "gemini",
      apiKey: "  gm-updated  ",
    }],
  );
});

test("AI Settings shows the about modal by default and can persist dismissal", async () => {
  resetSessionState();
  state.screen = "aiKey";

  invokeHandler = async (command) => {
    if (command === "load_ai_provider_secret") {
      return null;
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await loadAiSettingsPage(() => {});
  assert.equal(state.aiSettings.aboutModal.isOpen, true);
  assert.equal(state.aiSettings.aboutModal.dontShowAgain, false);

  updateAiSettingsAboutModalDontShowAgain(true);
  assert.equal(state.aiSettings.aboutModal.dontShowAgain, true);

  dismissAiSettingsAboutModal(() => {});
  assert.equal(state.aiSettings.aboutModal.isOpen, false);
  assert.equal(loadStoredAiSettingsAboutDismissed(), true);

  await loadAiSettingsPage(() => {});
  assert.equal(state.aiSettings.aboutModal.isOpen, false);
});

test("AI action preferences round-trip through persistent storage", () => {
  saveStoredAiActionPreferences({
    detailedConfiguration: true,
    unified: {
      providerId: "openai",
      modelId: "gpt-5.4-mini",
    },
    actions: {
      translate1: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
      },
      translate2: {
        providerId: "gemini",
        modelId: "gemini-2.0-flash",
      },
      review: {
        providerId: "claude",
        modelId: "claude-sonnet-4-20250514",
      },
      discuss: {
        providerId: "deepseek",
        modelId: "deepseek-chat",
      },
    },
  }, "tester");

  assert.deepEqual(
    loadStoredAiActionPreferences("tester"),
    {
      detailedConfiguration: true,
      unified: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
      },
      actions: {
        translate1: {
          providerId: "openai",
          modelId: "gpt-5.4-mini",
        },
        translate2: {
          providerId: "gemini",
          modelId: "gemini-2.0-flash",
        },
        review: {
          providerId: "claude",
          modelId: "claude-sonnet-4-20250514",
        },
        discuss: {
          providerId: "deepseek",
          modelId: "deepseek-chat",
        },
      },
    },
  );
});

test("updateAiActionModel probes the selected Gemini model and opens the rate-limit warning modal on failure", async () => {
  resetSessionState();
  state.aiSettings = {
    ...state.aiSettings,
    actionConfig: {
      ...state.aiSettings.actionConfig,
      savedProviderIds: ["gemini"],
      unified: {
        providerId: "gemini",
        modelId: "gemini-3-flash-preview",
      },
      modelOptionsByProvider: {
        ...state.aiSettings.actionConfig.modelOptionsByProvider,
        gemini: {
          status: "ready",
          error: "",
          options: [
            { id: "gemini-3-pro-preview", label: "gemini-3-pro-preview" },
            { id: "gemini-3-flash-preview", label: "gemini-3-flash-preview" },
          ],
          hasLoaded: true,
        },
      },
    },
  };

  invokeHandler = async (command, payload = {}) => {
    if (command === "probe_ai_provider_model") {
      assert.deepEqual(payload, {
        request: {
          providerId: "gemini",
          modelId: "gemini-3-pro-preview",
        },
      });
      throw new Error("Resource has been exhausted (e.g. check quota).");
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await updateAiActionModel(() => {}, "unified", "gemini-3-pro-preview");

  assert.equal(state.aiSettings.actionConfig.unified.modelId, "gemini-3-pro-preview");
  assert.equal(state.aiSettings.modelErrorModal.isOpen, true);
  assert.equal(
    state.aiSettings.modelErrorModal.banner,
    "Resource has been exhausted (e.g. check quota).",
  );
  assert.equal(
    state.aiSettings.modelErrorModal.message,
    "A rate limit on Gemini indicates that either you have not set up billing for your Google AI account or you have set up billing but you used up all the tokens that your usage plan allows in a given time period.",
  );
});

test("explainAiModelProbeError falls back to the generic copy for unrecognized errors", () => {
  assert.equal(
    explainAiModelProbeError("openai", "Something weird happened."),
    "Please try selecting a different model.",
  );
});

test("pickPreferredAiModelId prefers general OpenAI models and maps old pro selections to general", () => {
  const options = [
    { id: "gpt-5.5", label: "gpt-5.5" },
    { id: "gpt-5.5-mini", label: "gpt-5.5-mini" },
    { id: "gpt-5.5-nano", label: "gpt-5.5-nano" },
  ];

  assert.equal(
    pickPreferredAiModelId("openai", options, "gpt-5.4"),
    "gpt-5.5",
  );
  assert.equal(
    pickPreferredAiModelId("openai", options, "gpt-5.4-pro"),
    "gpt-5.5",
  );
  assert.equal(
    pickPreferredAiModelId("openai", options, "gpt-5.4-mini"),
    "gpt-5.5-mini",
  );
  assert.equal(
    pickPreferredAiModelId("openai", options, "gpt-5.4-nano"),
    "gpt-5.5-nano",
  );
  assert.equal(
    pickPreferredAiModelId("openai", options),
    "gpt-5.5",
  );
});

test("pickPreferredAiModelId keeps Gemini selections in the same family and defaults to Pro", () => {
  const options = [
    { id: "gemini-3-pro-preview", label: "gemini-3-pro-preview" },
    { id: "gemini-3-flash-preview", label: "gemini-3-flash-preview" },
    {
      id: "gemini-2.5-flash-lite-preview-09-2025",
      label: "gemini-2.5-flash-lite-preview-09-2025",
    },
  ];

  assert.equal(
    pickPreferredAiModelId("gemini", options, "gemini-2.5-pro"),
    "gemini-3-pro-preview",
  );
  assert.equal(
    pickPreferredAiModelId("gemini", options, "gemini-2.5-flash-lite"),
    "gemini-2.5-flash-lite-preview-09-2025",
  );
  assert.equal(
    pickPreferredAiModelId("gemini", options),
    "gemini-3-pro-preview",
  );
});

test("AI review visibility suppresses stale suggestions and same-chapter UI keeps ai review state", () => {
  const visible = resolveVisibleEditorAiReview(
    {
      ...createEditorChapterState(),
      chapterId: "chapter-1",
      aiReview: {
        status: "ready",
        error: "",
        rowId: "row-1",
        languageCode: "vi",
        requestKey: "req-1",
        sourceText: "Texto original",
        suggestedText: "Texto revisado",
      },
    },
    "row-1",
    "vi",
    "Texto cambiado",
  );

  assert.equal(visible.showSuggestion, false);
  assert.equal(visible.isStale, true);
  assert.equal(visible.showReviewNow, true);

  const nextState = applyEditorUiState(
    {
      chapterId: "chapter-1",
      languages: [{ code: "vi" }],
      rows: [{ rowId: "row-1" }],
    },
    {
      ...createEditorChapterState(),
      chapterId: "chapter-1",
      activeRowId: "row-1",
      activeLanguageCode: "vi",
      reviewExpandedSectionKeys: new Set(["ai-review"]),
      aiReview: {
        status: "ready",
        error: "",
        rowId: "row-1",
        languageCode: "vi",
        requestKey: "req-2",
        sourceText: "Texto original",
        suggestedText: "Texto revisado",
      },
    },
  );

  assert.deepEqual([...nextState.reviewExpandedSectionKeys], ["ai-review"]);
  assert.equal(nextState.aiReview.status, "ready");
  assert.equal(nextState.aiReview.suggestedText, "Texto revisado");
});

test("AI translate visibility suppresses stale errors for changed source text", () => {
  const visible = resolveVisibleEditorAiTranslateAction(
    {
      ...createEditorChapterState(),
      chapterId: "chapter-1",
      aiTranslate: {
        ...createEditorChapterState().aiTranslate,
        translate1: {
          status: "error",
          error: "Boom",
          rowId: "row-1",
          sourceLanguageCode: "es",
          targetLanguageCode: "vi",
          requestKey: "req-1",
          sourceText: "Hola",
        },
      },
    },
    "translate1",
    "row-1",
    "es",
    "vi",
    "Texto cambiado",
  );

  assert.equal(visible.showError, false);
  assert.equal(visible.isStale, true);
});
