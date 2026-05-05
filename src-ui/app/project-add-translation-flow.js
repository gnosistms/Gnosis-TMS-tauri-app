import { AI_ACTION_LABELS } from "./ai-action-config.js";
import { formatErrorForDisplay } from "./error-display.js";
import { findIsoLanguageOption, normalizeSupportedLanguageCode } from "../lib/language-options.js";
import { invoke, listen } from "./runtime.js";
import { findChapterContext, selectedProjectsTeam } from "./project-context.js";
import { showNoticeBadge } from "./status-feedback.js";
import { createProjectAddTranslationState, state } from "./state.js";
import {
  openAiMissingKeyModal,
  resolveAiActionProviderAndModel,
} from "./ai-settings-flow.js";
import { ensureSelectedTeamAiProviderReady } from "./team-ai-flow.js";

export const ALIGNED_TRANSLATION_PROGRESS_EVENT = "aligned-translation-progress";

let progressUnlistenPromise = null;

function normalizeChapterLanguages(languages = []) {
  return (Array.isArray(languages) ? languages : [])
    .map((language) => ({
      code: String(language?.code ?? "").trim(),
      name: String(language?.name ?? "").trim(),
      role: String(language?.role ?? "").trim(),
    }))
    .filter((language) => language.code);
}

function selectedSourceLanguageCode(chapter) {
  const languages = normalizeChapterLanguages(chapter?.languages);
  const selected = String(chapter?.selectedSourceLanguageCode ?? "").trim();
  if (selected && languages.some((language) => language.code === selected)) {
    return selected;
  }
  return (
    languages.find((language) => language.role === "source")?.code
    ?? languages[0]?.code
    ?? ""
  );
}

function resetProjectAddTranslation() {
  state.projectAddTranslation = createProjectAddTranslationState();
}

function currentContext() {
  const modal = state.projectAddTranslation;
  return findChapterContext(modal?.chapterId);
}

function baseInvokeInput(overrides = {}) {
  const modal = state.projectAddTranslation;
  const team = selectedProjectsTeam();
  const context = currentContext();
  if (!Number.isFinite(team?.installationId) || !context?.project || !context?.chapter) {
    throw new Error("Could not find the selected file.");
  }
  return {
    installationId: team.installationId,
    repoName: context.project.name,
    projectId: context.project.id ?? null,
    projectFullName: context.project.fullName ?? "",
    chapterId: context.chapter.id,
    sourceLanguageCode: modal.sourceLanguageCode,
    targetLanguageCode: modal.targetLanguageCode,
    ...overrides,
  };
}

function resolveAlignmentProviderAndModel() {
  return resolveAiActionProviderAndModel("translate1");
}

export function registerProjectAddTranslationProgress(render) {
  if (progressUnlistenPromise || typeof listen !== "function") {
    return;
  }
  progressUnlistenPromise = listen(ALIGNED_TRANSLATION_PROGRESS_EVENT, (event) => {
    const payload = event?.payload ?? {};
    const modal = state.projectAddTranslation;
    if (!modal?.isOpen || !payload?.jobId || payload.jobId !== modal.jobId) {
      return;
    }
    state.projectAddTranslation = {
      ...modal,
      progress: payload,
      step: modal.step === "applying" ? "applying" : "aligning",
    };
    render?.();
  }).catch(() => null);
}

export function openProjectAddTranslation(render, chapterId) {
  const context = findChapterContext(chapterId);
  if (!context?.project || !context?.chapter) {
    showNoticeBadge("Could not find the selected file.", render, 2200);
    return;
  }
  const sourceLanguageCode = selectedSourceLanguageCode(context.chapter);
  if (!sourceLanguageCode) {
    showNoticeBadge("Select a source language before adding translation.", render, 2600);
    return;
  }
  state.projectAddTranslation = {
    ...createProjectAddTranslationState(),
    isOpen: true,
    step: "pasteText",
    chapterId: context.chapter.id ?? "",
    projectId: context.project.id ?? "",
    repoName: context.project.name ?? "",
    projectFullName: context.project.fullName ?? "",
    chapterName: context.chapter.name ?? "file",
    sourceLanguageCode,
  };
  render();
}

export function updateProjectAddTranslationPaste(render, value) {
  if (!state.projectAddTranslation?.isOpen) {
    return;
  }
  state.projectAddTranslation = {
    ...state.projectAddTranslation,
    pastedText: typeof value === "string" ? value : "",
    error: "",
  };
  render();
}

export function cancelProjectAddTranslation(render) {
  resetProjectAddTranslation();
  render();
}

export function submitProjectAddTranslationPaste(render) {
  const modal = state.projectAddTranslation;
  if (!modal?.isOpen) {
    return;
  }
  if (!String(modal.pastedText ?? "").trim()) {
    state.projectAddTranslation = {
      ...modal,
      error: "Paste your translation text before continuing.",
    };
    render();
    return;
  }
  state.projectAddTranslation = {
    ...modal,
    step: "selectLanguage",
    error: "",
  };
  render();
}

export async function selectProjectAddTranslationLanguage(render, languageCode) {
  const modal = state.projectAddTranslation;
  if (!modal?.isOpen || modal.step !== "selectLanguage") {
    return;
  }
  const targetLanguageCode = normalizeSupportedLanguageCode(languageCode);
  if (!findIsoLanguageOption(targetLanguageCode)) {
    state.projectAddTranslation = {
      ...modal,
      targetLanguageCode: "",
      error: "Select a supported language.",
    };
    render();
    return;
  }
  state.projectAddTranslation = {
    ...modal,
    targetLanguageCode,
    error: "",
  };
  render();
  await runProjectAddTranslationPreflight(render);
}

export async function continueProjectAddTranslationWithExistingText(render) {
  const modal = state.projectAddTranslation;
  if (!modal?.isOpen) {
    return;
  }
  await applyProjectAddTranslation(render, { continueOnMismatch: false });
}

export async function continueProjectAddTranslationAfterMismatch(render) {
  const modal = state.projectAddTranslation;
  if (!modal?.isOpen) {
    return;
  }
  await applyProjectAddTranslation(render, { continueOnMismatch: true });
}

async function ensureOpenAiReady(render, providerId) {
  const result = await ensureSelectedTeamAiProviderReady(render, providerId);
  if (!result?.ok) {
    openAiMissingKeyModal(providerId);
    render?.();
    return false;
  }
  return true;
}

export async function runProjectAddTranslationPreflight(render) {
  const modal = state.projectAddTranslation;
  if (!modal?.isOpen || !modal.targetLanguageCode) {
    return;
  }

  const { providerId, modelId } = resolveAlignmentProviderAndModel();
  if (providerId !== "openai") {
    state.projectAddTranslation = {
      ...modal,
      step: "selectLanguage",
      status: "idle",
      error: "Add translation currently requires OpenAI. Select OpenAI in AI Settings and try again.",
    };
    render();
    return;
  }
  if (!modelId) {
    state.projectAddTranslation = {
      ...modal,
      step: "selectLanguage",
      status: "idle",
      error: `Select a model for ${AI_ACTION_LABELS.translate1} on the AI Settings page first.`,
    };
    render();
    return;
  }
  if (!(await ensureOpenAiReady(render, providerId))) {
    return;
  }

  state.projectAddTranslation = {
    ...state.projectAddTranslation,
    step: "aligning",
    status: "running",
    error: "",
    providerId,
    modelId,
    progress: {
      stageId: "prepare_units",
      stageLabel: "Preparing text units",
      status: "running",
      completed: 0,
      total: 1,
      percent: 0,
    },
  };
  render();

  try {
    const response = await invoke("preflight_aligned_translation_to_gtms_chapter", {
      input: baseInvokeInput({
        pastedText: state.projectAddTranslation.pastedText,
        providerId,
        modelId,
      }),
    });
    const next = {
      ...state.projectAddTranslation,
      jobId: response?.jobId ?? "",
      status: response?.status ?? "error",
      mismatch: response?.mismatch ?? null,
      existingTranslationCount: Number.isFinite(response?.existingTranslationCount)
        ? response.existingTranslationCount
        : 0,
      targetLanguageExists: response?.targetLanguageExists === true,
      progress: response?.progress ?? state.projectAddTranslation.progress,
      error: "",
    };
    if (response?.status === "mismatch") {
      state.projectAddTranslation = { ...next, step: "mismatchWarning" };
    } else if ((response?.existingTranslationCount ?? 0) > 0) {
      state.projectAddTranslation = { ...next, step: "existingTranslationWarning" };
    } else if (response?.status === "readyToApply") {
      state.projectAddTranslation = { ...next, step: "applying" };
      render();
      await applyProjectAddTranslation(render, { continueOnMismatch: false });
      return;
    } else {
      state.projectAddTranslation = {
        ...next,
        step: "selectLanguage",
        status: "idle",
        error: response?.error || "Alignment preflight did not complete.",
      };
    }
    render();
  } catch (error) {
    state.projectAddTranslation = {
      ...state.projectAddTranslation,
      step: "selectLanguage",
      status: "idle",
      error: formatErrorForDisplay(error),
    };
    render();
  }
}

export async function applyProjectAddTranslation(render, options = {}) {
  const modal = state.projectAddTranslation;
  if (!modal?.isOpen || !modal.jobId) {
    return;
  }
  state.projectAddTranslation = {
    ...modal,
    step: "applying",
    status: "running",
    error: "",
  };
  render();

  try {
    const response = await invoke("apply_aligned_translation_to_gtms_chapter", {
      input: baseInvokeInput({
        jobId: modal.jobId,
        continueOnMismatch: options.continueOnMismatch === true,
        writeMode: "fillEmptyOnly",
      }),
    });
    state.projectAddTranslation = {
      ...state.projectAddTranslation,
      step: "done",
      status: "complete",
      result: response,
      error: "",
    };
    const updated = Number(response?.updatedRowCount ?? 0);
    const inserted = Number(response?.insertedRowCount ?? 0);
    resetProjectAddTranslation();
    showNoticeBadge(`Added translation to ${updated + inserted} row${updated + inserted === 1 ? "" : "s"}.`, render, 2600);
  } catch (error) {
    state.projectAddTranslation = {
      ...state.projectAddTranslation,
      step: "applying",
      status: "idle",
      error: formatErrorForDisplay(error),
    };
    render();
  }
}
