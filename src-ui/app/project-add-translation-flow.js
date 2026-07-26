import { AI_ACTION_LABELS } from "./ai-action-config.js";
import { formatErrorForDisplay } from "./error-display.js";
import { findIsoLanguageOption, normalizeSupportedLanguageCode } from "../lib/language-options.js";
import { invoke, listen } from "./runtime.js";
import { findChapterContext, selectedProjectsTeam } from "./project-context.js";
import { showNoticeBadge } from "./status-feedback.js";
import { createProjectAddTranslationState, state } from "./state.js";
import {
  languageBaseCode,
  languageMatchesBaseCode,
  normalizeChapterLanguages,
} from "./editor-language-utils.js";
import {
  openAiMissingKeyModal,
  resolveAiActionProviderAndModel,
} from "./ai-settings-flow.js";
import { ensureSelectedTeamAiProviderReady } from "./team-ai-flow.js";
import { openLocalFilePathPicker, openLocalFilePicker } from "./local-file-picker.js";
import { enforceImportFileSizeLimit } from "./import-file-limit.js";
import { normalizeProjectDocumentInputMode } from "./project-document-input.js";

export const ALIGNED_TRANSLATION_PROGRESS_EVENT = "aligned-translation-progress";
export const PROJECT_ADD_TRANSLATION_ACCEPT =
  ".txt,text/plain,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.rtf,application/rtf,text/rtf";
export const PROJECT_ADD_TRANSLATION_DIALOG_FILTERS = [{
  name: "Translation documents",
  extensions: ["txt", "docx", "rtf"],
}];

let progressUnlistenPromise = null;
let inputRequestSequence = 0;

function inputFileName(value, fallback = "translation") {
  const name = typeof value?.name === "string" ? value.name.trim() : "";
  return name || fallback;
}

function pathFileName(path) {
  return String(path ?? "").split(/[\\/]/).filter(Boolean).pop() || "translation";
}

function supportedTranslationFileName(fileName) {
  return /\.(txt|docx|rtf)$/i.test(String(fileName ?? "").trim());
}

function decodeBase64ToBytes(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error("The selected file could not be read.");
  }
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(normalized);
    return Array.from(binary, (character) => character.charCodeAt(0));
  }
  if (typeof Buffer === "function") {
    return Array.from(Buffer.from(normalized, "base64"));
  }
  throw new Error("Base64 decoding is unavailable.");
}

async function translationFileBytes(file) {
  if (typeof file?.path === "string" && file.path.trim()) {
    const local = await invoke("read_local_dropped_file", { path: file.path.trim() });
    return decodeBase64ToBytes(local?.dataBase64);
  }
  if (typeof file?.dataBase64 === "string") {
    return decodeBase64ToBytes(file.dataBase64);
  }
  if (typeof file?.arrayBuffer === "function") {
    enforceImportFileSizeLimit(file.size, inputFileName(file));
    return Array.from(new Uint8Array(await file.arrayBuffer()));
  }
  throw new Error("The selected file could not be read.");
}

function linkImportErrorKind(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("PROJECT_IMPORT_LINK_ACCESS_DENIED:")
    ? "accessDenied"
    : "invalid";
}

function isGoogleDocsDocumentUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    return (
      url.protocol === "https:"
      && url.hostname.toLowerCase() === "docs.google.com"
      && /^\/document\/d\/[^/]+/.test(url.pathname)
    );
  } catch {
    return false;
  }
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

function applyProjectAddTranslationNotice(response) {
  const updated = Number(response?.updatedRowCount ?? 0);
  const inserted = Number(response?.insertedRowCount ?? 0);
  const total = updated + inserted;
  if (total > 0) {
    return `Added translation to ${total} row${total === 1 ? "" : "s"}.`;
  }
  return "Added translation.";
}

function finishProjectAddTranslationApply(render, response, expectedJobId = "") {
  const modal = state.projectAddTranslation;
  if (expectedJobId && (!modal?.isOpen || modal.jobId !== expectedJobId)) {
    return false;
  }
  state.projectAddTranslation = {
    ...modal,
    step: "done",
    status: "complete",
    result: response ?? null,
    error: "",
  };
  resetProjectAddTranslation();
  render?.();
  showNoticeBadge(applyProjectAddTranslationNotice(response), render, 2600);
  return true;
}

function currentProjectAddTranslationLanguageScrollTop() {
  const list = globalThis.document?.querySelector?.("[data-project-add-translation-language-list]");
  return Number.isFinite(list?.scrollTop) ? list.scrollTop : 0;
}

function restoreProjectAddTranslationLanguageScrollTop(scrollTop) {
  const restore = () => {
    const list = globalThis.document?.querySelector?.("[data-project-add-translation-language-list]");
    if (list && Number.isFinite(scrollTop)) {
      list.scrollTop = scrollTop;
    }
  };

  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(restore);
    return;
  }

  if (typeof globalThis.setTimeout === "function") {
    globalThis.setTimeout(restore, 0);
    return;
  }

  restore();
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
    const payloadJobId = typeof payload?.jobId === "string" ? payload.jobId.trim() : "";
    const modalJobId = typeof modal?.jobId === "string" ? modal.jobId.trim() : "";
    const canClaimJob =
      !modalJobId
      && payloadJobId
      && (modal?.step === "aligning" || modal?.step === "applying");
    if (
      !modal?.isOpen
      || !payloadJobId
      || (modalJobId && payloadJobId !== modalJobId)
      || (!modalJobId && !canClaimJob)
    ) {
      return;
    }
    const nextStep =
      payload.stageId === "apply" || modal.step === "applying" ? "applying" : "aligning";
    const isApplyComplete = payload.stageId === "apply" && payload.status === "complete";
    state.projectAddTranslation = {
      ...modal,
      jobId: modalJobId || payloadJobId,
      flow: payload.flow ? payload.flow : modal.flow,
      progress: payload,
      step: nextStep,
    };
    if (isApplyComplete) {
      finishProjectAddTranslationApply(render, null, payloadJobId);
      return;
    }
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
    step: "input",
    inputMode: "upload",
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
}

export function selectProjectAddTranslationInputMode(render, mode) {
  const modal = state.projectAddTranslation;
  if (!modal?.isOpen || modal.status === "extracting" || modal.status === "resolvingLink") {
    return;
  }
  inputRequestSequence += 1;
  state.projectAddTranslation = {
    ...modal,
    step: "input",
    inputMode: normalizeProjectDocumentInputMode(mode),
    status: "idle",
    error: "",
    linkErrorModal: null,
    inputRequestId: inputRequestSequence,
  };
  render();
}

export function updateProjectAddTranslationLink(render, value) {
  const modal = state.projectAddTranslation;
  if (!modal?.isOpen || modal.status === "extracting" || modal.status === "resolvingLink") {
    return;
  }
  state.projectAddTranslation = {
    ...modal,
    linkUrl: typeof value === "string" ? value : "",
    error: "",
    linkErrorModal: null,
  };
}

async function extractProjectAddTranslationFile(render, file) {
  const modal = state.projectAddTranslation;
  const fileName = inputFileName(file);
  if (!modal?.isOpen) {
    return;
  }
  if (!supportedTranslationFileName(fileName)) {
    state.projectAddTranslation = {
      ...modal,
      status: "idle",
      error: "Choose a TXT, DOCX, or RTF file.",
    };
    render();
    return;
  }

  const requestId = ++inputRequestSequence;
  state.projectAddTranslation = {
    ...modal,
    status: "extracting",
    inputRequestId: requestId,
    pendingFileName: fileName,
    error: "",
    linkErrorModal: null,
  };
  render();

  try {
    const bytes = await translationFileBytes(file);
    const response = await invoke("extract_project_translation_text", {
      input: { fileName, bytes },
    });
    const current = state.projectAddTranslation;
    if (!current?.isOpen || current.inputRequestId !== requestId) {
      return;
    }
    const plainText = typeof response?.plainText === "string" ? response.plainText : "";
    if (!plainText.trim()) {
      throw new Error("The selected file does not contain any readable text.");
    }
    state.projectAddTranslation = {
      ...current,
      pastedText: plainText,
      step: "selectLanguage",
      status: "idle",
      pendingFileName: fileName,
      error: "",
    };
    render();
  } catch (error) {
    const current = state.projectAddTranslation;
    if (!current?.isOpen || current.inputRequestId !== requestId) {
      return;
    }
    state.projectAddTranslation = {
      ...current,
      status: "idle",
      error: formatErrorForDisplay(error),
    };
    render();
  }
}

export async function selectProjectAddTranslationFile(render) {
  const modal = state.projectAddTranslation;
  if (!modal?.isOpen || modal.status === "extracting" || modal.status === "resolvingLink") {
    return;
  }
  const paths = await openLocalFilePathPicker({
    multiple: false,
    filters: PROJECT_ADD_TRANSLATION_DIALOG_FILTERS,
  });
  if (paths === null) {
    const file = await openLocalFilePicker({
      accept: PROJECT_ADD_TRANSLATION_ACCEPT,
      multiple: false,
    });
    if (file) {
      await extractProjectAddTranslationFile(render, file);
    }
    return;
  }
  const path = paths[0];
  if (path) {
    await extractProjectAddTranslationFile(render, { name: pathFileName(path), path });
  }
}

export async function handleDroppedProjectAddTranslationFiles(render, files) {
  const normalized = Array.isArray(files) ? files.filter(Boolean) : [];
  if (normalized.length !== 1) {
    state.projectAddTranslation = {
      ...state.projectAddTranslation,
      error: "Drop one TXT, DOCX, or RTF file.",
    };
    render();
    return;
  }
  await extractProjectAddTranslationFile(render, normalized[0]);
}

export async function handleDroppedProjectAddTranslationPaths(render, paths) {
  const normalized = Array.isArray(paths)
    ? paths.filter((path) => typeof path === "string" && path.trim())
    : [];
  if (normalized.length !== 1) {
    state.projectAddTranslation = {
      ...state.projectAddTranslation,
      error: "Drop one TXT, DOCX, or RTF file.",
    };
    render();
    return;
  }
  const path = normalized[0].trim();
  await extractProjectAddTranslationFile(render, { name: pathFileName(path), path });
}

export async function submitProjectAddTranslationLink(render) {
  const modal = state.projectAddTranslation;
  if (!modal?.isOpen || modal.status === "extracting" || modal.status === "resolvingLink") {
    return;
  }
  const url = String(modal.linkUrl ?? "").trim();
  if (!isGoogleDocsDocumentUrl(url)) {
    state.projectAddTranslation = {
      ...modal,
      linkErrorModal: "invalid",
      error: "",
    };
    render();
    return;
  }
  const requestId = ++inputRequestSequence;
  state.projectAddTranslation = {
    ...modal,
    status: "resolvingLink",
    inputRequestId: requestId,
    error: "",
    linkErrorModal: null,
  };
  render();
  try {
    const resolved = await invoke("resolve_project_import_link", {
      input: { url, allowedFileTypes: ["docx"] },
    });
    const current = state.projectAddTranslation;
    if (!current?.isOpen || current.inputRequestId !== requestId) {
      return;
    }
    await extractProjectAddTranslationFile(render, {
      name: typeof resolved?.fileName === "string" ? resolved.fileName : "google-doc.docx",
      dataBase64: resolved?.dataBase64,
    });
  } catch (error) {
    const current = state.projectAddTranslation;
    if (!current?.isOpen || current.inputRequestId !== requestId) {
      return;
    }
    state.projectAddTranslation = {
      ...current,
      status: "idle",
      linkErrorModal: linkImportErrorKind(error),
      error: "",
    };
    render();
  }
}

export function closeProjectAddTranslationLinkError(render) {
  state.projectAddTranslation = {
    ...state.projectAddTranslation,
    status: "idle",
    linkErrorModal: null,
  };
  render();
}

export async function retryProjectAddTranslationLink(render) {
  state.projectAddTranslation = {
    ...state.projectAddTranslation,
    linkErrorModal: null,
  };
  await submitProjectAddTranslationLink(render);
}

export function cancelProjectAddTranslation(render) {
  inputRequestSequence += 1;
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
  const scrollTop = currentProjectAddTranslationLanguageScrollTop();
  if (!findIsoLanguageOption(targetLanguageCode)) {
    state.projectAddTranslation = {
      ...modal,
      targetLanguageCode: "",
      error: "Select a supported language.",
    };
    render();
    restoreProjectAddTranslationLanguageScrollTop(scrollTop);
    return;
  }
  const context = currentContext();
  const sourceLanguage = normalizeChapterLanguages(context?.chapter?.languages)
    .find((language) => language.code === modal.sourceLanguageCode);
  if (sourceLanguage && languageMatchesBaseCode(sourceLanguage, targetLanguageCode)) {
    state.projectAddTranslation = {
      ...modal,
      targetLanguageCode: "",
      error: "Choose a translation language different from the source language.",
    };
    render();
    restoreProjectAddTranslationLanguageScrollTop(scrollTop);
    return;
  }
  state.projectAddTranslation = {
    ...modal,
    targetLanguageCode,
    error: "",
  };
  render();
  restoreProjectAddTranslationLanguageScrollTop(scrollTop);
}

export async function continueProjectAddTranslationLanguage(render) {
  const modal = state.projectAddTranslation;
  if (!modal?.isOpen || modal.step !== "selectLanguage") {
    return;
  }
  if (!normalizeSupportedLanguageCode(modal.targetLanguageCode)) {
    state.projectAddTranslation = {
      ...modal,
      targetLanguageCode: "",
      error: "Select a language before continuing.",
    };
    render();
    return;
  }
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
  const context = currentContext();
  const sourceLanguage = normalizeChapterLanguages(context?.chapter?.languages)
    .find((language) => language.code === modal.sourceLanguageCode);
  if (sourceLanguage && languageBaseCode(sourceLanguage) === modal.targetLanguageCode) {
    state.projectAddTranslation = {
      ...modal,
      step: "selectLanguage",
      status: "idle",
      error: "Choose a translation language different from the source language.",
    };
    render();
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
    flow: state.projectAddTranslation.flow,
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
      targetLanguageCode:
        typeof response?.targetLanguageCode === "string" && response.targetLanguageCode.trim()
          ? response.targetLanguageCode.trim()
          : state.projectAddTranslation.targetLanguageCode,
      targetLanguageExists: response?.targetLanguageExists === true,
      flow: response?.flow || state.projectAddTranslation.flow || "",
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
  const applyJobId = modal.jobId;
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
    finishProjectAddTranslationApply(render, response, applyJobId);
  } catch (error) {
    const current = state.projectAddTranslation;
    if (!current?.isOpen || (current.jobId && current.jobId !== applyJobId)) {
      showNoticeBadge(formatErrorForDisplay(error), render, 3200);
      return;
    }
    state.projectAddTranslation = {
      ...current,
      step: "applying",
      status: "idle",
      error: formatErrorForDisplay(error),
    };
    render();
  }
}
