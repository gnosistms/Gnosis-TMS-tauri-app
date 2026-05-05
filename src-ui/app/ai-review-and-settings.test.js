import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cloneValue = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
};

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createSpy() {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
  };
  fn.calls = calls;
  return fn;
}

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
const {
  buildEditorAiTranslateContext,
  runEditorAiTranslate,
  runEditorAiTranslateForContext,
} = await import("./editor-ai-translate-flow.js");
const {
  authorLoginFromAssistantHistoryEntry,
  buildEditorAssistantTargetLanguageHistory,
  classifyEditorAssistantTargetHistoryEntry,
  runEditorAiAssistant,
} = await import("./editor-ai-assistant-flow.js");
const {
  applyStoredSelectedTeamAiActionPreferences,
  aiActionControlsAreBusy,
  dismissAiSettingsAboutModal,
  ensureSharedAiActionConfigurationLoaded,
  getAiActionControlsBusyMessage,
  loadAiSettingsPage,
  explainAiModelProbeError,
  loadAiProviderSecret,
  saveAiProviderSecret,
  selectAiProvider,
  updateAiSettingsAboutModalDontShowAgain,
  updateAiActionModel,
  updateAiActionProvider,
  updateAiProviderSecretDraft,
} = await import("./ai-settings-flow.js");
const {
  loadStoredTeamAiActionPreferences,
  loadStoredAiActionPreferences,
  saveStoredAiActionPreferences,
} = await import("./ai-action-preferences.js");
const {
  clearActiveStorageLogin,
  setActiveStorageLogin,
} = await import("./team-storage.js");
const {
  createTeamAiSharedState,
  ensureSelectedTeamAiProviderReady,
  loadSelectedTeamAiState,
  persistSelectedTeamAiActionPreferences,
  saveSelectedTeamAiProviderSecret,
} = await import("./team-ai-flow.js");
const {
  loadSelectedChapterEditorData: loadSelectedChapterEditorDataFlow,
} = await import("./editor-chapter-load-flow.js");
const {
  decryptTeamAiWrappedKey,
  encryptTeamAiPlaintext,
  generateTeamAiMemberKeypair,
} = await import("./team-ai-crypto.js");
const {
  clearStoredAiSettingsAboutDismissed,
  loadStoredAiSettingsAboutDismissed,
} = await import("./ai-settings-preferences.js");
const { pickPreferredAiModelId } = await import("./ai-action-config.js");
const {
  AI_PROVIDER_IDS,
  DEFAULT_AI_PROVIDER_ID,
} = await import("./ai-provider-config.js");
const {
  buildEditorDerivedGlossaryModel,
  buildEditorGlossaryModel,
} = await import("./editor-glossary-highlighting.js");
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

function latestAssistantDraft(rowId = "row-1", targetLanguageCode = "vi", sourceLanguageCode = "es") {
  const thread = state.editorChapter?.assistant?.threadsByKey?.[`${rowId}::${sourceLanguageCode}::${targetLanguageCode}`];
  return thread?.items
    ?.filter((item) => item?.type === "draft-translation")
    ?.at(-1) ?? null;
}

function createTeamRecord(options = {}) {
  return {
    id: options.teamId ?? "team-1",
    name: options.teamName ?? "Team One",
    githubOrg: options.githubOrg ?? "team-one",
    installationId: options.installationId ?? 42,
    canDelete: options.canDelete === true,
    canManageProjects: true,
    accountType: "Organization",
  };
}

function installSelectedTeam(options = {}) {
  const login = options.login ?? "tester";
  state.selectedTeamId = options.teamId ?? "team-1";
  state.teams = [createTeamRecord(options)];
  state.auth = {
    ...state.auth,
    session: {
      sessionToken: options.sessionToken ?? "broker-session",
      login,
      name: null,
      avatarUrl: null,
    },
  };
  setActiveStorageLogin(login);
}

test.afterEach(() => {
  invokeHandler = async () => null;
  invokeLog.length = 0;
  localStorageState.clear();
  clearActiveStorageLogin();
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

test("runEditorAiReview enters loading state before provider readiness resolves", async () => {
  installTranslateFixture();

  const render = createSpy();
  const providerReady = createDeferred();
  invokeHandler = async (command) => {
    if (command === "load_ai_provider_secret") {
      return providerReady.promise;
    }
    if (command === "run_ai_review") {
      return {
        suggestedText: "Texto revisado",
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  const reviewPromise = runEditorAiReview(render);

  assert.equal(state.editorChapter.aiReview.status, "loading");
  assert.equal(render.calls.length > 0, true);

  providerReady.resolve("oa-key");
  await reviewPromise;

  assert.equal(state.editorChapter.aiReview.status, "ready");
  assert.equal(state.editorChapter.aiReview.suggestedText, "Texto revisado");
});

test("runEditorAiReview completes when the user selects a different row before the response returns", async () => {
  installTranslateFixture();
  state.editorChapter = {
    ...state.editorChapter,
    rows: normalizeEditorRows([
      {
        rowId: "row-1",
        fields: {
          es: "Hola",
          vi: "Texto original",
        },
        fieldStates: {},
      },
      {
        rowId: "row-2",
        fields: {
          es: "Adios",
          vi: "Otro texto",
        },
        fieldStates: {},
      },
    ]),
  };

  const reviewResponse = createDeferred();
  invokeHandler = async (command) => {
    if (command === "load_ai_provider_secret") {
      return "oa-key";
    }
    if (command === "run_ai_review") {
      return reviewResponse.promise;
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  const reviewPromise = runEditorAiReview(() => {});

  assert.equal(state.editorChapter.aiReview.status, "loading");
  assert.equal(state.editorChapter.aiReview.rowId, "row-1");

  state.editorChapter = {
    ...state.editorChapter,
    activeRowId: "row-2",
    activeLanguageCode: "vi",
  };
  reviewResponse.resolve({
    suggestedText: "Texto revisado",
  });
  await reviewPromise;

  assert.equal(state.editorChapter.activeRowId, "row-2");
  assert.equal(state.editorChapter.aiReview.status, "ready");
  assert.equal(state.editorChapter.aiReview.rowId, "row-1");
  assert.equal(state.editorChapter.aiReview.suggestedText, "Texto revisado");

  const visibleForOtherRow = resolveVisibleEditorAiReview(
    state.editorChapter,
    "row-2",
    "vi",
    "Otro texto",
  );
  assert.equal(visibleForOtherRow.status, "idle");

  const visibleForReviewedRow = resolveVisibleEditorAiReview(
    state.editorChapter,
    "row-1",
    "vi",
    "Texto original",
  );
  assert.equal(visibleForReviewedRow.status, "ready");
  assert.equal(visibleForReviewedRow.showSuggestion, true);
});

test("runEditorAiTranslate uses the configured translate action and creates an assistant draft", async () => {
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
  let persistedCommitMetadata = null;
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
        providerContinuation: {
          providerResponseId: "resp_translate_1",
        },
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
      persistedCommitMetadata = arguments[2]?.commitMetadata ?? null;
      const row = state.editorChapter.rows.find((entry) => entry.rowId === rowId);
      row.persistedFields = { ...row.fields };
      row.saveStatus = "idle";
    },
  });

  assert.equal(persistCount, 0);
  assert.equal(persistedCommitMetadata, null);
  assert.equal(state.editorChapter.rows[0].fields.vi, "Texto original");
  assert.notEqual(state.editorChapter.rows[0].persistedFields.vi, "Xin chao");
  const draft = latestAssistantDraft();
  assert.equal(draft?.draftTranslationText, "Xin chao");
  assert.equal(draft?.sourceLanguageCode, "es");
  assert.equal(draft?.targetLanguageCode, "vi");
  assert.equal(
    state.editorChapter.assistant.threadsByKey["row-1::es::vi"]
      .providerContinuityByModelKey["openai::gpt-5.4-mini"]
      .providerResponseId,
    "resp_translate_1",
  );
  assert.equal(state.editorChapter.aiTranslate.translate1.status, "idle");
});

test("runEditorAiTranslate enters loading state before provider readiness resolves", async () => {
  installTranslateFixture();
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

  const render = createSpy();
  const providerReady = createDeferred();
  invokeHandler = async (command) => {
    if (command === "load_ai_provider_secret") {
      return providerReady.promise;
    }
    if (command === "run_ai_translation") {
      return {
        translatedText: "Xin chao",
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  const translationPromise = runEditorAiTranslate(render, "translate1", {
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

  assert.equal(state.editorChapter.aiTranslate.translate1.status, "loading");
  assert.equal(render.calls.length > 0, true);

  providerReady.resolve("oa-key");
  await translationPromise;

  assert.equal(state.editorChapter.aiTranslate.translate1.status, "idle");
  assert.notEqual(state.editorChapter.rows[0].persistedFields.vi, "Xin chao");
  assert.equal(latestAssistantDraft()?.draftTranslationText, "Xin chao");
});

test("runEditorAiTranslate keeps first-run team AI setup renders scoped to the editor panes", async () => {
  installTranslateFixture();
  installSelectedTeam({ canDelete: false });
  state.aiSettings = {
    ...state.aiSettings,
    teamShared: createTeamAiSharedState(),
    actionConfig: {
      ...state.aiSettings.actionConfig,
      unified: {
        providerId: "gemini",
        modelId: "gemini-3-flash-preview",
      },
    },
  };

  const render = createSpy();
  const providerCacheReady = createDeferred();
  invokeHandler = async (command, payload = {}) => {
    if (command === "load_team_ai_settings") {
      return {
        schemaVersion: 1,
        updatedAt: "2026-04-16T12:00:00.000Z",
        updatedBy: "owner",
        actionPreferences: {
          detailedConfiguration: false,
          unified: {
            providerId: "openai",
            modelId: "gpt-5.4-mini",
          },
          actions: {},
        },
      };
    }
    if (command === "load_team_ai_secrets_metadata") {
      return {
        schemaVersion: 1,
        updatedAt: "2026-04-16T12:00:00.000Z",
        updatedBy: "owner",
        providers: {
          openai: {
            configured: true,
            keyVersion: 5,
            algorithm: "rsa-oaep-sha256-v1",
          },
          gemini: null,
          claude: null,
          deepseek: null,
        },
      };
    }
    if (command === "load_ai_provider_secret") {
      assert.equal(payload.installationId, 42);
      return null;
    }
    if (command === "load_team_ai_provider_cache") {
      return providerCacheReady.promise;
    }
    if (command === "run_ai_translation") {
      return {
        translatedText: "Xin chao",
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  const translationPromise = runEditorAiTranslate(render, "translate1", {
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

  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  const startupRenderCalls = render.calls.slice();
  assert.equal(state.editorChapter.aiTranslate.translate1.status, "loading");
  assert.equal(startupRenderCalls.length > 0, true);
  assert.equal(
    startupRenderCalls.every(([options]) =>
      options
      && (options.scope === "translate-sidebar" || options.scope === "translate-body")
    ),
    true,
  );

  providerCacheReady.resolve({
    apiKey: "sk-shared-openai",
    keyVersion: 5,
  });
  await translationPromise;
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

  assert.equal(persistCount, 0);
  assert.equal(state.editorChapter.rows[0].fields.fr, "Texte original");
  assert.notEqual(state.editorChapter.rows[0].persistedFields.fr, "Bonjour");
  assert.equal(latestAssistantDraft("row-1", "fr")?.draftTranslationText, "Bonjour");
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

  assert.equal(state.editorChapter.rows[0].fields.vi, "");
  assert.equal(latestAssistantDraft()?.draftTranslationText, "Ban dich");
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
  assert.equal(state.editorChapter.rows[0].fields.vi, "");
  assert.equal(latestAssistantDraft("row-1", "vi", "en")?.draftTranslationText, "Buong noi tam sang len.");
  assert.equal(
    state.editorChapter.rows[0].fields.es,
    "La camara interior brilla.",
  );
  assert.equal(
    state.editorChapter.derivedGlossariesByRowId["row-1"]?.status,
    "ready",
  );
  assert.equal(
    state.editorChapter.derivedGlossariesByRowId["row-1"]?.glossarySourceTextOrigin,
    "row",
  );
});

test("runEditorAiTranslate regenerates derived glossary hints without saving pivot text for drafts", async () => {
  installTranslateFixture({
    languages: [
      { code: "en", name: "English" },
      { code: "es", name: "Spanish" },
      { code: "vi", name: "Vietnamese" },
    ],
    selectedSourceLanguageCode: "en",
    activeLanguageCode: "vi",
    fields: {
      en: "The inner chamber now glows brightly.",
      es: "La camara interior brilla.",
      vi: "",
    },
  });
  state.editorChapter.rows[0].persistedFields.en = "The inner chamber glows.";
  state.editorChapter.rows[0].persistedFields.es = "La camara interior brilla.";

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
      assert.equal(payload.request.glossarySourceText, "");
      return {
        glossarySourceText: "La camara interior ahora brilla mas.",
        entries: [{
          sourceTerm: "inner chamber now",
          glossarySourceTerm: "camara interior",
          targetVariants: ["buong noi tam"],
          notes: ["Dung thuat ngu cua glossary"],
        }],
      };
    }
    if (command === "run_ai_translation") {
      assert.deepEqual(payload.request.glossaryHints, [{
        sourceTerm: "inner chamber now",
        targetVariants: ["buong noi tam"],
        notes: ["Dung thuat ngu cua glossary"],
      }]);
      return {
        translatedText: "Buong noi tam nay sang ro hon.",
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

  assert.equal(
    state.editorChapter.derivedGlossariesByRowId["row-1"]?.glossarySourceTextOrigin,
    "generated",
  );
  assert.equal(
    state.editorChapter.rows[0].fields.es,
    "La camara interior brilla.",
  );
});

test("runEditorAiTranslateForContext does not overwrite a non-empty glossary-source field in apply mode", async () => {
  installTranslateFixture({
    languages: [
      { code: "en", name: "English" },
      { code: "es", name: "Spanish" },
      { code: "vi", name: "Vietnamese" },
    ],
    selectedSourceLanguageCode: "en",
    activeLanguageCode: "vi",
    fields: {
      en: "The inner chamber now glows brightly.",
      es: "La camara interior brilla.",
      vi: "",
    },
  });
  state.editorChapter.rows[0].persistedFields.en = "The inner chamber glows.";
  state.editorChapter.rows[0].persistedFields.es = "La camara interior brilla.";

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

  let persistCount = 0;
  invokeHandler = async (command, payload = {}) => {
    if (command === "load_ai_provider_secret") {
      return "oa-key";
    }
    if (command === "prepare_editor_ai_translated_glossary") {
      assert.equal(payload.request.glossarySourceText, "");
      return {
        glossarySourceText: "La camara interior ahora brilla mas.",
        entries: [{
          sourceTerm: "inner chamber now",
          glossarySourceTerm: "camara interior",
          targetVariants: ["buong noi tam"],
          notes: ["Dung thuat ngu cua glossary"],
        }],
      };
    }
    if (command === "run_ai_translation") {
      assert.deepEqual(payload.request.glossaryHints, [{
        sourceTerm: "inner chamber now",
        targetVariants: ["buong noi tam"],
        notes: ["Dung thuat ngu cua glossary"],
      }]);
      return {
        translatedText: "Buong noi tam nay sang ro hon.",
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await runEditorAiTranslateForContext(
    () => {},
    "translate1",
    buildEditorAiTranslateContext(),
    {
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
    },
  );

  assert.equal(persistCount, 1);
  assert.equal(state.editorChapter.rows[0].fields.vi, "Buong noi tam nay sang ro hon.");
  assert.equal(state.editorChapter.rows[0].persistedFields.vi, "Buong noi tam nay sang ro hon.");
  assert.equal(state.editorChapter.rows[0].fields.es, "La camara interior brilla.");
  assert.equal(state.editorChapter.rows[0].persistedFields.es, "La camara interior brilla.");
  assert.equal(
    state.editorChapter.derivedGlossariesByRowId["row-1"]?.glossarySourceTextOrigin,
    "generated",
  );
});

test("runEditorAiTranslate writes an empty glossary-source field before creating draft translations", async () => {
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
  assert.equal(latestAssistantDraft("row-1", "vi", "en")?.draftTranslationText, "Ban dich 2");
  assert.equal(
    state.editorChapter.derivedGlossariesByRowId["row-1"]?.glossarySourceTextOrigin,
    "row",
  );
  assert.equal(
    state.editorChapter.rows[0].fields.es,
    "La camara interior brilla.",
  );
  assert.equal(
    state.editorChapter.rows[0].persistedFields.es,
    "La camara interior brilla.",
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

test("runEditorAiTranslate preserves a ready derived glossary cache when final translation fails", async () => {
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
    derivedGlossariesByRowId: {
      "row-1": {
        status: "ready",
        error: "",
        requestKey: "cached-req-1",
        translationSourceLanguageCode: "en",
        glossarySourceLanguageCode: "es",
        targetLanguageCode: "vi",
        translationSourceText: "The inner chamber glows.",
        glossarySourceText: "La camara interior brilla.",
        glossarySourceTextOrigin: "generated",
        glossaryRevisionKey: JSON.stringify({
          glossaryId: "glossary-1",
          repoName: "glossary-1",
          sourceLanguageCode: "es",
          targetLanguageCode: "vi",
          terms: [{
            termId: "t1",
            sourceTerms: ["camara interior"],
            targetTerms: ["buong noi tam"],
            notes: ["Dung thuat ngu cua glossary"],
          }],
        }),
        entries: [{
          sourceTerm: "inner chamber",
          glossarySourceTerm: "camara interior",
          targetVariants: ["buong noi tam"],
          notes: ["Dung thuat ngu cua glossary"],
        }],
        matcherModel: buildEditorDerivedGlossaryModel({
          sourceLanguage: {
            code: "en",
            name: "English",
          },
          targetLanguage: {
            code: "vi",
            name: "Vietnamese",
          },
          glossaryId: "glossary-1",
          repoName: "glossary-1",
          title: "Glossary",
          entries: [{
            sourceTerm: "inner chamber",
            glossarySourceTerm: "camara interior",
            targetVariants: ["buong noi tam"],
            notes: ["Dung thuat ngu cua glossary"],
          }],
        }),
      },
    },
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
    if (command === "run_ai_translation") {
      assert.deepEqual(payload.request.glossaryHints, [{
        sourceTerm: "inner chamber",
        targetVariants: ["buong noi tam"],
        notes: ["Dung thuat ngu cua glossary"],
      }]);
      throw new Error("Provider timeout");
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await runEditorAiTranslate(() => {}, "translate1", {
    updateEditorRowFieldValue() {},
    async persistEditorRowOnBlur() {},
  });

  assert.deepEqual(
    invokeLog.map((entry) => entry.command),
    ["load_ai_provider_secret", "run_ai_translation"],
  );
  assert.equal(state.editorChapter.aiTranslate.translate1.status, "error");
  assert.equal(
    state.editorChapter.derivedGlossariesByRowId["row-1"]?.status,
    "ready",
  );
  assert.equal(
    state.editorChapter.derivedGlossariesByRowId["row-1"]?.entries?.[0]?.sourceTerm,
    "inner chamber",
  );
});

test("runEditorAiTranslate saves prepared glossary-source text when draft translation fails", async () => {
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

  let persistCount = 0;
  let persistedCommitMetadata = null;
  invokeHandler = async (command, payload = {}) => {
    if (command === "load_ai_provider_secret") {
      return "oa-key";
    }
    if (command === "prepare_editor_ai_translated_glossary") {
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
      throw new Error("Provider timeout");
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await runEditorAiTranslate(() => {}, "translate1", {
    updateEditorRowFieldValue(rowId, languageCode, nextValue) {
      const row = state.editorChapter.rows.find((entry) => entry.rowId === rowId);
      row.fields[languageCode] = nextValue;
      row.saveStatus = "dirty";
    },
    async persistEditorRowOnBlur(_render, rowId, options = {}) {
      persistCount += 1;
      persistedCommitMetadata = options?.commitMetadata ?? null;
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
  assert.equal(state.editorChapter.aiTranslate.translate1.status, "error");
  assert.equal(persistCount, 1);
  assert.deepEqual(persistedCommitMetadata, {
    operation: "ai-translation",
    aiModel: "gpt-5.4-mini",
  });
  assert.equal(state.editorChapter.rows[0].fields.es, "La camara interior brilla.");
  assert.equal(state.editorChapter.rows[0].persistedFields.es, "La camara interior brilla.");
  assert.equal(
    state.editorChapter.derivedGlossariesByRowId["row-1"]?.glossarySourceTextOrigin,
    "row",
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

test("runEditorAiTranslate issues and caches a shared team key before translating", async () => {
  installTranslateFixture();
  installSelectedTeam({ canDelete: false });
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

  const memberKeypair = await generateTeamAiMemberKeypair();
  const issuedWrappedKey = await encryptTeamAiPlaintext("sk-shared-issued", memberKeypair.publicKeyPem);
  let persistCount = 0;

  invokeHandler = async (command, payload = {}) => {
    if (command === "load_ai_provider_secret") {
      assert.equal(payload.installationId, 42);
      return null;
    }
    if (command === "load_team_ai_settings") {
      return null;
    }
    if (command === "load_team_ai_secrets_metadata") {
      return {
        schemaVersion: 1,
        updatedAt: null,
        updatedBy: "owner",
        providers: {
          openai: {
            configured: true,
            keyVersion: 7,
            algorithm: "rsa-oaep-sha256-v1",
          },
          gemini: null,
          claude: null,
          deepseek: null,
        },
      };
    }
    if (command === "load_team_ai_provider_cache") {
      return {
        apiKey: null,
        keyVersion: null,
      };
    }
    if (command === "load_team_ai_member_keypair") {
      return memberKeypair;
    }
    if (command === "issue_team_ai_provider_secret") {
      assert.equal(payload.providerId, "openai");
      assert.equal(payload.installationId, 42);
      assert.equal(payload.orgLogin, "team-one");
      return {
        providerId: "openai",
        keyVersion: 7,
        wrappedKey: issuedWrappedKey,
      };
    }
    if (command === "save_team_ai_provider_cache") {
      assert.deepEqual(payload, {
        installationId: 42,
        providerId: "openai",
        apiKey: "sk-shared-issued",
        keyVersion: 7,
      });
      return null;
    }
    if (command === "run_ai_translation") {
      assert.deepEqual(payload, {
        request: {
          providerId: "openai",
          modelId: "gpt-5.4-mini",
          text: "Hola",
          sourceLanguage: "Spanish",
          targetLanguage: "Vietnamese",
          installationId: 42,
        },
      });
      return {
        translatedText: "Xin chao tu team",
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

  assert.equal(persistCount, 0);
  assert.equal(state.editorChapter.rows[0].fields.vi, "Texto original");
  assert.equal(latestAssistantDraft()?.draftTranslationText, "Xin chao tu team");
  assert.equal(state.aiReviewMissingKeyModal.isOpen, false);
});

test("runEditorAiTranslate tells members to contact the owner when no shared team key exists", async () => {
  localStorageState.clear();
  installTranslateFixture();
  installSelectedTeam({
    canDelete: false,
    teamName: "Shared Team",
    installationId: 4152,
    login: "member-missing",
  });
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
      assert.equal(payload.installationId, 4152);
      return null;
    }
    if (command === "load_team_ai_settings") {
      return null;
    }
    if (command === "load_team_ai_secrets_metadata") {
      return {
        schemaVersion: 1,
        updatedAt: null,
        updatedBy: "owner",
        providers: {
          openai: null,
          gemini: null,
          claude: null,
          deepseek: null,
        },
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await runEditorAiTranslate(() => {}, "translate2", {
    updateEditorRowFieldValue() {},
    async persistEditorRowOnBlur() {},
  });

  assert.equal(state.aiReviewMissingKeyModal.isOpen, true);
  assert.equal(state.aiReviewMissingKeyModal.providerId, "deepseek");
  assert.equal(state.aiReviewMissingKeyModal.reason, "member_missing");
  assert.equal(state.aiReviewMissingKeyModal.teamName, "Shared Team");
});

test("assistant target history classifies import, AI, current user, and other user revisions", () => {
  assert.equal(
    authorLoginFromAssistantHistoryEntry({
      authorEmail: "12345+octocat@users.noreply.github.com",
    }),
    "octocat",
  );

  assert.deepEqual(
    classifyEditorAssistantTargetHistoryEntry({
      operationType: "import",
      authorName: "tester",
    }, "tester"),
    {
      sourceType: "file_import",
      sourceLabel: "file_import",
      authorType: "current_user",
    },
  );
  assert.deepEqual(
    classifyEditorAssistantTargetHistoryEntry({
      operationType: "ai-translation",
      aiModel: "gpt-5.4",
      authorName: "tester",
    }, "tester"),
    {
      sourceType: "ai_model",
      sourceLabel: "GPT 5.4",
      authorType: "current_user",
    },
  );
  assert.deepEqual(
    classifyEditorAssistantTargetHistoryEntry({
      operationType: "editor-update",
      authorEmail: "tester@users.noreply.github.com",
    }, "tester"),
    {
      sourceType: "current_user",
      sourceLabel: "current_user",
      authorType: "current_user",
    },
  );
  assert.deepEqual(
    classifyEditorAssistantTargetHistoryEntry({
      operationType: "editor-update",
      authorName: "another-editor",
    }, "tester"),
    {
      sourceType: "other_user",
      sourceLabel: "other_user",
      authorType: "other_user",
    },
  );
});

test("assistant target history is oldest-first and collapses an unsaved current user draft into the current-user run", () => {
  const history = buildEditorAssistantTargetLanguageHistory(
    [
      {
        authorName: "tester",
        authorEmail: "tester@users.noreply.github.com",
        operationType: "editor-update",
        plainText: "Human committed draft",
      },
      {
        authorName: "tester",
        authorEmail: "tester@users.noreply.github.com",
        operationType: "ai-translation",
        aiModel: "gpt-5.4",
        plainText: "AI draft",
      },
      {
        authorName: "tester",
        authorEmail: "tester@users.noreply.github.com",
        operationType: "import",
        plainText: "Imported draft",
      },
    ],
    { targetText: "Unsaved visible draft" },
    "tester",
  );

  assert.deepEqual(
    history.map((entry) => [entry.revisionNumber, entry.sourceType, entry.sourceLabel, entry.text]),
    [
      [1, "file_import", "file_import", "Imported draft"],
      [2, "ai_model", "GPT 5.4", "AI draft"],
      [3, "current_user", "current_user", "Unsaved visible draft"],
    ],
  );
  assert.equal(history[2].operationType, "working-draft");
});

test("assistant target history collapses contiguous provenance runs to the last edit", () => {
  const history = buildEditorAssistantTargetLanguageHistory(
    [
      {
        authorName: "bob",
        authorEmail: "bob@users.noreply.github.com",
        operationType: "editor-update",
        plainText: "Bob edit",
      },
      {
        authorName: "alice",
        authorEmail: "alice@users.noreply.github.com",
        operationType: "editor-update",
        plainText: "Alice second",
      },
      {
        authorName: "alice",
        authorEmail: "alice@users.noreply.github.com",
        operationType: "editor-update",
        plainText: "Alice first",
      },
      {
        authorName: "tester",
        authorEmail: "tester@users.noreply.github.com",
        operationType: "editor-update",
        plainText: "User second after AI",
      },
      {
        authorName: "tester",
        authorEmail: "tester@users.noreply.github.com",
        operationType: "editor-update",
        plainText: "User first after AI",
      },
      {
        authorName: "tester",
        authorEmail: "tester@users.noreply.github.com",
        operationType: "ai-review",
        aiModel: "gpt-5.4",
        plainText: "AI second",
      },
      {
        authorName: "tester",
        authorEmail: "tester@users.noreply.github.com",
        operationType: "ai-translation",
        aiModel: "gpt-5.4",
        plainText: "AI first",
      },
      {
        authorName: "tester",
        authorEmail: "tester@users.noreply.github.com",
        operationType: "editor-update",
        plainText: "User second before AI",
      },
      {
        authorName: "tester",
        authorEmail: "tester@users.noreply.github.com",
        operationType: "editor-update",
        plainText: "User first before AI",
      },
      {
        authorName: "tester",
        authorEmail: "tester@users.noreply.github.com",
        operationType: "import",
        plainText: "Imported draft",
      },
    ],
    { targetText: "Bob edit" },
    "tester",
  );

  assert.deepEqual(
    history.map((entry) => [
      entry.revisionNumber,
      entry.sourceType,
      entry.sourceLabel,
      entry.authorLogin,
      entry.operationType,
      entry.text,
    ]),
    [
      [1, "file_import", "file_import", "tester", "import", "Imported draft"],
      [2, "current_user", "current_user", "tester", "editor-update", "User second before AI"],
      [3, "ai_model", "GPT 5.4", "tester", "ai-review", "AI second"],
      [4, "current_user", "current_user", "tester", "editor-update", "User second after AI"],
      [5, "other_user", "other_user", "alice", "editor-update", "Alice second"],
      [6, "other_user", "other_user", "bob", "editor-update", "Bob edit"],
    ],
  );
});

test("runEditorAiAssistant renders a draft when a chat response includes draft translation text", async () => {
  installTranslateFixture({
    fields: {
      es: "Su mision es entregar metodos practicos.",
      vi: "Nhiem vu cua no la trao phuong phap thuc hanh.",
    },
  });
  state.editorChapter = {
    ...state.editorChapter,
    assistant: {
      ...state.editorChapter.assistant,
      composerDraft: "Please make the translation smoother.",
    },
  };
  state.aiSettings = {
    ...state.aiSettings,
    actionConfig: {
      ...state.aiSettings.actionConfig,
      detailedConfiguration: true,
      actions: {
        ...state.aiSettings.actionConfig.actions,
        discuss: {
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
    if (command === "run_ai_assistant_turn") {
      assert.equal(payload.request.kind, "chat");
      assert.equal(payload.request.userMessage, "Please make the translation smoother.");
      return {
        assistantText: "A smoother version:\n\nMot ban dich muot ma hon.",
        draftTranslationText: "Mot ban dich muot ma hon.",
        promptText: "prompt text",
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await runEditorAiAssistant(() => {});

  const draft = latestAssistantDraft();
  assert.equal(draft?.text, "A smoother version:");
  assert.equal(draft?.draftTranslationText, "Mot ban dich muot ma hon.");
  assert.equal(state.editorChapter.rows[0].fields.vi, "Nhiem vu cua no la trao phuong phap thuc hanh.");
});

test("runEditorAiAssistant sends loaded target-language history with the assistant request", async () => {
  installTranslateFixture({
    fields: {
      es: "Su mision es entregar metodos practicos.",
      vi: "Human committed draft",
    },
  });
  installSelectedTeam({ canDelete: true, login: "tester" });
  state.projects = [{
    id: "project-1",
    name: "repo-one",
    chapters: [{ id: "chapter-1" }],
  }];
  state.editorChapter = {
    ...state.editorChapter,
    assistant: {
      ...state.editorChapter.assistant,
      composerDraft: "Explain this translation choice.",
    },
  };
  state.aiSettings = {
    ...state.aiSettings,
    actionConfig: {
      ...state.aiSettings.actionConfig,
      detailedConfiguration: true,
      actions: {
        ...state.aiSettings.actionConfig.actions,
        discuss: {
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
    if (command === "load_team_ai_settings") {
      return null;
    }
    if (command === "load_team_ai_secrets_metadata") {
      return {
        schemaVersion: 1,
        updatedAt: null,
        updatedBy: null,
        providers: {
          openai: null,
          gemini: null,
          claude: null,
          deepseek: null,
        },
      };
    }
    if (command === "load_gtms_editor_field_history") {
      assert.equal(payload.input.installationId, 42);
      assert.equal(payload.input.projectId, "project-1");
      assert.equal(payload.input.repoName, "repo-one");
      assert.equal(payload.input.rowId, "row-1");
      assert.equal(payload.input.languageCode, "vi");
      return {
        entries: [
          {
            authorName: "tester",
            authorEmail: "tester@users.noreply.github.com",
            operationType: "editor-update",
            plainText: "Human committed draft",
          },
          {
            authorName: "tester",
            authorEmail: "tester@users.noreply.github.com",
            operationType: "ai-translation",
            aiModel: "gpt-5.4",
            plainText: "AI draft",
          },
          {
            authorName: "tester",
            authorEmail: "tester@users.noreply.github.com",
            operationType: "import",
            plainText: "Imported draft",
          },
        ],
      };
    }
    if (command === "run_ai_assistant_turn") {
      assert.deepEqual(
        payload.request.row.targetLanguageHistory.map((entry) => [
          entry.sourceType,
          entry.sourceLabel,
          entry.authorType,
          entry.text,
        ]),
        [
          ["file_import", "file_import", "current_user", "Imported draft"],
          ["ai_model", "GPT 5.4", "current_user", "AI draft"],
          ["current_user", "current_user", "current_user", "Human committed draft"],
        ],
      );
      return {
        assistantText: "The human edit changes the tone.",
        draftTranslationText: null,
        promptText: "prompt text",
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await runEditorAiAssistant(() => {});

  assert.equal(
    state.editorChapter.assistant.threadsByKey["row-1::es::vi"].items.at(-1)?.text,
    "The human edit changes the tone.",
  );
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

test("applyEditorAiReview does nothing when the suggestion matches the current translation", async () => {
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
      suggestedText: "Texto original",
    },
  };

  let updateCount = 0;
  let persistCount = 0;

  await applyEditorAiReview(() => {}, {
    updateEditorRowFieldValue() {
      updateCount += 1;
    },
    async persistEditorRowOnBlur() {
      persistCount += 1;
    },
  });

  assert.equal(updateCount, 0);
  assert.equal(persistCount, 0);
  assert.equal(state.editorChapter.rows[0].fields.vi, "Texto original");
  assert.equal(state.editorChapter.aiReview.status, "ready");
});

test("saveSelectedTeamAiProviderSecret wraps a shared key for the broker and caches the current version", async () => {
  resetSessionState();
  installSelectedTeam({ canDelete: true });

  const brokerKeypair = await generateTeamAiMemberKeypair();
  let savedWrappedKey = null;

  invokeHandler = async (command, payload = {}) => {
    if (command === "load_team_ai_broker_public_key") {
      return {
        algorithm: "rsa-oaep-sha256-v1",
        publicKeyPem: brokerKeypair.publicKeyPem,
      };
    }
    if (command === "save_team_ai_provider_secret") {
      savedWrappedKey = payload.wrappedKey;
      assert.equal(payload.installationId, 42);
      assert.equal(payload.orgLogin, "team-one");
      assert.equal(payload.providerId, "openai");
      assert.equal(payload.clear, false);
      return {
        schemaVersion: 1,
        updatedAt: null,
        updatedBy: "tester",
        providers: {
          openai: {
            configured: true,
            keyVersion: 4,
            algorithm: "rsa-oaep-sha256-v1",
          },
          gemini: null,
          claude: null,
          deepseek: null,
        },
      };
    }
    if (command === "save_team_ai_provider_cache") {
      assert.deepEqual(payload, {
        installationId: 42,
        providerId: "openai",
        apiKey: "sk-team-shared",
        keyVersion: 4,
      });
      return null;
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  const secrets = await saveSelectedTeamAiProviderSecret(
    () => {},
    "openai",
    "  sk-team-shared  ",
  );

  assert.equal(
    await decryptTeamAiWrappedKey(savedWrappedKey, brokerKeypair.privateKeyPem),
    "sk-team-shared",
  );
  assert.equal(secrets.providers.openai.keyVersion, 4);
});

test("saveSelectedTeamAiProviderSecret clears broker and local shared keys when the owner saves an empty value", async () => {
  resetSessionState();
  installSelectedTeam({ canDelete: true });
  state.aiSettings = {
    ...state.aiSettings,
    teamShared: {
      ...createTeamAiSharedState(),
      teamId: "team-1",
      status: "ready",
      isOwner: true,
      secrets: {
        schemaVersion: 1,
        updatedAt: "2026-04-16T12:00:00.000Z",
        updatedBy: "owner",
        providers: {
          openai: {
            configured: true,
            keyVersion: 4,
            algorithm: "rsa-oaep-sha256-v1",
          },
          gemini: null,
          claude: null,
          deepseek: null,
        },
      },
    },
  };

  invokeHandler = async (command, payload = {}) => {
    if (command === "save_team_ai_provider_secret") {
      assert.deepEqual(payload, {
        installationId: 42,
        orgLogin: "team-one",
        providerId: "openai",
        wrappedKey: null,
        clear: true,
        sessionToken: "broker-session",
      });
      return {
        schemaVersion: 1,
        updatedAt: null,
        updatedBy: null,
        providers: {},
      };
    }
    if (command === "clear_team_ai_provider_cache") {
      assert.deepEqual(payload, {
        installationId: 42,
        providerId: "openai",
      });
      return null;
    }
    if (command === "clear_ai_provider_secret") {
      assert.deepEqual(payload, {
        installationId: 42,
        providerId: "openai",
      });
      return null;
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  const secrets = await saveSelectedTeamAiProviderSecret(
    () => {},
    "openai",
    "   ",
  );

  assert.deepEqual(
    invokeLog.map((entry) => entry.command),
    [
      "save_team_ai_provider_secret",
      "clear_team_ai_provider_cache",
      "clear_ai_provider_secret",
    ],
  );
  assert.equal(state.aiSettings.teamShared.status, "ready");
  assert.equal(state.aiSettings.teamShared.isOwner, true);
  assert.equal(state.aiSettings.teamShared.secrets.providers.openai, null);
  assert.deepEqual(secrets.providers, {
    openai: null,
    gemini: null,
    claude: null,
    deepseek: null,
  });
});

test("loadSelectedTeamAiState falls back to the stored team snapshot when the broker is unavailable", async () => {
  resetSessionState();
  installSelectedTeam({ canDelete: false });

  invokeHandler = async (command) => {
    if (command === "load_team_ai_settings") {
      return {
        schemaVersion: 1,
        updatedAt: "2026-04-16T12:00:00.000Z",
        updatedBy: "owner",
        actionPreferences: {
          detailedConfiguration: false,
          unified: {
            providerId: "openai",
            modelId: "gpt-5.4-mini",
          },
          actions: {},
        },
      };
    }
    if (command === "load_team_ai_secrets_metadata") {
      return {
        schemaVersion: 1,
        updatedAt: "2026-04-16T12:00:00.000Z",
        updatedBy: "owner",
        providers: {
          openai: {
            configured: true,
            keyVersion: 5,
            algorithm: "rsa-oaep-sha256-v1",
          },
          gemini: null,
          claude: null,
          deepseek: null,
        },
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await loadSelectedTeamAiState(() => {});

  state.aiSettings = {
    ...state.aiSettings,
    teamShared: createTeamAiSharedState(),
  };
  invokeHandler = async (command) => {
    if (command === "load_team_ai_settings" || command === "load_team_ai_secrets_metadata") {
      throw new Error("Could not reach the GitHub App broker.");
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  const teamShared = await loadSelectedTeamAiState(() => {}, { force: true });

  assert.equal(teamShared.status, "ready");
  assert.equal(
    teamShared.error,
    "Could not reach the GitHub App broker. Using the last known team AI settings.",
  );
  assert.equal(teamShared.settings.actionPreferences.unified.providerId, "openai");
  assert.equal(teamShared.secrets.providers.openai.keyVersion, 5);
});

test("loadSelectedTeamAiState ignores stale responses after switching teams", async () => {
  resetSessionState();
  state.teams = [
    createTeamRecord({ teamId: "team-1", teamName: "Team One", githubOrg: "team-one", installationId: 42 }),
    createTeamRecord({ teamId: "team-2", teamName: "Team Two", githubOrg: "team-two", installationId: 84 }),
  ];
  state.selectedTeamId = "team-1";
  state.auth = {
    ...state.auth,
    session: {
      sessionToken: "broker-session",
      login: "tester",
      name: null,
      avatarUrl: null,
    },
  };
  setActiveStorageLogin("tester");

  const teamOneSettings = createDeferred();
  const teamOneSecrets = createDeferred();
  invokeHandler = async (command, payload = {}) => {
    if (command === "load_team_ai_settings") {
      if (payload.installationId === 42) {
        return teamOneSettings.promise;
      }
      return {
        schemaVersion: 1,
        updatedAt: "2026-04-21T12:00:00.000Z",
        updatedBy: "owner-2",
        actionPreferences: {
          detailedConfiguration: false,
          unified: {
            providerId: "openai",
            modelId: "gpt-5.4-mini",
          },
          actions: {},
        },
      };
    }
    if (command === "load_team_ai_secrets_metadata") {
      if (payload.installationId === 42) {
        return teamOneSecrets.promise;
      }
      return {
        schemaVersion: 1,
        updatedAt: "2026-04-21T12:00:00.000Z",
        updatedBy: "owner-2",
        providers: {
          openai: {
            configured: true,
            keyVersion: 8,
            algorithm: "rsa-oaep-sha256-v1",
          },
          gemini: null,
          claude: null,
          deepseek: null,
        },
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  const staleLoadPromise = loadSelectedTeamAiState(() => {}, { force: true });

  state.selectedTeamId = "team-2";
  const currentTeamShared = await loadSelectedTeamAiState(() => {}, { force: true });

  teamOneSettings.resolve({
    schemaVersion: 1,
    updatedAt: "2026-04-20T12:00:00.000Z",
    updatedBy: "owner-1",
    actionPreferences: {
      detailedConfiguration: false,
      unified: {
        providerId: "gemini",
        modelId: "gemini-3-flash-preview",
      },
      actions: {},
    },
  });
  teamOneSecrets.resolve({
    schemaVersion: 1,
    updatedAt: "2026-04-20T12:00:00.000Z",
    updatedBy: "owner-1",
    providers: {
      openai: null,
      gemini: {
        configured: true,
        keyVersion: 4,
        algorithm: "rsa-oaep-sha256-v1",
      },
      claude: null,
      deepseek: null,
    },
  });

  const staleResult = await staleLoadPromise;

  assert.equal(staleResult, null);
  assert.equal(currentTeamShared.teamId, "team-2");
  assert.equal(state.aiSettings.teamShared.teamId, "team-2");
  assert.equal(
    state.aiSettings.teamShared.settings.actionPreferences.unified.providerId,
    "openai",
  );
});

test("ensureSelectedTeamAiProviderReady reports a clear issue error when the broker is unavailable and no cached team key exists", async () => {
  resetSessionState();
  installSelectedTeam({ canDelete: false });

  invokeHandler = async (command) => {
    if (command === "load_team_ai_settings") {
      return null;
    }
    if (command === "load_team_ai_secrets_metadata") {
      return {
        schemaVersion: 1,
        updatedAt: null,
        updatedBy: "owner",
        providers: {
          openai: {
            configured: true,
            keyVersion: 7,
            algorithm: "rsa-oaep-sha256-v1",
          },
          gemini: null,
          claude: null,
          deepseek: null,
        },
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await loadSelectedTeamAiState(() => {});

  const memberKeypair = await generateTeamAiMemberKeypair();
  state.aiSettings = {
    ...state.aiSettings,
    teamShared: createTeamAiSharedState(),
  };
  invokeHandler = async (command, payload = {}) => {
    if (command === "load_ai_provider_secret") {
      assert.equal(payload.installationId, 42);
      return null;
    }
    if (command === "load_team_ai_settings" || command === "load_team_ai_secrets_metadata") {
      throw new Error("Could not reach the GitHub App broker.");
    }
    if (command === "load_team_ai_provider_cache") {
      return {
        apiKey: null,
        keyVersion: null,
      };
    }
    if (command === "load_team_ai_member_keypair") {
      return memberKeypair;
    }
    if (command === "issue_team_ai_provider_secret") {
      throw new Error("Could not reach the GitHub App broker.");
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await assert.rejects(
    () => ensureSelectedTeamAiProviderReady(() => {}, "openai"),
    /team ai key could not be issued right now/i,
  );
});

test("persistSelectedTeamAiActionPreferences does not overwrite the current team after switching teams", async () => {
  resetSessionState();
  state.teams = [
    createTeamRecord({ teamId: "team-1", teamName: "Team One", githubOrg: "team-one", installationId: 42, canDelete: true }),
    createTeamRecord({ teamId: "team-2", teamName: "Team Two", githubOrg: "team-two", installationId: 84, canDelete: true }),
  ];
  state.selectedTeamId = "team-1";
  state.auth = {
    ...state.auth,
    session: {
      sessionToken: "broker-session",
      login: "tester",
      name: null,
      avatarUrl: null,
    },
  };
  setActiveStorageLogin("tester");

  const saveSettings = createDeferred();
  invokeHandler = async (command, payload = {}) => {
    if (command === "save_team_ai_settings") {
      if (payload.installationId === 42) {
        return saveSettings.promise;
      }
      throw new Error(`Unexpected installation: ${payload.installationId}`);
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  const savePromise = persistSelectedTeamAiActionPreferences(() => {}, {
    detailedConfiguration: false,
    unified: {
      providerId: "openai",
      modelId: "gpt-5.4-mini",
    },
    actions: {},
  });

  assert.equal(state.aiSettings.teamShared.teamId, "team-1");
  assert.equal(state.aiSettings.teamShared.settingsSaveStatus, "saving");

  state.selectedTeamId = "team-2";
  state.aiSettings = {
    ...state.aiSettings,
    teamShared: {
      ...createTeamAiSharedState(),
      teamId: "team-2",
      status: "ready",
      isOwner: true,
      settings: {
        schemaVersion: 1,
        updatedAt: "2026-04-21T12:00:00.000Z",
        updatedBy: "owner-2",
        actionPreferences: {
          detailedConfiguration: false,
          unified: {
            providerId: "gemini",
            modelId: "gemini-3-flash-preview",
          },
          actions: {},
        },
      },
      settingsSaveStatus: "idle",
      settingsSaveError: "",
    },
  };

  saveSettings.resolve({
    schemaVersion: 1,
    updatedAt: "2026-04-21T12:30:00.000Z",
    updatedBy: "owner-1",
    actionPreferences: {
      detailedConfiguration: false,
      unified: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
      },
      actions: {},
    },
  });
  await savePromise;

  assert.equal(state.aiSettings.teamShared.teamId, "team-2");
  assert.equal(state.aiSettings.teamShared.settingsSaveStatus, "idle");
  assert.equal(
    state.aiSettings.teamShared.settings.actionPreferences.unified.providerId,
    "gemini",
  );
});

test("persistSelectedTeamAiActionPreferences clears the saving state after a successful save", async () => {
  resetSessionState();
  state.teams = [
    createTeamRecord({ teamId: "team-1", teamName: "Team One", githubOrg: "team-one", installationId: 42, canDelete: true }),
  ];
  state.selectedTeamId = "team-1";
  state.auth = {
    ...state.auth,
    session: {
      sessionToken: "broker-session",
      login: "tester",
      name: null,
      avatarUrl: null,
    },
  };
  setActiveStorageLogin("tester");
  state.aiSettings = {
    ...state.aiSettings,
    teamShared: {
      ...createTeamAiSharedState(),
      teamId: "team-1",
      status: "ready",
      isOwner: true,
    },
  };

  invokeHandler = async (command, payload = {}) => {
    if (command === "save_team_ai_settings") {
      assert.equal(payload.installationId, 42);
      return {
        schemaVersion: 1,
        updatedAt: "2026-04-25T12:00:00.000Z",
        updatedBy: "owner-1",
        actionPreferences: payload.actionPreferences,
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await persistSelectedTeamAiActionPreferences(() => {}, {
    detailedConfiguration: false,
    unified: {
      providerId: "openai",
      modelId: "gpt-5.4-mini",
    },
    actions: {},
  });

  assert.equal(state.aiSettings.teamShared.settingsSaveStatus, "idle");
  assert.equal(state.aiSettings.teamShared.settingsSaveError, "");
  assert.equal(aiActionControlsAreBusy(state.aiSettings), false);
});

test("ensureSelectedTeamAiProviderReady clears team AI caches when team access is lost", async () => {
  resetSessionState();
  installSelectedTeam({ canDelete: false });

  const memberKeypair = await generateTeamAiMemberKeypair();
  const clearedProviderIds = [];

  invokeHandler = async (command, payload = {}) => {
    if (command === "load_ai_provider_secret") {
      assert.equal(payload.installationId, 42);
      return null;
    }
    if (command === "load_team_ai_settings") {
      return null;
    }
    if (command === "load_team_ai_secrets_metadata") {
      return {
        schemaVersion: 1,
        updatedAt: null,
        updatedBy: "owner",
        providers: {
          openai: {
            configured: true,
            keyVersion: 7,
            algorithm: "rsa-oaep-sha256-v1",
          },
          gemini: null,
          claude: null,
          deepseek: null,
        },
      };
    }
    if (command === "load_team_ai_provider_cache") {
      return {
        apiKey: null,
        keyVersion: null,
      };
    }
    if (command === "load_team_ai_member_keypair") {
      return memberKeypair;
    }
    if (command === "issue_team_ai_provider_secret") {
      throw Object.assign(new Error("You no longer have access to this team."), {
        status: 403,
      });
    }
    if (command === "clear_team_ai_provider_cache") {
      clearedProviderIds.push(payload.providerId);
      assert.equal(payload.installationId, 42);
      return null;
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await assert.rejects(
    () => ensureSelectedTeamAiProviderReady(() => {}, "openai"),
    /no longer have access to this team/i,
  );

  assert.deepEqual(
    [...clearedProviderIds].sort(),
    ["claude", "deepseek", "gemini", "openai"],
  );
  assert.equal(state.aiSettings.teamShared.status, "error");
  assert.match(state.aiSettings.teamShared.error, /no longer have access to this team/i);
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
      return [
        { id: "gpt-5.4", label: "gpt-5.4" },
        { id: "gpt-5.4-mini", label: "gpt-5.4-mini" },
      ];
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
    providerId: "openai",
    apiKey: "  sk-updated  ",
  });
  assert.equal(state.aiSettings.status, "ready");
  assert.equal(state.aiSettings.apiKey, "sk-updated");
  assert.equal(state.aiSettings.successMessage, "OpenAI key saved.");
  assert.deepEqual(
    state.aiSettings.actionConfig.modelOptionsByProvider.openai.options,
    [
      { id: "gpt-5.4", label: "gpt-5.4" },
      { id: "gpt-5.4-mini", label: "gpt-5.4-mini" },
    ],
  );

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

test("AI Settings defaults to OpenAI, lists Gemini last, and recommends OpenAI", () => {
  resetSessionState();
  assert.equal(DEFAULT_AI_PROVIDER_ID, "openai");
  assert.deepEqual(AI_PROVIDER_IDS, ["openai", "claude", "deepseek", "gemini"]);
  assert.equal(state.aiSettings.providerId, "openai");
  assert.match(
    readFileSync(new URL("../screens/ai-key.js", import.meta.url), "utf8"),
    /recommend OpenAI/i,
  );
});

test("saveAiProviderSecret initializes shared team action preferences for the saved provider", async () => {
  resetSessionState();
  installSelectedTeam({ canDelete: true });
  state.screen = "aiKey";

  const brokerKeypair = await generateTeamAiMemberKeypair();
  let cachedTeamApiKey = null;
  const savedTeamSettingsPayloads = [];

  invokeHandler = async (command, payload = {}) => {
    if (command === "load_team_ai_broker_public_key") {
      return {
        algorithm: "rsa-oaep-sha256-v1",
        publicKeyPem: brokerKeypair.publicKeyPem,
      };
    }
    if (command === "save_team_ai_provider_secret") {
      return {
        schemaVersion: 1,
        updatedAt: null,
        updatedBy: "owner",
        providers: {
          openai: {
            configured: true,
            keyVersion: 4,
            algorithm: "rsa-oaep-sha256-v1",
          },
          gemini: null,
          claude: null,
          deepseek: null,
        },
      };
    }
    if (command === "save_team_ai_provider_cache") {
      cachedTeamApiKey = payload.apiKey;
      return null;
    }
    if (command === "load_team_ai_settings") {
      return null;
    }
    if (command === "load_team_ai_secrets_metadata") {
      return {
        schemaVersion: 1,
        updatedAt: null,
        updatedBy: "owner",
        providers: {
          openai: {
            configured: true,
            keyVersion: 4,
            algorithm: "rsa-oaep-sha256-v1",
          },
          gemini: null,
          claude: null,
          deepseek: null,
        },
      };
    }
    if (command === "load_ai_provider_secret") {
      assert.equal(payload.installationId, 42);
      return cachedTeamApiKey;
    }
    if (command === "load_team_ai_provider_cache") {
      return {
        apiKey: cachedTeamApiKey,
        keyVersion: 4,
      };
    }
    if (command === "list_ai_provider_models") {
      return [
        { id: "gpt-5.4", label: "gpt-5.4" },
        { id: "gpt-5.4-mini", label: "gpt-5.4-mini" },
      ];
    }
    if (command === "save_team_ai_settings") {
      savedTeamSettingsPayloads.push(payload);
      return {
        schemaVersion: 1,
        updatedAt: "2026-04-16T12:00:00.000Z",
        updatedBy: "owner",
        actionPreferences: payload.actionPreferences,
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  updateAiProviderSecretDraft("  sk-team-openai  ");
  await saveAiProviderSecret(() => {});
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(state.aiSettings.providerId, "openai");
  assert.equal(state.aiSettings.successMessage, "OpenAI key saved.");
  assert.ok(savedTeamSettingsPayloads.length >= 1);
  assert.equal(savedTeamSettingsPayloads[0].actionPreferences.unified.providerId, "openai");
  assert.equal(savedTeamSettingsPayloads[0].actionPreferences.unified.modelId, "gpt-5.4");
});

test("ensureSharedAiActionConfigurationLoaded applies the saved team action preferences", async () => {
  resetSessionState();
  installSelectedTeam({ canDelete: false });
  state.aiSettings = {
    ...state.aiSettings,
    actionConfig: {
      ...state.aiSettings.actionConfig,
      unified: {
        providerId: "gemini",
        modelId: "gemini-3-flash-preview",
      },
    },
  };

  invokeHandler = async (command) => {
    if (command === "load_team_ai_settings") {
      return {
        schemaVersion: 1,
        updatedAt: "2026-04-16T12:00:00.000Z",
        updatedBy: "owner",
        actionPreferences: {
          detailedConfiguration: false,
          unified: {
            providerId: "openai",
            modelId: "gpt-5.4-mini",
          },
          actions: {},
        },
      };
    }
    if (command === "load_team_ai_secrets_metadata") {
      return {
        schemaVersion: 1,
        updatedAt: "2026-04-16T12:00:00.000Z",
        updatedBy: "owner",
        providers: {
          openai: {
            configured: true,
            keyVersion: 5,
            algorithm: "rsa-oaep-sha256-v1",
          },
          gemini: null,
          claude: null,
          deepseek: null,
        },
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await ensureSharedAiActionConfigurationLoaded(() => {});

  assert.equal(state.aiSettings.actionConfig.unified.providerId, "openai");
  assert.equal(state.aiSettings.actionConfig.unified.modelId, "gpt-5.4-mini");
});

test("ensureSharedAiActionConfigurationLoaded refreshes a stale ready team state", async () => {
  resetSessionState();
  installSelectedTeam({ canDelete: false });
  state.aiSettings = {
    ...state.aiSettings,
    teamShared: {
      ...createTeamAiSharedState(),
      teamId: "team-1",
      status: "ready",
      isOwner: false,
      settings: {
        schemaVersion: 1,
        updatedAt: "2026-04-15T12:00:00.000Z",
        updatedBy: "owner",
        actionPreferences: {
          detailedConfiguration: false,
          unified: {
            providerId: "gemini",
            modelId: "gemini-3-flash-preview",
          },
          actions: {},
        },
      },
      secrets: {
        schemaVersion: 1,
        updatedAt: "2026-04-15T12:00:00.000Z",
        updatedBy: "owner",
        providers: {
          openai: null,
          gemini: {
            configured: true,
            keyVersion: 4,
            algorithm: "rsa-oaep-sha256-v1",
          },
          claude: null,
          deepseek: null,
        },
      },
    },
    actionConfig: {
      ...state.aiSettings.actionConfig,
      unified: {
        providerId: "gemini",
        modelId: "gemini-3-flash-preview",
      },
    },
  };

  let loadSettingsCalls = 0;
  invokeHandler = async (command) => {
    if (command === "load_team_ai_settings") {
      loadSettingsCalls += 1;
      return {
        schemaVersion: 1,
        updatedAt: "2026-04-16T12:00:00.000Z",
        updatedBy: "owner",
        actionPreferences: {
          detailedConfiguration: false,
          unified: {
            providerId: "openai",
            modelId: "gpt-5.4-mini",
          },
          actions: {},
        },
      };
    }
    if (command === "load_team_ai_secrets_metadata") {
      return {
        schemaVersion: 1,
        updatedAt: "2026-04-16T12:00:00.000Z",
        updatedBy: "owner",
        providers: {
          openai: {
            configured: true,
            keyVersion: 5,
            algorithm: "rsa-oaep-sha256-v1",
          },
          gemini: null,
          claude: null,
          deepseek: null,
        },
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await ensureSharedAiActionConfigurationLoaded(() => {});

  assert.equal(loadSettingsCalls, 1);
  assert.equal(state.aiSettings.actionConfig.unified.providerId, "openai");
  assert.equal(state.aiSettings.actionConfig.unified.modelId, "gpt-5.4-mini");
  assert.equal(state.aiSettings.teamShared.settings.actionPreferences.unified.providerId, "openai");
});

test("ensureSharedAiActionConfigurationLoaded persists the loaded team action preferences", async () => {
  resetSessionState();
  installSelectedTeam({ canDelete: false, login: "tester" });
  state.aiSettings = {
    ...state.aiSettings,
    actionConfig: {
      ...state.aiSettings.actionConfig,
      unified: {
        providerId: "gemini",
        modelId: "gemini-3-flash-preview",
      },
    },
  };

  invokeHandler = async (command) => {
    if (command === "load_team_ai_settings") {
      return {
        schemaVersion: 1,
        updatedAt: "2026-04-16T12:00:00.000Z",
        updatedBy: "owner",
        actionPreferences: {
          detailedConfiguration: false,
          unified: {
            providerId: "openai",
            modelId: "gpt-5.4-mini",
          },
          actions: {},
        },
      };
    }
    if (command === "load_team_ai_secrets_metadata") {
      return {
        schemaVersion: 1,
        updatedAt: "2026-04-16T12:00:00.000Z",
        updatedBy: "owner",
        providers: {
          openai: {
            configured: true,
            keyVersion: 5,
            algorithm: "rsa-oaep-sha256-v1",
          },
          gemini: null,
          claude: null,
          deepseek: null,
        },
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await ensureSharedAiActionConfigurationLoaded(() => {});

  const storedTeamPreferences = loadStoredTeamAiActionPreferences("tester", 42);
  assert.equal(storedTeamPreferences.unified.providerId, "openai");
  assert.equal(storedTeamPreferences.unified.modelId, "gpt-5.4-mini");
});

test("applyStoredSelectedTeamAiActionPreferences prefers the team-scoped selection over the generic selection", () => {
  resetSessionState();
  installSelectedTeam({ canDelete: false, login: "tester" });
  saveStoredAiActionPreferences({
    detailedConfiguration: false,
    unified: {
      providerId: "gemini",
      modelId: "gemini-3-flash-preview",
    },
    actions: {},
  }, "tester", null);
  saveStoredAiActionPreferences({
    detailedConfiguration: false,
    unified: {
      providerId: "openai",
      modelId: "gpt-5.4-mini",
    },
    actions: {},
  }, "tester", 42);

  state.aiSettings = {
    ...state.aiSettings,
    actionConfig: {
      ...state.aiSettings.actionConfig,
      unified: {
        providerId: "gemini",
        modelId: "gemini-3-flash-preview",
      },
    },
  };

  const applied = applyStoredSelectedTeamAiActionPreferences(() => {});

  assert.equal(applied, true);
  assert.equal(state.aiSettings.actionConfig.unified.providerId, "openai");
  assert.equal(state.aiSettings.actionConfig.unified.modelId, "gpt-5.4-mini");
});

test("loadSelectedChapterEditorData refreshes shared team action preferences while opening the editor", async () => {
  resetSessionState();
  installSelectedTeam({ canDelete: false, login: "tester" });
  state.screen = "translate";
  state.selectedProjectId = "project-1";
  state.selectedChapterId = "chapter-1";
  state.projects = [{
    id: "project-1",
    name: "Project One",
    chapters: [{
      id: "chapter-1",
      name: "Chapter One",
      selectedSourceLanguageCode: "es",
      selectedTargetLanguageCode: "vi",
      languages: [
        { code: "es", name: "Spanish" },
        { code: "vi", name: "Vietnamese" },
      ],
      linkedGlossary: null,
    }],
  }];
  state.aiSettings = {
    ...state.aiSettings,
    actionConfig: {
      ...state.aiSettings.actionConfig,
      unified: {
        providerId: "gemini",
        modelId: "gemini-3-flash-preview",
      },
    },
  };

  invokeHandler = async (command) => {
    if (command === "load_gtms_chapter_editor_data") {
      return {
        chapterId: "chapter-1",
        fileTitle: "Chapter One",
        languages: [
          { code: "es", name: "Spanish" },
          { code: "vi", name: "Vietnamese" },
        ],
        selectedSourceLanguageCode: "es",
        selectedTargetLanguageCode: "vi",
        sourceWordCounts: { es: 1 },
        rows: [{
          rowId: "row-1",
          fields: {
            es: "Hola",
            vi: "",
          },
          fieldStates: {},
        }],
      };
    }
    if (command === "load_team_ai_settings") {
      return {
        schemaVersion: 1,
        updatedAt: "2026-04-16T12:00:00.000Z",
        updatedBy: "owner",
        actionPreferences: {
          detailedConfiguration: false,
          unified: {
            providerId: "openai",
            modelId: "gpt-5.4-mini",
          },
          actions: {},
        },
      };
    }
    if (command === "load_team_ai_secrets_metadata") {
      return {
        schemaVersion: 1,
        updatedAt: "2026-04-16T12:00:00.000Z",
        updatedBy: "owner",
        providers: {
          openai: {
            configured: true,
            keyVersion: 5,
            algorithm: "rsa-oaep-sha256-v1",
          },
          gemini: null,
          claude: null,
          deepseek: null,
        },
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await loadSelectedChapterEditorDataFlow(() => {}, {}, {
    applyEditorUiState,
    normalizeEditorRows,
    applyChapterMetadataToState() {},
    loadActiveEditorFieldHistory() {},
    async flushDirtyEditorRows() {
      return true;
    },
    persistEditorChapterSelections() {},
  });
  await Promise.resolve();

  assert.equal(state.aiSettings.actionConfig.unified.providerId, "openai");
  assert.equal(state.aiSettings.actionConfig.unified.modelId, "gpt-5.4-mini");
  assert.equal(
    invokeLog.some((entry) => entry.command === "load_team_ai_settings"),
    true,
  );
});

test("loadAiSettingsPage refreshes a stale ready team state", async () => {
  resetSessionState();
  installSelectedTeam({ canDelete: false });
  state.aiSettings = {
    ...state.aiSettings,
    providerId: "gemini",
    teamShared: {
      ...createTeamAiSharedState(),
      teamId: "team-1",
      status: "ready",
      isOwner: false,
      settings: {
        schemaVersion: 1,
        updatedAt: "2026-04-15T12:00:00.000Z",
        updatedBy: "owner",
        actionPreferences: {
          detailedConfiguration: false,
          unified: {
            providerId: "gemini",
            modelId: "gemini-3-flash-preview",
          },
          actions: {},
        },
      },
      secrets: {
        schemaVersion: 1,
        updatedAt: "2026-04-15T12:00:00.000Z",
        updatedBy: "owner",
        providers: {
          openai: null,
          gemini: {
            configured: true,
            keyVersion: 4,
            algorithm: "rsa-oaep-sha256-v1",
          },
          claude: null,
          deepseek: null,
        },
      },
    },
    actionConfig: {
      ...state.aiSettings.actionConfig,
      unified: {
        providerId: "gemini",
        modelId: "gemini-3-flash-preview",
      },
      savedProviderIds: ["gemini"],
      modelOptionsByProvider: {
        ...state.aiSettings.actionConfig.modelOptionsByProvider,
        gemini: {
          status: "ready",
          error: "",
          options: [{ id: "gemini-3-flash-preview", label: "gemini-3-flash-preview" }],
          hasLoaded: true,
        },
      },
    },
  };

  let loadSettingsCalls = 0;
  invokeHandler = async (command, payload = {}) => {
    if (command === "load_team_ai_settings") {
      loadSettingsCalls += 1;
      return {
        schemaVersion: 1,
        updatedAt: "2026-04-16T12:00:00.000Z",
        updatedBy: "owner",
        actionPreferences: {
          detailedConfiguration: false,
          unified: {
            providerId: "openai",
            modelId: "gpt-5.4-mini",
          },
          actions: {},
        },
      };
    }
    if (command === "load_team_ai_secrets_metadata") {
      return {
        schemaVersion: 1,
        updatedAt: "2026-04-16T12:00:00.000Z",
        updatedBy: "owner",
        providers: {
          openai: {
            configured: true,
            keyVersion: 5,
            algorithm: "rsa-oaep-sha256-v1",
          },
          gemini: null,
          claude: null,
          deepseek: null,
        },
      };
    }
    if (command === "load_ai_provider_secret") {
      assert.equal(payload.installationId, 42);
      return null;
    }
    if (command === "load_team_ai_provider_cache") {
      return {
        apiKey: "sk-shared-openai",
        keyVersion: 5,
      };
    }
    if (command === "list_ai_provider_models") {
      return [
        { id: "gpt-5.4-mini", label: "gpt-5.4-mini" },
      ];
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await loadAiSettingsPage(() => {});

  assert.equal(loadSettingsCalls, 1);
  assert.equal(state.aiSettings.actionConfig.unified.providerId, "openai");
  assert.equal(state.aiSettings.actionConfig.unified.modelId, "gpt-5.4-mini");
  assert.deepEqual(state.aiSettings.actionConfig.savedProviderIds, ["openai"]);
});

test("loadAiProviderSecret ignores stale responses after switching teams", async () => {
  resetSessionState();
  state.screen = "aiKey";
  state.teams = [
    createTeamRecord({ teamId: "team-1", teamName: "Team One", githubOrg: "team-one", installationId: 42 }),
    createTeamRecord({ teamId: "team-2", teamName: "Team Two", githubOrg: "team-two", installationId: 84 }),
  ];
  state.selectedTeamId = "team-1";
  state.auth = {
    ...state.auth,
    session: {
      sessionToken: "broker-session",
      login: "tester",
      name: null,
      avatarUrl: null,
    },
  };
  setActiveStorageLogin("tester");

  const teamOneSecret = createDeferred();
  invokeHandler = async (command, payload = {}) => {
    if (command === "load_ai_provider_secret") {
      if (payload.installationId === 42) {
        return teamOneSecret.promise;
      }
      if (payload.installationId === 84) {
        return "team-2-secret";
      }
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  const staleLoadPromise = loadAiProviderSecret(() => {}, { providerId: "openai" });

  state.selectedTeamId = "team-2";
  await loadAiProviderSecret(() => {}, { providerId: "openai" });

  teamOneSecret.resolve("team-1-secret");
  await staleLoadPromise;

  assert.equal(state.selectedTeamId, "team-2");
  assert.equal(state.aiSettings.apiKey, "team-2-secret");
});

test("runEditorAiReview loads shared team action preferences before choosing the provider", async () => {
  installTranslateFixture();
  installSelectedTeam({ canDelete: false });
  state.aiSettings = {
    ...state.aiSettings,
    actionConfig: {
      ...state.aiSettings.actionConfig,
      unified: {
        providerId: "gemini",
        modelId: "gemini-3-flash-preview",
      },
    },
  };

  invokeHandler = async (command, payload = {}) => {
    if (command === "load_team_ai_settings") {
      return {
        schemaVersion: 1,
        updatedAt: "2026-04-16T12:00:00.000Z",
        updatedBy: "owner",
        actionPreferences: {
          detailedConfiguration: false,
          unified: {
            providerId: "openai",
            modelId: "gpt-5.4-mini",
          },
          actions: {},
        },
      };
    }
    if (command === "load_team_ai_secrets_metadata") {
      return {
        schemaVersion: 1,
        updatedAt: "2026-04-16T12:00:00.000Z",
        updatedBy: "owner",
        providers: {
          openai: {
            configured: true,
            keyVersion: 5,
            algorithm: "rsa-oaep-sha256-v1",
          },
          gemini: null,
          claude: null,
          deepseek: null,
        },
      };
    }
    if (command === "load_ai_provider_secret") {
      assert.equal(payload.installationId, 42);
      return null;
    }
    if (command === "load_team_ai_provider_cache") {
      return {
        apiKey: "sk-shared-openai",
        keyVersion: 5,
      };
    }
    if (command === "run_ai_review") {
      assert.deepEqual(payload, {
        request: {
          providerId: "openai",
          modelId: "gpt-5.4-mini",
          text: "Texto original",
          languageCode: "vi",
          installationId: 42,
        },
      });
      return {
        suggestedText: "Texto revisado",
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await runEditorAiReview(() => {});

  assert.equal(state.aiSettings.actionConfig.unified.providerId, "openai");
  assert.equal(state.aiSettings.actionConfig.unified.modelId, "gpt-5.4-mini");
  assert.equal(state.editorChapter.aiReview.status, "ready");
});

test("runEditorAiTranslate does not silently keep a stale local provider when member shared settings fail to load", async () => {
  localStorageState.clear();
  installTranslateFixture();
  installSelectedTeam({
    canDelete: false,
    installationId: 4134,
    login: "member-shared-error",
  });
  state.aiSettings = {
    ...state.aiSettings,
    actionConfig: {
      ...state.aiSettings.actionConfig,
      unified: {
        providerId: "gemini",
        modelId: "gemini-3-flash-preview",
      },
    },
  };

  invokeHandler = async (command) => {
    if (command === "load_team_ai_settings") {
      throw new Error("Could not load the team AI settings.");
    }
    if (command === "load_team_ai_secrets_metadata") {
      return {
        schemaVersion: 1,
        updatedAt: "2026-04-16T12:00:00.000Z",
        updatedBy: "owner",
        providers: {
          openai: {
            configured: true,
            keyVersion: 5,
            algorithm: "rsa-oaep-sha256-v1",
          },
          gemini: null,
          claude: null,
          deepseek: null,
        },
      };
    }
    if (command === "run_ai_translation") {
      throw new Error("run_ai_translation should not be called");
    }
    if (command === "load_ai_provider_secret" || command === "load_team_ai_provider_cache") {
      throw new Error(`${command} should not be called`);
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await runEditorAiTranslate(() => {}, "translate1", {
    updateEditorRowFieldValue() {},
    async persistEditorRowOnBlur() {},
  });

  assert.equal(state.editorChapter.aiTranslate.translate1.status, "error");
  assert.match(
    state.editorChapter.aiTranslate.translate1.error,
    /could not load the team ai settings/i,
  );
  assert.equal(
    invokeLog.some((entry) => entry.command === "run_ai_translation"),
    false,
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

test("AI action preferences are scoped per team installation", () => {
  saveStoredAiActionPreferences({
    detailedConfiguration: false,
    unified: {
      providerId: "openai",
      modelId: "gpt-5.4-mini",
    },
    actions: {},
  }, "tester", 101);

  saveStoredAiActionPreferences({
    detailedConfiguration: false,
    unified: {
      providerId: "gemini",
      modelId: "gemini-2.5-flash",
    },
    actions: {},
  }, "tester", 202);

  assert.equal(
    loadStoredAiActionPreferences("tester", 101).unified.providerId,
    "openai",
  );
  assert.equal(
    loadStoredAiActionPreferences("tester", 202).unified.providerId,
    "gemini",
  );
});

test("updateAiActionModel redirects Gemini Pro selections to the newest flash model and opens the rate-limit warning modal on failure", async () => {
  resetSessionState();
  state.aiSettings = {
    ...state.aiSettings,
    actionConfig: {
      ...state.aiSettings.actionConfig,
      savedProviderIds: ["gemini"],
      unified: {
        providerId: "gemini",
        modelId: "gemini-2.5-flash",
      },
      modelOptionsByProvider: {
        ...state.aiSettings.actionConfig.modelOptionsByProvider,
        gemini: {
          status: "ready",
          error: "",
          options: [
            { id: "gemini-2.5-pro", label: "gemini-2.5-pro" },
            { id: "gemini-3-pro-preview", label: "gemini-3-pro-preview" },
            { id: "gemini-2.5-flash", label: "gemini-2.5-flash" },
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
          modelId: "gemini-3-flash-preview",
        },
      });
      throw new Error("Resource has been exhausted (e.g. check quota).");
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await updateAiActionModel(() => {}, "unified", "gemini-3-pro-preview");

  assert.equal(state.aiSettings.actionConfig.unified.modelId, "gemini-3-flash-preview");
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

test("AI action controls stay disabled with a badge while model validation is running", async () => {
  resetSessionState();
  state.screen = "aiKey";
  state.aiSettings = {
    ...state.aiSettings,
    actionConfig: {
      ...state.aiSettings.actionConfig,
      savedProviderIds: ["openai", "gemini"],
      unified: {
        providerId: "openai",
        modelId: "gpt-5.4",
      },
      modelOptionsByProvider: {
        ...state.aiSettings.actionConfig.modelOptionsByProvider,
        openai: {
          status: "ready",
          error: "",
          options: [{ id: "gpt-5.4", label: "gpt-5.4" }],
          hasLoaded: true,
        },
        gemini: {
          status: "ready",
          error: "",
          options: [{ id: "gemini-3-flash-preview", label: "gemini-3-flash-preview" }],
          hasLoaded: true,
        },
      },
    },
  };

  let resolveProbe = null;
  invokeHandler = async (command) => {
    if (command === "probe_ai_provider_model") {
      return new Promise((resolve) => {
        resolveProbe = resolve;
      });
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  const validationPromise = updateAiActionModel(() => {}, "unified", "gpt-5.4");
  assert.equal(state.aiSettings.modelValidationStatus, "loading");
  assert.equal(aiActionControlsAreBusy(state.aiSettings), true);
  assert.equal(
    getAiActionControlsBusyMessage(state.aiSettings),
    "Checking the selected OpenAI model...",
  );

  updateAiActionProvider(() => {}, "unified", "gemini");
  assert.equal(state.aiSettings.actionConfig.unified.providerId, "openai");

  resolveProbe?.(null);
  await validationPromise;

  updateAiActionProvider(() => {}, "unified", "gemini");
  assert.equal(state.aiSettings.actionConfig.unified.providerId, "gemini");
});

test("AI action controls stay disabled with a badge while provider models are loading", async () => {
  resetSessionState();
  state.screen = "aiKey";
  state.aiSettings = {
    ...state.aiSettings,
    actionConfig: {
      ...state.aiSettings.actionConfig,
      savedProviderIds: ["openai", "gemini"],
      unified: {
        providerId: "openai",
        modelId: "gpt-5.4",
      },
      modelOptionsByProvider: {
        ...state.aiSettings.actionConfig.modelOptionsByProvider,
        openai: {
          status: "ready",
          error: "",
          options: [{ id: "gpt-5.4", label: "gpt-5.4" }],
          hasLoaded: true,
        },
        gemini: {
          status: "idle",
          error: "",
          options: [],
          hasLoaded: false,
        },
      },
    },
  };

  let modelsPromise = null;
  let resolveModels = null;
  invokeHandler = (command) => {
    if (command === "list_ai_provider_models") {
      modelsPromise = new Promise((resolve) => {
        resolveModels = resolve;
      });
      return modelsPromise;
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  updateAiActionProvider(() => {}, "unified", "gemini");

  assert.deepEqual(state.aiSettings.actionMenuLoadingProviderIds, ["gemini"]);
  assert.equal(aiActionControlsAreBusy(state.aiSettings), true);
  assert.equal(
    getAiActionControlsBusyMessage(state.aiSettings),
    "Loading Gemini models...",
  );

  resolveModels?.([{ id: "gemini-3-flash-preview", label: "gemini-3-flash-preview" }]);
  await modelsPromise;
  await Promise.resolve();

  assert.equal(state.aiSettings.actionMenuLoadingProviderIds.length, 0);
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

test("pickPreferredAiModelId keeps Gemini selections on the newest non-Pro family models", () => {
  const options = [
    { id: "gemini-2.5-pro", label: "gemini-2.5-pro" },
    { id: "gemini-3-pro-preview", label: "gemini-3-pro-preview" },
    { id: "gemini-2.5-flash", label: "gemini-2.5-flash" },
    { id: "gemini-3-flash-preview", label: "gemini-3-flash-preview" },
    { id: "gemini-2.5-flash-lite", label: "gemini-2.5-flash-lite" },
    {
      id: "gemini-2.5-flash-lite-preview-09-2025",
      label: "gemini-2.5-flash-lite-preview-09-2025",
    },
  ];

  assert.equal(
    pickPreferredAiModelId("gemini", options, "gemini-2.5-pro"),
    "gemini-3-flash-preview",
  );
  assert.equal(
    pickPreferredAiModelId("gemini", options, "gemini-2.5-flash-lite"),
    "gemini-2.5-flash-lite-preview-09-2025",
  );
  assert.equal(
    pickPreferredAiModelId("gemini", options, "gemini-3-flash-preview"),
    "gemini-3-flash-preview",
  );
  assert.equal(
    pickPreferredAiModelId("gemini", options),
    "gemini-3-flash-preview",
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

test("AI review visibility treats unchanged suggestions as looks good instead of actionable", () => {
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
        suggestedText: "Texto original",
      },
    },
    "row-1",
    "vi",
    "Texto original",
  );

  assert.equal(visible.isStale, false);
  assert.equal(visible.showSuggestion, false);
  assert.equal(visible.showLooksGoodMessage, true);
  assert.equal(visible.showReviewNow, false);
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
