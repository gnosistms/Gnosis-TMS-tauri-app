import test from "node:test";
import assert from "node:assert/strict";

let invokeHandler = async () => null;

globalThis.document = {
  testScrollList: null,
  querySelector(selector) {
    return selector === "[data-project-add-translation-language-list]"
      ? this.testScrollList
      : null;
  },
  querySelectorAll() {
    return [];
  },
};

globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async (...args) => invokeHandler(...args),
    },
    event: {
      listen: async () => () => {},
    },
  },
  localStorage: null,
  open() {},
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame(callback) {
    callback?.();
    return 1;
  },
};

globalThis.requestAnimationFrame = (callback) => {
  callback?.();
  return 1;
};

const {
  continueProjectAddTranslationLanguage,
  selectProjectAddTranslationLanguage,
} = await import("./project-add-translation-flow.js");
const {
  createAiSettingsState,
  createProjectAddTranslationState,
  createStatusBadgesState,
  state,
} = await import("./state.js");

function resetProjectAddTranslationTestState() {
  state.projectAddTranslation = {
    ...createProjectAddTranslationState(),
    isOpen: true,
    step: "selectLanguage",
    chapterId: "chapter-1",
    projectId: "project-1",
    repoName: "project-repo",
    projectFullName: "org/project-repo",
    chapterName: "Chapter",
    pastedText: "Translated text",
    sourceLanguageCode: "en",
  };
  state.teams = [{ id: "team-1", installationId: 1 }];
  state.selectedTeamId = "team-1";
  state.projects = [{
    id: "project-1",
    name: "project-repo",
    fullName: "org/project-repo",
    chapters: [{
      id: "chapter-1",
      languages: [{ code: "en", name: "English", role: "source" }],
    }],
  }];
  state.deletedProjects = [];
  state.aiSettings = createAiSettingsState();
  state.statusBadges = createStatusBadgesState();
  globalThis.document.testScrollList = null;
  invokeHandler = async () => null;
}

test("add translation language selection preserves scroll and waits for Continue", async () => {
  resetProjectAddTranslationTestState();
  const invokeCalls = [];
  const list = { scrollTop: 268 };
  globalThis.document.testScrollList = list;
  invokeHandler = async (...args) => {
    invokeCalls.push(args);
    throw new Error("Selection should not invoke backend commands.");
  };
  let renderCount = 0;

  await selectProjectAddTranslationLanguage(() => {
    renderCount += 1;
  }, "VI");

  assert.equal(state.projectAddTranslation.step, "selectLanguage");
  assert.equal(state.projectAddTranslation.targetLanguageCode, "vi");
  assert.equal(state.projectAddTranslation.error, "");
  assert.equal(state.projectAddTranslation.status, "idle");
  assert.equal(renderCount, 1);
  assert.equal(list.scrollTop, 268);
  assert.deepEqual(invokeCalls, []);
});

test("add translation language Continue runs preflight after selection", async () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation = {
    ...state.projectAddTranslation,
    targetLanguageCode: "vi",
  };
  const commands = [];
  invokeHandler = async (command, payload = {}) => {
    commands.push({ command, payload });
    if (command === "load_ai_provider_secret") {
      return "openai-key";
    }
    if (command === "preflight_aligned_translation_to_gtms_chapter") {
      return {
        status: "mismatch",
        jobId: "job-1",
        mismatch: { score: 0.2 },
        existingTranslationCount: 0,
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await continueProjectAddTranslationLanguage(() => {});

  assert.deepEqual(commands.map((call) => call.command), [
    "load_ai_provider_secret",
    "preflight_aligned_translation_to_gtms_chapter",
  ]);
  assert.equal(state.projectAddTranslation.step, "mismatchWarning");
  assert.equal(commands[1].payload.input.targetLanguageCode, "vi");
});

test("add translation language Continue requires a selected language", async () => {
  resetProjectAddTranslationTestState();
  const invokeCalls = [];
  invokeHandler = async (...args) => {
    invokeCalls.push(args);
    return null;
  };
  let renderCount = 0;

  await continueProjectAddTranslationLanguage(() => {
    renderCount += 1;
  });

  assert.equal(state.projectAddTranslation.step, "selectLanguage");
  assert.equal(state.projectAddTranslation.targetLanguageCode, "");
  assert.equal(state.projectAddTranslation.error, "Select a language before continuing.");
  assert.equal(renderCount, 1);
  assert.deepEqual(invokeCalls, []);
});
