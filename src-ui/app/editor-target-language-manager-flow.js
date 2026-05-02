import { requireBrokerSession } from "./auth-flow.js";
import { normalizeLanguageSelections } from "./editor-selection-flow.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import { invoke } from "./runtime.js";
import { createTargetLanguageManagerState, state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { findIsoLanguageOption } from "../lib/language-options.js";

export const MANAGE_CHAPTER_LANGUAGES_OPTION_VALUE = "__manage_target_languages__";
export const MANAGE_TARGET_LANGUAGES_OPTION_VALUE = MANAGE_CHAPTER_LANGUAGES_OPTION_VALUE;

function cloneManagedChapterLanguage(language) {
  const code = String(language?.code ?? "").trim().toLowerCase();
  if (!code) {
    return null;
  }

  const isoOption = findIsoLanguageOption(code);
  const name = String(language?.name ?? "").trim() || isoOption?.name || code;
  const role = String(language?.role ?? "").trim().toLowerCase() === "source"
    ? "source"
    : "target";
  return {
    code,
    name,
    role,
  };
}

function managedChapterLanguagesFromEditorState() {
  return (Array.isArray(state.editorChapter?.languages) ? state.editorChapter.languages : [])
    .map(cloneManagedChapterLanguage)
    .filter(Boolean);
}

function currentTargetLanguageManagerPickerScrollTop() {
  const list = globalThis.document?.querySelector?.("[data-target-language-manager-picker-list]");
  return Number.isFinite(list?.scrollTop) ? list.scrollTop : 0;
}

function restoreTargetLanguageManagerPickerScrollTop(scrollTop) {
  const restore = () => {
    const list = globalThis.document?.querySelector?.("[data-target-language-manager-picker-list]");
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

export function openTargetLanguageManager(render = null) {
  if (state.offline?.isEnabled === true) {
    showNoticeBadge("This operation is not supported in offline mode", render);
    return false;
  }

  state.targetLanguageManager = {
    ...createTargetLanguageManagerState(),
    isOpen: true,
    chapterId: state.editorChapter?.chapterId ?? null,
    languages: managedChapterLanguagesFromEditorState(),
  };
  return true;
}

export function closeTargetLanguageManager() {
  state.targetLanguageManager = createTargetLanguageManagerState();
}

export function openTargetLanguageManagerPicker() {
  if (!state.targetLanguageManager?.isOpen) {
    return;
  }

  state.targetLanguageManager = {
    ...state.targetLanguageManager,
    isPickerOpen: true,
    pickerSelectedLanguageCode: "",
    pickerScrollTop: 0,
    error: "",
  };
}

export function closeTargetLanguageManagerPicker() {
  if (!state.targetLanguageManager?.isOpen) {
    return;
  }

  state.targetLanguageManager = {
    ...state.targetLanguageManager,
    isPickerOpen: false,
    pickerSelectedLanguageCode: "",
    pickerScrollTop: 0,
  };
}

export function selectTargetLanguageManagerPickerLanguage(languageCode) {
  if (!state.targetLanguageManager?.isOpen) {
    return;
  }

  const code = String(languageCode ?? "").trim().toLowerCase();
  if (!code || state.targetLanguageManager.languages.some((language) => language.code === code)) {
    return;
  }

  const option = findIsoLanguageOption(code);
  if (!option) {
    return;
  }

  const scrollTop = currentTargetLanguageManagerPickerScrollTop();
  state.targetLanguageManager = {
    ...state.targetLanguageManager,
    pickerSelectedLanguageCode: option.code,
    pickerScrollTop: scrollTop,
    error: "",
  };
  restoreTargetLanguageManagerPickerScrollTop(scrollTop);
}

export function addTargetLanguageManagerLanguage() {
  if (!state.targetLanguageManager?.isOpen) {
    return;
  }

  const code = String(state.targetLanguageManager.pickerSelectedLanguageCode ?? "").trim().toLowerCase();
  if (!code || state.targetLanguageManager.languages.some((language) => language.code === code)) {
    return;
  }

  const option = findIsoLanguageOption(code);
  if (!option) {
    return;
  }

  state.targetLanguageManager = {
    ...state.targetLanguageManager,
    languages: [
      ...(Array.isArray(state.targetLanguageManager.languages) ? state.targetLanguageManager.languages : []),
      {
        code: option.code,
        name: option.name,
        role: "target",
      },
    ],
    isPickerOpen: false,
    pickerSelectedLanguageCode: "",
    pickerScrollTop: 0,
    error: "",
  };
}

export function removeTargetLanguageManagerLanguage(index) {
  if (
    !state.targetLanguageManager?.isOpen
    || !Number.isInteger(index)
    || index < 0
  ) {
    return;
  }

  const languages = Array.isArray(state.targetLanguageManager.languages)
    ? state.targetLanguageManager.languages
    : [];
  if (languages.length <= 1 || index >= languages.length) {
    return;
  }

  state.targetLanguageManager = {
    ...state.targetLanguageManager,
    languages: languages.filter((_, languageIndex) => languageIndex !== index),
    error: "",
  };
}

export function moveTargetLanguageManagerLanguageToIndex(fromIndex, toIndex) {
  if (
    !state.targetLanguageManager?.isOpen
    || !Number.isInteger(fromIndex)
    || fromIndex < 0
    || !Number.isInteger(toIndex)
    || toIndex < 0
  ) {
    return;
  }

  const languages = Array.isArray(state.targetLanguageManager.languages)
    ? [...state.targetLanguageManager.languages]
    : [];
  if (fromIndex >= languages.length) {
    return;
  }

  const boundedIndex = Math.min(toIndex, languages.length);
  const adjustedIndex = boundedIndex > fromIndex ? boundedIndex - 1 : boundedIndex;
  if (adjustedIndex === fromIndex) {
    return;
  }

  const [language] = languages.splice(fromIndex, 1);
  languages.splice(adjustedIndex, 0, language);
  state.targetLanguageManager = {
    ...state.targetLanguageManager,
    languages,
    error: "",
  };
}

export async function submitTargetLanguageManager(render, operations = {}) {
  const modal = state.targetLanguageManager;
  if (!modal?.isOpen || modal.status === "loading") {
    return;
  }

  if (state.offline?.isEnabled === true) {
    state.targetLanguageManager = {
      ...modal,
      status: "idle",
      error: "Language changes are unavailable offline.",
    };
    showNoticeBadge("This operation is not supported in offline mode", render);
    render?.();
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(modal.chapterId);
  if (
    !Number.isFinite(team?.installationId)
    || !context?.project?.name
    || !context?.project?.fullName
    || !modal.chapterId
  ) {
    state.targetLanguageManager = {
      ...modal,
      status: "idle",
      error: "Could not determine which file to update.",
    };
    render?.();
    return;
  }

  const draftLanguages = (Array.isArray(modal.languages) ? modal.languages : [])
    .map(cloneManagedChapterLanguage)
    .filter(Boolean);
  if (draftLanguages.length === 0) {
    state.targetLanguageManager = {
      ...modal,
      status: "idle",
      error: "A file must contain at least one language.",
    };
    render?.();
    return;
  }

  state.targetLanguageManager = {
    ...modal,
    status: "loading",
    error: "",
  };
  render?.();

  try {
    const sessionToken = requireBrokerSession();
    if (!(await operations.flushDirtyEditorRows?.(render))) {
      state.targetLanguageManager = {
        ...state.targetLanguageManager,
        status: "idle",
        error: "Resolve pending editor saves before changing chapter languages.",
      };
      render?.();
      return;
    }

    const payload = await invoke("update_gtms_chapter_languages", {
      sessionToken,
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        fullName: context.project.fullName,
        repoId: Number.isFinite(context.project.repoId) ? context.project.repoId : null,
        defaultBranchName: context.project.defaultBranchName ?? "main",
        defaultBranchHeadOid: context.project.defaultBranchHeadOid ?? null,
        chapterId: modal.chapterId,
        languages: draftLanguages,
      },
    });
    const nextSelections = normalizeLanguageSelections(
      payload.languages,
      payload.selectedSourceLanguageCode,
      payload.selectedTargetLanguageCode,
    );
    operations.applyChapterMetadataToState?.(modal.chapterId, {
      languages: Array.isArray(payload.languages) ? payload.languages : [],
      selectedSourceLanguageCode: nextSelections.selectedSourceLanguageCode,
      selectedTargetLanguageCode: nextSelections.selectedTargetLanguageCode,
    });

    closeTargetLanguageManager();
    render?.();
    await operations.reloadSelectedChapterEditorData?.(render, { preserveVisibleRows: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.targetLanguageManager = {
      ...state.targetLanguageManager,
      status: "idle",
      error: message || "The chapter languages could not be updated.",
    };
    render?.();
  }
}
