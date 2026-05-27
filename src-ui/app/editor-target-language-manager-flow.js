import { requireBrokerSession } from "./auth-flow.js";
import { normalizeLanguageSelections } from "./editor-selection-flow.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import { createTargetLanguageManagerState, state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { requestEditorOperation } from "./editor-operation-queue.js";
import {
  assertQueuedEditorRowsReady,
  createQueuedEditorWritePermissionContext,
  editorChapterInvalidationKey,
  invokeQueuedEditorWriteCommand,
} from "./editor-queued-write.js";
import { projectRepoScope } from "./repo-write-queue.js";
import { findIsoLanguageOption, normalizeSupportedLanguageCode } from "../lib/language-options.js";
import {
  appendDuplicateLanguage,
  normalizeChapterLanguage,
  normalizeChapterLanguages,
  numberDuplicateLanguageGroups,
} from "./editor-language-utils.js";

export const MANAGE_CHAPTER_LANGUAGES_OPTION_VALUE = "__manage_target_languages__";
export const MANAGE_TARGET_LANGUAGES_OPTION_VALUE = MANAGE_CHAPTER_LANGUAGES_OPTION_VALUE;

function cloneManagedChapterLanguage(language) {
  return normalizeChapterLanguage(language);
}

function managedChapterLanguagesFromEditorState() {
  return normalizeChapterLanguages(state.editorChapter?.languages);
}

export function currentTargetLanguageManagerPickerScrollTop() {
  const list = globalThis.document?.querySelector?.("[data-target-language-manager-picker-list]");
  return Number.isFinite(list?.scrollTop) ? list.scrollTop : 0;
}

export function captureTargetLanguageManagerPickerScrollTop() {
  if (!state.targetLanguageManager?.isOpen || state.targetLanguageManager.isPickerOpen !== true) {
    return null;
  }

  const list = globalThis.document?.querySelector?.("[data-target-language-manager-picker-list]");
  if (!list || !Number.isFinite(list.scrollTop)) {
    return null;
  }

  const scrollTop = list.scrollTop;
  state.targetLanguageManager = {
    ...state.targetLanguageManager,
    pickerScrollTop: scrollTop,
  };
  return scrollTop;
}

export function restoreTargetLanguageManagerPickerScrollTop(scrollTop = state.targetLanguageManager?.pickerScrollTop) {
  if (!state.targetLanguageManager?.isOpen || state.targetLanguageManager.isPickerOpen !== true) {
    return;
  }
  if (!Number.isFinite(scrollTop)) {
    return;
  }

  const restore = () => {
    const list = globalThis.document?.querySelector?.("[data-target-language-manager-picker-list]");
    if (list) {
      list.scrollTop = scrollTop;
    }
  };

  restore();

  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(() => {
      const list = globalThis.document?.querySelector?.("[data-target-language-manager-picker-list]");
      if (list && list.scrollTop === scrollTop) {
        list.scrollTop = scrollTop;
      }
    });
  }
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

  const code = normalizeSupportedLanguageCode(languageCode);
  if (!code) {
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

  const code = normalizeSupportedLanguageCode(state.targetLanguageManager.pickerSelectedLanguageCode);
  if (!code) {
    return;
  }

  const option = findIsoLanguageOption(code);
  if (!option) {
    return;
  }

  state.targetLanguageManager = {
    ...state.targetLanguageManager,
    languages: appendDuplicateLanguage(state.targetLanguageManager.languages, option.code, "target"),
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
    languages: numberDuplicateLanguageGroups(
      languages.filter((_, languageIndex) => languageIndex !== index),
    ),
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
  const repoScope = projectRepoScope({ team, project: context?.project ?? null });
  if (
    !Number.isFinite(team?.installationId)
    || !context?.project?.name
    || !context?.project?.fullName
    || !modal.chapterId
    || !repoScope
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
    if (!(await operations.flushDirtyEditorRows?.(render, { waitForDurable: false }))) {
      state.targetLanguageManager = {
        ...state.targetLanguageManager,
        status: "idle",
        error: "Could not queue pending editor saves before changing chapter languages.",
      };
      render?.();
      return;
    }

    const operationValue = {
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
      chapterId: modal.chapterId,
      permissionContext: createQueuedEditorWritePermissionContext({
        team,
        project: context.project,
        chapter: context.chapter,
        actionKind: "sharedWrite",
      }),
    };

    const requested = requestEditorOperation({
      repoScope,
      chapterScope: `${repoScope}:${modal.chapterId}`,
      coalesceKey: `targetLanguages:${modal.chapterId}`,
      kind: "targetLanguages",
      value: operationValue,
      metadata: {
        projectId: context.project.id,
        chapterId: modal.chapterId,
        languageCodes: draftLanguages.map((language) => language.code).filter(Boolean),
      },
      invalidationKeys: [editorChapterInvalidationKey(repoScope, modal.chapterId)],
    }, {
      run: async (operation) => {
        assertQueuedEditorRowsReady({
          chapterId: operation.value.chapterId,
          includeAllRows: true,
          forbidPendingText: true,
          message: "Save, refresh, or resolve the file before changing chapter languages.",
        });
        return invokeQueuedEditorWriteCommand("update_gtms_chapter_languages", {
          sessionToken: operation.value.sessionToken,
          input: {
            ...operation.value.input,
          },
        }, operation.value.permissionContext, render);
      },
      onSuccess: (payload, operation) => {
        const value = operation?.value ?? operationValue;
        const nextSelections = normalizeLanguageSelections(
          payload.languages,
          payload.selectedSourceLanguageCode,
          payload.selectedTargetLanguageCode,
        );
        operations.applyChapterMetadataToState?.(value.chapterId, {
          languages: Array.isArray(payload.languages) ? payload.languages : [],
          selectedSourceLanguageCode: nextSelections.selectedSourceLanguageCode,
          selectedTargetLanguageCode: nextSelections.selectedTargetLanguageCode,
        });

        closeTargetLanguageManager();
        render?.();
        void operations.reloadSelectedChapterEditorData?.(render, { preserveVisibleRows: false });
      },
      onError: (error, operation) => {
        const value = operation?.value ?? operationValue;
        const message = error instanceof Error ? error.message : String(error);
        if (state.targetLanguageManager?.chapterId === value.chapterId) {
          state.targetLanguageManager = {
            ...state.targetLanguageManager,
            status: "idle",
            error: message || "The chapter languages could not be updated.",
          };
          render?.();
        } else {
          showNoticeBadge(message || "The chapter languages could not be updated.", render);
        }
      },
    });
    requested.promise.catch(() => {});
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
