import test from "node:test";
import assert from "node:assert/strict";

let invokeHandler = async () => null;
let alignedTranslationProgressHandler = null;
let subtitleResultHandler = null;

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
        if (eventName === "subtitle-translation-result") subtitleResultHandler = handler;
        return () => {
          if (eventName === "subtitle-translation-result" && subtitleResultHandler === handler) subtitleResultHandler = null;
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
  PROJECT_ADD_TRANSLATION_ACCEPT,
  openProjectAddTranslation,
  applyProjectAddTranslation,
  cancelProjectAddTranslation,
  retryProjectAddTranslationApply,
  continueProjectAddTranslationLanguage,
  continueProjectAddTranslationAfterMismatch,
  handleDroppedProjectAddTranslationFiles,
  handleDroppedProjectAddTranslationPaths,
  registerProjectAddTranslationProgress,
  selectProjectAddTranslationInputMode,
  selectProjectAddTranslationFile,
  selectProjectAddTranslationLanguage,
  submitProjectAddTranslationLink,
  submitProjectAddTranslationPaste,
  updateProjectAddTranslationLink,
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

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test("canceling alignment stops backend work and ignores a late ready-to-apply response", async () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation.targetLanguageCode = "vi";
  const preflight = deferred(), started = deferred(), commands = [];
  invokeHandler = async (command, payload) => {
    commands.push(command);
    if (command === "load_ai_provider_secret") return "test-key";
    if (command === "preflight_aligned_translation_to_gtms_chapter") {
      assert.equal(payload.requestId, state.projectAddTranslation.alignmentRequestId);
      started.resolve();
      return preflight.promise;
    }
    if (command === "cancel_aligned_translation") {
      assert.equal(payload.requestId, state.projectAddTranslation.alignmentRequestId);
      return true;
    }
    assert.fail(`Unexpected command: ${command}`);
  };
  const run = continueProjectAddTranslationLanguage(() => {});
  await started.promise;
  await cancelProjectAddTranslation(() => {});
  assert.equal(state.projectAddTranslation.isOpen, false);
  preflight.resolve({ status: "readyToApply", jobId: "job-canceled", existingTranslationCount: 0 });
  await run;
  assert.equal(state.projectAddTranslation.isOpen, false);
  assert.ok(!commands.includes("apply_aligned_translation_to_gtms_chapter"));
});

test("a ready response arriving during cancellation waits for the cancellation decision", async () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation.targetLanguageCode = "vi";
  const preflight = deferred(), started = deferred(), cancel = deferred();
  invokeHandler = async (command) => {
    if (command === "load_ai_provider_secret") return "test-key";
    if (command === "preflight_aligned_translation_to_gtms_chapter") { started.resolve(); return preflight.promise; }
    if (command === "cancel_aligned_translation") return cancel.promise;
    assert.fail(`Unexpected command: ${command}`);
  };
  const run = continueProjectAddTranslationLanguage(() => {});
  await started.promise;
  const cancellation = cancelProjectAddTranslation(() => {});
  assert.equal(state.projectAddTranslation.status, "canceling");
  preflight.resolve({ status: "readyToApply", jobId: "job-canceled" });
  await Promise.resolve();
  cancel.resolve(true);
  await Promise.all([run, cancellation]);
  assert.equal(state.projectAddTranslation.isOpen, false);
});

test("a failed cancel resumes processing a preflight result that arrived meanwhile", async () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation.targetLanguageCode = "vi";
  const preflight = deferred(), started = deferred(), cancel = deferred();
  invokeHandler = async (command) => {
    if (command === "load_ai_provider_secret") return "test-key";
    if (command === "preflight_aligned_translation_to_gtms_chapter") { started.resolve(); return preflight.promise; }
    if (command === "cancel_aligned_translation") return cancel.promise;
    assert.fail(`Unexpected command: ${command}`);
  };
  const run = continueProjectAddTranslationLanguage(() => {});
  await started.promise;
  const cancellation = cancelProjectAddTranslation(() => {});
  preflight.resolve({ status: "mismatch", jobId: "job-1" });
  cancel.reject(new Error("Could not cancel alignment."));
  await Promise.all([run, cancellation]);
  assert.equal(state.projectAddTranslation.step, "mismatchWarning");
});

test("late alignment errors cannot change a newly opened operation", async () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation.targetLanguageCode = "vi";
  const preflight = deferred(), started = deferred();
  invokeHandler = async (command) => {
    if (command === "load_ai_provider_secret") return "test-key";
    if (command === "preflight_aligned_translation_to_gtms_chapter") { started.resolve(); return preflight.promise; }
    if (command === "cancel_aligned_translation") return true;
    assert.fail(`Unexpected command: ${command}`);
  };
  const run = continueProjectAddTranslationLanguage(() => {});
  await started.promise;
  await cancelProjectAddTranslation(() => {});
  state.projectAddTranslation = { ...createProjectAddTranslationState(), isOpen: true, chapterId: "new-chapter" };
  preflight.reject(new Error("ALIGNMENT_CANCELED: Alignment canceled."));
  await run;
  assert.equal(state.projectAddTranslation.chapterId, "new-chapter");
  assert.equal(state.projectAddTranslation.step, "input");
  assert.equal(state.projectAddTranslation.error, "");
});

test("cancel refusal during application leaves completion able to close the dialog", async () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation.jobId = "job-1";
  const apply = deferred(), started = deferred(), cancel = deferred();
  invokeHandler = async (command) => {
    if (command === "apply_aligned_translation_to_gtms_chapter") { started.resolve(); return apply.promise; }
    if (command === "cancel_aligned_translation") return cancel.promise;
    assert.fail(`Unexpected command: ${command}`);
  };
  const run = applyProjectAddTranslation(() => {});
  await started.promise;
  const cancellation = cancelProjectAddTranslation(() => {});
  apply.resolve({ updatedRowCount: 2 });
  cancel.resolve(false);
  await Promise.all([run, cancellation]);
  assert.equal(state.projectAddTranslation.isOpen, false);
});

test("local saving cannot be canceled but an apply error can still be dismissed", async () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation.status = "running";
  state.projectAddTranslation.progress = { stageId: "apply" };
  invokeHandler = async () => assert.fail("must not cancel an active save");
  await cancelProjectAddTranslation(() => {});
  assert.equal(state.projectAddTranslation.isOpen, true);
  state.projectAddTranslation.status = "idle";
  state.projectAddTranslation.step = "applyError";
  await cancelProjectAddTranslation(() => {});
  assert.equal(state.projectAddTranslation.isOpen, false);
});

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

test("add translation upload extracts plain text before language selection", async () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation = {
    ...state.projectAddTranslation,
    step: "input",
    inputMode: "upload",
    status: "idle",
  };
  const calls = [];
  invokeHandler = async (command, payload) => {
    calls.push([command, payload]);
    if (command === "extract_project_translation_text") {
      return { plainText: "One\nTwo", unitCount: 2 };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await handleDroppedProjectAddTranslationFiles(() => {}, [{
    name: "translation.rtf",
    size: 4,
    arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
  }]);

  assert.equal(state.projectAddTranslation.step, "selectLanguage");
  assert.equal(state.projectAddTranslation.pastedText, "One\nTwo");
  assert.equal(state.projectAddTranslation.pendingFileName, "translation.rtf");
  assert.deepEqual(calls[0], [
    "extract_project_translation_text",
    { input: { fileName: "translation.rtf", bytes: [1, 2, 3, 4] } },
  ]);
});

test("add translation accepts an SRT file drop and advances with extracted subtitle text", async () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation.step = "input";
  const text = "1\n00:00:01,000 --> 00:00:02,000\nHola\n";
  const bytes = Array.from(new TextEncoder().encode(text));
  const calls = [];
  invokeHandler = async (command, payload) => {
    calls.push([command, payload]);
    return { plainText: "Hola", unitCount: 1 };
  };

  await handleDroppedProjectAddTranslationFiles(() => {}, [{
    name: "translation.SRT",
    size: bytes.length,
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  }]);

  assert.deepEqual(calls, [["extract_project_translation_text", {
    input: { fileName: "translation.SRT", bytes },
  }]]);
  assert.equal(state.projectAddTranslation.step, "selectLanguage");
  assert.equal(state.projectAddTranslation.pastedText, "Hola");
  assert.equal(state.projectAddTranslation.error, "");
  assert.match(PROJECT_ADD_TRANSLATION_ACCEPT, /\.srt,application\/x-subrip/);
});

test("add translation native picker accepts SRT and extracts the selected local file", async () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation.step = "input";
  let pickerOptions;
  globalThis.window.__TAURI__.dialog = {
    open: async (options) => {
      pickerOptions = options;
      return "/tmp/translation.srt";
    },
  };
  const calls = [];
  invokeHandler = async (command, payload) => {
    calls.push([command, payload]);
    if (command === "read_local_dropped_file") {
      return { dataBase64: Buffer.from("subtitles").toString("base64") };
    }
    return { plainText: "Hola", unitCount: 1 };
  };

  try {
    await selectProjectAddTranslationFile(() => {});
    assert.ok(pickerOptions.filters[0].extensions.includes("srt"));
    assert.equal(pickerOptions.multiple, false);
    assert.deepEqual(calls[0], ["read_local_dropped_file", { path: "/tmp/translation.srt" }]);
    assert.deepEqual(calls[1], ["extract_project_translation_text", {
      input: { fileName: "translation.srt", bytes: Array.from(Buffer.from("subtitles")) },
    }]);
    assert.equal(state.projectAddTranslation.step, "selectLanguage");
    assert.equal(state.projectAddTranslation.pastedText, "Hola");
  } finally {
    delete globalThis.window.__TAURI__.dialog;
  }
});

test("SRT translation uses the timestamp command without AI credentials, model selection or alignment", async () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation.step = "input";
  const bytes = Array.from(new TextEncoder().encode("1\n00:00:01,000 --> 00:00:02,000\nMột\nHai\n"));
  const commands = [];
  invokeHandler = async (command, payload) => {
    commands.push(command);
    if (command === "extract_project_translation_text") return { plainText: "Một\nHai", unitCount: 1 };
    assert.equal(command, "add_srt_translation_to_gtms_chapter");
    assert.equal(state.projectAddTranslation.flow, "subtitle");
    assert.equal(payload.input.fileName, "translation.srt");
    assert.deepEqual(payload.input.bytes, bytes);
    assert.equal(payload.input.targetLanguageCode, "vi");
    assert.equal(payload.input.providerId, undefined);
    assert.equal(payload.input.modelId, undefined);
    assert.ok(payload.requestId);
    return { updatedRowCount: 1, insertedRowCount: 2 };
  };
  await handleDroppedProjectAddTranslationFiles(() => {}, [{
    name: "translation.srt", size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  }]);
  state.projectAddTranslation.targetLanguageCode = "vi";
  await continueProjectAddTranslationLanguage(() => {});
  assert.deepEqual(commands, ["extract_project_translation_text", "add_srt_translation_to_gtms_chapter"]);
  assert.equal(state.projectAddTranslation.isOpen, false);
});

test("invalid SRT is refused before choosing a language or writing translations", async () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation.step = "input";
  invokeHandler = async (command) => {
    assert.equal(command, "extract_project_translation_text");
    throw new Error("Line 2: Invalid SRT file. Expected HH:MM:SS,mmm --> HH:MM:SS,mmm.");
  };
  await handleDroppedProjectAddTranslationFiles(() => {}, [{
    name: "invalid.srt", dataBase64: Buffer.from("invalid").toString("base64"),
  }]);
  assert.equal(state.projectAddTranslation.step, "input");
  assert.equal(state.projectAddTranslation.subtitleFile, null);
  assert.match(state.projectAddTranslation.error, /Invalid SRT file/);
});

test("subtitle write failure retains the SRT for retry without entering AI alignment", async () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation.targetLanguageCode = "vi";
  state.projectAddTranslation.subtitleFile = { fileName: "translation.srt", bytes: [1,2,3] };
  invokeHandler = async (command) => {
    assert.equal(command, "add_srt_translation_to_gtms_chapter");
    throw new Error("The subtitle file could not be saved.");
  };
  await continueProjectAddTranslationLanguage(() => {});
  assert.equal(state.projectAddTranslation.step, "selectLanguage");
  assert.equal(state.projectAddTranslation.subtitleFile.fileName, "translation.srt");
  assert.match(state.projectAddTranslation.error, /could not be saved/);
});

test("opening a subtitle chapter requires SRT and refuses paste or links", async () => {
  resetProjectAddTranslationTestState();
  state.projects[0].chapters[0].sourceFormats = ["srt"];
  openProjectAddTranslation(() => {}, "chapter-1");
  assert.equal(state.projectAddTranslation.requiresSrtFile, true);
  invokeHandler = async () => assert.fail("paste/link input must not reach the backend");
  for (const mode of ["pasteText", "pasteLink"]) {
    selectProjectAddTranslationInputMode(() => {}, mode);
    assert.equal(state.projectAddTranslation.inputMode, "upload");
  }
  updateProjectAddTranslationPaste(() => {}, "Pasted text");
  updateProjectAddTranslationLink(() => {}, "https://docs.google.com/document/d/example/edit");
  assert.equal(state.projectAddTranslation.pastedText, "");
  assert.equal(state.projectAddTranslation.linkUrl, "");
  submitProjectAddTranslationPaste(() => {});
  await submitProjectAddTranslationLink(() => {});
  assert.equal(state.projectAddTranslation.step, "input");
  assert.match(state.projectAddTranslation.error, /Choose a valid SRT file/);
});

test("subtitle chapters reject other file formats before reading or extracting", async () => {
  resetProjectAddTranslationTestState();
  state.projects[0].chapters[0].sourceFormats = ["srt"];
  invokeHandler = async () => assert.fail("non-SRT uploads must not reach the backend");
  for (const name of ["translation.txt", "translation.docx", "translation.rtf"]) {
    await handleDroppedProjectAddTranslationFiles(() => {}, [{
      name, arrayBuffer: async () => assert.fail("must reject before reading"),
    }]);
    assert.match(state.projectAddTranslation.error, /Choose a valid SRT file/);
  }
  await handleDroppedProjectAddTranslationPaths(() => {}, ["/tmp/translation.txt"]);
  assert.match(state.projectAddTranslation.error, /Choose a valid SRT file/);
});

test("subtitle chapter native picker offers only SRT", async () => {
  resetProjectAddTranslationTestState();
  state.projects[0].chapters[0].sourceFormats = ["srt"];
  let options;
  globalThis.window.__TAURI__.dialog = { open: async (value) => { options = value; return null; } };
  try {
    await selectProjectAddTranslationFile(() => {});
    assert.deepEqual(options.filters, [{ name: "SRT subtitles", extensions: ["srt"] }]);
  } finally {
    delete globalThis.window.__TAURI__.dialog;
  }
});

test("existing subtitle chapters refuse plain text input without using AI", async () => {
  resetProjectAddTranslationTestState();
  state.projects[0].chapters[0].sourceFormats = ["srt"];
  state.projectAddTranslation.targetLanguageCode = "vi";
  invokeHandler = async () => assert.fail("subtitles must never enter AI alignment");
  await continueProjectAddTranslationLanguage(() => {});
  assert.equal(state.projectAddTranslation.step, "input");
  assert.equal(state.projectAddTranslation.inputMode, "upload");
  assert.match(state.projectAddTranslation.error, /Choose a valid SRT file/);
});

test("subtitle timestamp warning waits for consent and Cancel makes no further write request", async () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation.targetLanguageCode = "vi";
  state.projectAddTranslation.subtitleFile = { fileName: "translation.srt", bytes: [1,2,3] };
  const calls = [];
  invokeHandler = async (command, payload) => {
    calls.push(command);
    assert.equal(command, "add_srt_translation_to_gtms_chapter");
    assert.deepEqual(payload.input.confirmations, []);
    return { status: "mismatch", mismatch: { unmatchedCount: 222, totalCount: 279, unmatchedPercent: 222 / 279 * 100, confirmation: "plan-1" } };
  };
  await continueProjectAddTranslationLanguage(() => {});
  assert.equal(state.projectAddTranslation.step, "mismatchWarning");
  assert.equal(state.projectAddTranslation.status, "idle");
  assert.equal(state.projectAddTranslation.subtitleMismatch.unmatchedCount, 222);
  assert.equal(state.projectAddTranslation.isOpen, true);
  await cancelProjectAddTranslation(() => {});
  assert.equal(state.projectAddTranslation.isOpen, false);
  assert.deepEqual(calls, ["add_srt_translation_to_gtms_chapter"]);
});

test("subtitle continuation confirms the warned plan and can receive a refreshed warning", async () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation = { ...state.projectAddTranslation,
    targetLanguageCode: "vi", step: "mismatchWarning", flow: "subtitle",
    subtitleFile: { fileName: "translation.srt", bytes: [1,2,3] },
    subtitleMismatch: { unmatchedCount: 4, totalCount: 10, unmatchedPercent: 40, confirmation: "plan-1" },
  };
  let count = 0;
  invokeHandler = async (command, payload) => {
    assert.equal(command, "add_srt_translation_to_gtms_chapter");
    count += 1;
    assert.deepEqual(payload.input.confirmations, count === 1 ? ["plan-1"] : ["plan-1", "plan-2"]);
    if (count === 1) return { status: "mismatch", mismatch: { unmatchedCount: 5, totalCount: 10, unmatchedPercent: 50, confirmation: "plan-2" } };
    return { status: "applied", result: { updatedRowCount: 5, insertedRowCount: 5 } };
  };
  await continueProjectAddTranslationAfterMismatch(() => {});
  assert.equal(state.projectAddTranslation.step, "mismatchWarning");
  assert.equal(state.projectAddTranslation.subtitleMismatch.unmatchedPercent, 50);
  await continueProjectAddTranslationAfterMismatch(() => {});
  assert.equal(state.projectAddTranslation.isOpen, false);
  assert.equal(count, 2);
});

test("subtitle background completion waits for its own result event and cleans up", async () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation.targetLanguageCode = "vi";
  state.projectAddTranslation.subtitleFile = { fileName: "translation.srt", bytes: [1,2,3] };
  const started = deferred();
  let requestId;
  invokeHandler = async (command, payload) => {
    assert.equal(command, "add_srt_translation_to_gtms_chapter");
    requestId = payload.requestId;
    started.resolve();
    return { status: "started" };
  };
  const run = continueProjectAddTranslationLanguage(() => {});
  await started.promise;
  subtitleResultHandler({ payload: { requestId: "wrong-request", response: { status: "applied", result: {} } } });
  assert.equal(state.projectAddTranslation.isOpen, true);
  subtitleResultHandler({ payload: { requestId, response: { status: "mismatch", mismatch: { stage: "exact", unmatchedPercent: 10, confirmation: "exact-plan" } } } });
  await run;
  assert.equal(state.projectAddTranslation.step, "mismatchWarning");
  assert.equal(subtitleResultHandler, null);
});

test("subtitle meaning check begins only after both timing warnings and preserves all consent", async () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation = { ...state.projectAddTranslation, targetLanguageCode: "vi", step: "mismatchWarning", flow: "subtitle",
    subtitleFile: { fileName: "translation.srt", bytes: [1,2,3] },
    subtitleMismatch: { stage: "exact", confirmation: "exact-plan", unmatchedPercent: 40 },
  };
  state.aiSettings.actionConfig = { ...state.aiSettings.actionConfig, unified: { providerId: "openai", modelId: "gpt-5.4" } };
  const calls = [];
  let attempt = 0;
  invokeHandler = async (command, payload) => {
    calls.push(command);
    if (command === "load_ai_provider_secret") return "test-key";
    assert.equal(command, "add_srt_translation_to_gtms_chapter");
    attempt += 1;
    if (attempt === 1) {
      assert.deepEqual(payload.input.confirmations, ["exact-plan"]);
      assert.equal(payload.input.performMeaningCheck, false);
      return { status: "mismatch", mismatch: { stage: "overlap", confirmation: "overlap-plan", unmatchedPercent: 10 } };
    }
    assert.deepEqual(payload.input.confirmations.slice(0,2), ["exact-plan", "overlap-plan"]);
    if (attempt === 2) return { status: "needsAiCheck" };
    assert.equal(payload.input.performMeaningCheck, true);
    assert.equal(payload.input.modelId, "gpt-5.4");
    if (attempt === 3) return { status: "mismatch", mismatch: { stage: "meaning", confirmation: "meaning-plan", examples: [], unmatchedPercent: 20 } };
    assert.deepEqual(payload.input.confirmations, ["exact-plan", "overlap-plan", "meaning-plan"]);
    return { status: "applied", result: { updatedRowCount: 18, insertedRowCount: 2 } };
  };
  await continueProjectAddTranslationAfterMismatch(() => {});
  assert.equal(state.projectAddTranslation.subtitleMismatch.stage, "overlap");
  assert.deepEqual(calls, ["add_srt_translation_to_gtms_chapter"]);
  await continueProjectAddTranslationAfterMismatch(() => {});
  assert.equal(state.projectAddTranslation.subtitleMismatch.stage, "meaning");
  await continueProjectAddTranslationAfterMismatch(() => {});
  assert.equal(state.projectAddTranslation.isOpen, false);
  assert.equal(attempt,4);
  assert.equal(calls.filter((c) => c === "load_ai_provider_secret").length,1);
});

test("canceling subtitle processing discards late completion", async () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation.targetLanguageCode = "vi";
  state.projectAddTranslation.subtitleFile = { fileName: "translation.srt", bytes: [1,2,3] };
  const pending = deferred(), started = deferred();
  invokeHandler = async (command) => {
    if (command === "add_srt_translation_to_gtms_chapter") { started.resolve(); return pending.promise; }
    assert.equal(command, "cancel_aligned_translation");
    return true;
  };
  const run = continueProjectAddTranslationLanguage(() => {});
  await started.promise;
  await cancelProjectAddTranslation(() => {});
  pending.resolve({ updatedRowCount: 1 });
  await run;
  assert.equal(state.projectAddTranslation.isOpen, false);
});

test("add translation surfaces SRT parse errors from native dropped paths", async () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation.step = "input";
  invokeHandler = async (command) => {
    if (command === "read_local_dropped_file") {
      return { dataBase64: Buffer.from("invalid subtitles").toString("base64") };
    }
    throw new Error("Line 2: Expected an SRT timing line.");
  };

  await handleDroppedProjectAddTranslationPaths(() => {}, ["C:\\Subtitles\\translation.srt"]);

  assert.equal(state.projectAddTranslation.step, "input");
  assert.equal(state.projectAddTranslation.status, "idle");
  assert.match(state.projectAddTranslation.error, /Line 2: Expected an SRT timing line/);
});

test("add translation still rejects unsupported formats and multiple subtitle files", async () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation.step = "input";
  invokeHandler = async () => assert.fail("invalid uploads must not reach the backend");

  await handleDroppedProjectAddTranslationFiles(() => {}, [{ name: "translation.vtt" }]);
  assert.equal(state.projectAddTranslation.error, "Choose a TXT, DOCX, RTF, or SRT file.");
  await handleDroppedProjectAddTranslationFiles(() => {}, [
    { name: "one.srt" }, { name: "two.srt" },
  ]);
  assert.equal(state.projectAddTranslation.error, "Drop one TXT, DOCX, RTF, or SRT file.");
});

test("add translation Google Docs link uses the DOCX-only resolver and extractor", async () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation = {
    ...state.projectAddTranslation,
    step: "input",
    inputMode: "pasteLink",
    status: "idle",
    linkUrl: "",
  };
  updateProjectAddTranslationLink(() => {}, "https://docs.google.com/document/d/doc-id/edit");
  const calls = [];
  invokeHandler = async (command, payload) => {
    calls.push([command, payload]);
    if (command === "resolve_project_import_link") {
      return {
        fileName: "translation.docx",
        dataBase64: Buffer.from([80, 75]).toString("base64"),
      };
    }
    if (command === "extract_project_translation_text") {
      return { plainText: "Translated paragraph", unitCount: 1 };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await submitProjectAddTranslationLink(() => {});

  assert.equal(state.projectAddTranslation.step, "selectLanguage");
  assert.equal(state.projectAddTranslation.pastedText, "Translated paragraph");
  assert.deepEqual(calls[0], [
    "resolve_project_import_link",
    {
      input: {
        url: "https://docs.google.com/document/d/doc-id/edit",
        allowedFileTypes: ["docx"],
      },
    },
  ]);
  assert.equal(calls[1][0], "extract_project_translation_text");
});

test("add translation rejects non-document Google links before resolving", async () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation = {
    ...state.projectAddTranslation,
    step: "input",
    inputMode: "pasteLink",
    linkUrl: "https://docs.google.com/spreadsheets/d/sheet-id/edit",
  };
  const calls = [];
  invokeHandler = async (...args) => {
    calls.push(args);
    return null;
  };

  await submitProjectAddTranslationLink(() => {});

  assert.equal(state.projectAddTranslation.linkErrorModal, "invalid");
  assert.deepEqual(calls, []);
});

test("add translation input mode selection uses shared normalization", () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation.step = "input";

  selectProjectAddTranslationInputMode(() => {}, "pasteText");
  assert.equal(state.projectAddTranslation.inputMode, "pasteText");

  selectProjectAddTranslationInputMode(() => {}, "unknown");
  assert.equal(state.projectAddTranslation.inputMode, "upload");
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

test("add translation runs alignment with Claude when Claude is selected", async () => {
  resetProjectAddTranslationTestState();
  state.aiSettings.actionConfig = {
    ...state.aiSettings.actionConfig,
    unified: { providerId: "claude", modelId: "claude-opus-5-5" },
  };
  state.projectAddTranslation = {
    ...state.projectAddTranslation,
    targetLanguageCode: "vi",
  };
  const commands = [];
  invokeHandler = async (command, payload = {}) => {
    commands.push({ command, payload });
    if (command === "load_ai_provider_secret") {
      return "claude-key";
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

  assert.equal(state.projectAddTranslation.error, "");
  assert.equal(commands[1]?.command, "preflight_aligned_translation_to_gtms_chapter");
  assert.equal(commands[1].payload.input.providerId, "claude");
  assert.equal(commands[1].payload.input.modelId, "claude-opus-5-5");
});

test("add translation explains that other providers cannot align yet", async () => {
  resetProjectAddTranslationTestState();
  state.aiSettings.actionConfig = {
    ...state.aiSettings.actionConfig,
    unified: { providerId: "gemini", modelId: "gemini-3-flash-preview" },
  };
  state.projectAddTranslation = {
    ...state.projectAddTranslation,
    targetLanguageCode: "vi",
  };
  const commands = [];
  invokeHandler = async (command) => {
    commands.push(command);
    throw new Error(`Unexpected command: ${command}`);
  };

  await continueProjectAddTranslationLanguage(() => {});

  assert.deepEqual(commands, []);
  assert.equal(state.projectAddTranslation.step, "selectLanguage");
  assert.match(state.projectAddTranslation.error, /requires OpenAI or Claude/);
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

test("late progress from a canceled request cannot claim a new alignment", () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation = {
    ...state.projectAddTranslation,
    step: "aligning", status: "running", jobId: "", alignmentRequestId: "new-request",
  };
  alignedTranslationProgressHandler({ payload: {
    requestId: "canceled-request", jobId: "old-job", stageId: "row_alignment", status: "running",
  } });
  assert.equal(state.projectAddTranslation.jobId, "");
  alignedTranslationProgressHandler({ payload: {
    requestId: "new-request", jobId: "new-job", stageId: "row_alignment", status: "running",
  } });
  assert.equal(state.projectAddTranslation.jobId, "new-job");
});

test("late subtitle progress cannot dismiss an unanswered timestamp warning", () => {
  resetProjectAddTranslationTestState();
  state.projectAddTranslation = {
    ...state.projectAddTranslation, step: "mismatchWarning", flow: "subtitle", status: "idle",
    jobId: "subtitle-job", alignmentRequestId: "subtitle-request",
    subtitleMismatch: { unmatchedCount: 222, totalCount: 279, unmatchedPercent: 222 / 279 * 100, confirmation: "plan-1" },
  };
  alignedTranslationProgressHandler({ payload: {
    requestId: "subtitle-request", jobId: "subtitle-job", stageId: "match_timestamps", status: "complete",
  } });
  assert.equal(state.projectAddTranslation.step, "mismatchWarning");
  assert.equal(state.projectAddTranslation.subtitleMismatch.confirmation, "plan-1");
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


test("failed apply offers recovery and retry preserves mismatch consent", async () => {
  resetProjectAddTranslationTestState();
  Object.assign(state.projectAddTranslation, { jobId: "job-1", targetLanguageCode: "vi-x-2", targetBaseLanguageCode: "vi" });
  const originalText = state.projectAddTranslation.pastedText;
  invokeHandler = async () => { throw new Error("Temporary save failure"); };
  await applyProjectAddTranslation(() => {}, { continueOnMismatch: true });
  assert.equal(state.projectAddTranslation.step, "applyError");
  assert.equal(state.projectAddTranslation.status, "idle");
  assert.equal(state.projectAddTranslation.pastedText, originalText);
  let retryInput;
  invokeHandler = async (command, { input }) => {
    assert.equal(command, "apply_aligned_translation_to_gtms_chapter");
    retryInput = input;
    return { updatedRowCount: 2, insertedRowCount: 0 };
  };
  await retryProjectAddTranslationApply(() => {});
  assert.equal(retryInput.jobId, "job-1");
  assert.equal(retryInput.continueOnMismatch, true);
  assert.equal(state.projectAddTranslation.isOpen, false);
});

test("source change recovery realigns saved text using the base target language", async () => {
  resetProjectAddTranslationTestState();
  Object.assign(state.projectAddTranslation, { jobId: "old-job", targetLanguageCode: "vi-x-2", targetBaseLanguageCode: "vi" });
  invokeHandler = async () => { throw new Error("ALIGNMENT_SOURCE_CHANGED: Source changed. Restart alignment."); };
  await applyProjectAddTranslation(() => {});
  assert.equal(state.projectAddTranslation.applyErrorKind, "sourceChanged");
  let preflightInput;
  invokeHandler = async (command, payload) => {
    if (command === "load_ai_provider_secret") return "openai-key";
    assert.equal(command, "preflight_aligned_translation_to_gtms_chapter");
    preflightInput = payload.input;
    assert.equal(state.projectAddTranslation.jobId, "");
    return { status: "mismatch", jobId: "new-job", targetLanguageCode: "vi-x-3", targetBaseLanguageCode: "vi" };
  };
  await retryProjectAddTranslationApply(() => {});
  assert.equal(preflightInput.targetLanguageCode, "vi");
  assert.equal(preflightInput.pastedText, "Translated text");
  assert.equal(state.projectAddTranslation.jobId, "new-job");
  assert.equal(state.projectAddTranslation.step, "mismatchWarning");
});
