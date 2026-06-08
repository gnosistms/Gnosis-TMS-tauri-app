import test from "node:test";
import assert from "node:assert/strict";

let invokeHandler = async () => null;
let alignedTranslationProgressHandler = null;

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
      listen: async (eventName, handler) => {
        if (eventName === "aligned-translation-progress") {
          alignedTranslationProgressHandler = handler;
        }
        return () => {
          if (
            eventName === "aligned-translation-progress"
            && alignedTranslationProgressHandler === handler
          ) {
            alignedTranslationProgressHandler = null;
          }
        };
      },
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
  setTimeout(...args) {
    return globalThis.setTimeout(...args);
  },
  clearTimeout(...args) {
    return globalThis.clearTimeout(...args);
  },
};

globalThis.requestAnimationFrame = (callback) => {
  callback?.();
  return 1;
};

const {
  continueProjectAddTranslationLanguage,
  registerProjectAddTranslationProgress,
  selectProjectAddTranslationLanguage,
  updateProjectAddTranslationPaste,
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

test("add translation paste input updates state without rerendering the focused textarea", () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation = {
    ...state.projectAddTranslation,
    step: "pasteText",
    pastedText: "",
    error: "Paste your translation text before continuing.",
  };
  let renderCount = 0;

  updateProjectAddTranslationPaste(() => {
    renderCount += 1;
  }, "Translated paragraph");

  assert.equal(state.projectAddTranslation.pastedText, "Translated paragraph");
  assert.equal(state.projectAddTranslation.error, "");
  assert.equal(renderCount, 0);
});

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

test("add translation language Continue shows progress modal before preflight response", async () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation = {
    ...state.projectAddTranslation,
    targetLanguageCode: "vi",
  };
  let preflightStarted = false;
  invokeHandler = async (command) => {
    if (command === "load_ai_provider_secret") {
      return "openai-key";
    }
    if (command === "preflight_aligned_translation_to_gtms_chapter") {
      preflightStarted = true;
      assert.equal(state.projectAddTranslation.step, "aligning");
      assert.equal(state.projectAddTranslation.status, "running");
      assert.equal(state.projectAddTranslation.progress.stageId, "prepare_units");
      return {
        status: "mismatch",
        jobId: "job-1",
        flow: "single",
        mismatch: { score: 0.2 },
        existingTranslationCount: 0,
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await continueProjectAddTranslationLanguage(() => {});

  assert.equal(preflightStarted, true);
  assert.equal(state.projectAddTranslation.flow, "single");
  assert.equal(state.projectAddTranslation.step, "mismatchWarning");
});

test("add translation progress listener claims the first job event and ignores other jobs", async () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation = {
    ...state.projectAddTranslation,
    step: "aligning",
    targetLanguageCode: "vi",
    jobId: "",
  };
  const renderCalls = [];

  registerProjectAddTranslationProgress((options) => {
    renderCalls.push(options);
  });
  await Promise.resolve();
  assert.equal(typeof alignedTranslationProgressHandler, "function");

  alignedTranslationProgressHandler({
    payload: {
      jobId: "job-1",
      flow: "single",
      stageId: "prepare_units",
      status: "complete",
      message: "Prepared source and target units",
      completed: 1,
      total: 1,
    },
  });

  assert.equal(state.projectAddTranslation.jobId, "job-1");
  assert.equal(state.projectAddTranslation.flow, "single");
  assert.equal(state.projectAddTranslation.progress.stageId, "prepare_units");
  assert.deepEqual(renderCalls, [undefined]);

  alignedTranslationProgressHandler({
    payload: {
      jobId: "other-job",
      flow: "multi",
      stageId: "apply",
      status: "running",
      message: "Wrong job",
      completed: 0,
      total: 1,
    },
  });

  assert.equal(state.projectAddTranslation.jobId, "job-1");
  assert.equal(state.projectAddTranslation.flow, "single");
  assert.equal(state.projectAddTranslation.progress.stageId, "prepare_units");
  assert.deepEqual(renderCalls, [undefined]);

  alignedTranslationProgressHandler({
    payload: {
      jobId: "job-1",
      flow: "single",
      stageId: "apply",
      status: "complete",
      message: "Aligned translation was applied",
      completed: 1,
      total: 1,
    },
  });

  assert.equal(state.projectAddTranslation.isOpen, false);
  assert.equal(state.statusBadges.left.text, "Added translation.");
  assert.deepEqual(renderCalls, [undefined, undefined, { scope: "status-surface" }]);
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
