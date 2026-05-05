import {
  applyStoredSelectedTeamAiActionPreferences,
  ensureSharedAiActionConfigurationLoaded,
  openAiReviewMissingKeyModal,
  resolveAiReviewProviderAndModel,
} from "./ai-settings-flow.js";
import {
  EDITOR_ROW_FILTER_MODE_PLEASE_CHECK,
  normalizeEditorChapterFilterState,
} from "./editor-filters.js";
import { buildEditorAiTranslationGlossaryHints } from "./editor-glossary-highlighting.js";
import {
  flushDirtyEditorRows,
  hasPendingEditorWrites,
} from "./editor-persistence-flow.js";
import { cloneRowFields, cloneRowFieldStates, findEditorRowById, normalizeFieldState } from "./editor-utils.js";
import { reconcileDirtyTrackedEditorRows } from "./editor-dirty-row-state.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import { invoke } from "./runtime.js";
import { createEditorAiReviewAllModalState, state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { ensureSelectedTeamAiProviderReady } from "./team-ai-flow.js";
import { loadActiveEditorFieldHistory } from "./editor-history-flow.js";
import { languageBaseCode } from "./editor-language-utils.js";

let activeReviewAllRunId = 0;

function readRowFieldText(row, languageCode) {
  if (!languageCode) {
    return "";
  }
  return typeof row?.fields?.[languageCode] === "string"
    ? row.fields[languageCode]
    : String(row?.fields?.[languageCode] ?? "");
}

function selectedSourceLanguageCode(chapterState) {
  const selectedCode = String(chapterState?.selectedSourceLanguageCode ?? "").trim();
  if (selectedCode) {
    return selectedCode;
  }
  return (Array.isArray(chapterState?.languages) ? chapterState.languages : [])
    .find((language) => language?.role === "source")?.code
    ?? chapterState?.languages?.[0]?.code
    ?? "";
}

function selectedTargetLanguageCode(chapterState) {
  const selectedCode = String(chapterState?.selectedTargetLanguageCode ?? "").trim();
  if (selectedCode) {
    return selectedCode;
  }
  const sourceCode = selectedSourceLanguageCode(chapterState);
  return (Array.isArray(chapterState?.languages) ? chapterState.languages : [])
    .find((language) => language?.code && language.code !== sourceCode)?.code
    ?? "";
}

function languageByCode(chapterState, languageCode) {
  const code = String(languageCode ?? "").trim();
  return (Array.isArray(chapterState?.languages) ? chapterState.languages : [])
    .find((language) => language?.code === code) ?? null;
}

function reviewableTranslationRows(chapterState, languageCode = selectedTargetLanguageCode(chapterState)) {
  const code = String(languageCode ?? "").trim();
  if (!code) {
    return [];
  }
  return (Array.isArray(chapterState?.rows) ? chapterState.rows : []).filter((row) =>
    row?.rowId
    && row.lifecycleState !== "deleted"
    && readRowFieldText(row, code).trim()
  );
}

function buildEditorAiReviewAllWork(chapterState) {
  const languageCode = selectedTargetLanguageCode(chapterState);
  return reviewableTranslationRows(chapterState, languageCode)
    .filter((row) => row.fieldStates?.[languageCode]?.reviewed !== true)
    .map((row) => ({ rowId: row.rowId, languageCode }));
}

function buildEditorAiReviewAllCounts(chapterState) {
  const languageCode = selectedTargetLanguageCode(chapterState);
  const translations = reviewableTranslationRows(chapterState, languageCode);
  const reviewedCount = translations.filter((row) => row.fieldStates?.[languageCode]?.reviewed === true).length;
  return {
    languageCode,
    reviewedCount,
    totalTranslationCount: translations.length,
    totalCount: translations.length - reviewedCount,
  };
}

function buildLanguageProgress(languageCode, totalCount, completedCount = 0) {
  return {
    [languageCode]: {
      completedCount,
      totalCount,
    },
  };
}

function applyEditorAiReviewAllModal(updates) {
  if (!state.editorChapter?.chapterId) {
    return;
  }
  state.editorChapter = {
    ...state.editorChapter,
    aiReviewAllModal: {
      ...createEditorAiReviewAllModalState(),
      ...state.editorChapter.aiReviewAllModal,
      ...updates,
    },
  };
}

function chapterNeedsRefreshBeforeReview(chapterState = state.editorChapter) {
  if (chapterState?.deferredStructuralChanges === true) {
    return true;
  }
  return (Array.isArray(chapterState?.rows) ? chapterState.rows : []).some((row) =>
    row?.freshness === "stale"
    || row?.freshness === "staleDirty"
    || row?.freshness === "conflict"
    || row?.remotelyDeleted === true
  );
}

function normalizeReviewMode(value) {
  return value === "meaning" ? "meaning" : "grammar";
}

function resolveDirectGlossaryHints(row, sourceLanguageCode, targetLanguageCode) {
  const glossaryState = state.editorChapter?.glossary ?? null;
  const glossaryModel = glossaryState?.matcherModel ?? null;
  const glossarySourceLanguageCode =
    String(glossaryState?.sourceLanguage?.code ?? glossaryModel?.sourceLanguage?.code ?? "").trim();
  const glossaryTargetLanguageCode =
    String(glossaryState?.targetLanguage?.code ?? glossaryModel?.targetLanguage?.code ?? "").trim();
  const sourceLanguage = languageByCode(state.editorChapter, sourceLanguageCode);
  const targetLanguage = languageByCode(state.editorChapter, targetLanguageCode);
  if (
    !glossaryModel
    || glossarySourceLanguageCode !== languageBaseCode(sourceLanguage)
    || glossaryTargetLanguageCode !== languageBaseCode(targetLanguage)
  ) {
    return [];
  }
  return buildEditorAiTranslationGlossaryHints(
    readRowFieldText(row, sourceLanguageCode),
    languageBaseCode(sourceLanguage),
    languageBaseCode(targetLanguage),
    glossaryModel,
  );
}

function applyReviewResultToRow(row, languageCode, payload) {
  const nextText = String(payload?.text ?? row.fields?.[languageCode] ?? "");
  const nextFieldState = normalizeFieldState({
    reviewed: payload?.reviewed,
    pleaseCheck: payload?.pleaseCheck,
  });
  const fields = cloneRowFields(row.fields);
  fields[languageCode] = nextText;
  return {
    ...row,
    fields,
    persistedFields: cloneRowFields(fields),
    fieldStates: {
      ...cloneRowFieldStates(row.fieldStates),
      [languageCode]: nextFieldState,
    },
    persistedFieldStates: {
      ...cloneRowFieldStates(row.persistedFieldStates),
      [languageCode]: nextFieldState,
    },
    lastUpdate: payload?.lastUpdate ?? row.lastUpdate ?? null,
    saveStatus: "idle",
    saveError: "",
    freshness: "fresh",
    markerSaveState: {
      status: "idle",
      languageCode: null,
      kind: null,
      error: "",
    },
  };
}

function enablePleaseCheckFilterAndShowModal(error = "") {
  if (!state.editorChapter?.chapterId) {
    return;
  }
  const filters = normalizeEditorChapterFilterState(state.editorChapter.filters);
  state.editorChapter = {
    ...state.editorChapter,
    filters: {
      ...filters,
      rowFilterMode: EDITOR_ROW_FILTER_MODE_PLEASE_CHECK,
    },
    aiReviewAllModal: {
      ...createEditorAiReviewAllModalState(),
      isOpen: true,
      step: "filter-enabled",
      error,
    },
  };
}

export function openEditorAiReviewAllModal(render) {
  if (!state.editorChapter?.chapterId) {
    return;
  }
  if (state.offline?.isEnabled === true) {
    showNoticeBadge("This operation is not supported in offline mode", render);
    return;
  }

  const counts = buildEditorAiReviewAllCounts(state.editorChapter);
  const step = counts.reviewedCount > 0 ? "preflight" : "configure";
  state.editorChapter = {
    ...state.editorChapter,
    aiReviewAllModal: {
      ...createEditorAiReviewAllModalState(),
      isOpen: true,
      step,
      languageCode: counts.languageCode,
      reviewedCount: counts.reviewedCount,
      totalTranslationCount: counts.totalTranslationCount,
      totalCount: counts.totalCount,
      languageProgress: buildLanguageProgress(counts.languageCode, counts.totalCount),
    },
  };
  render?.();
}

export function continueEditorAiReviewAllPreflight(render) {
  if (!state.editorChapter?.chapterId || state.editorChapter.aiReviewAllModal?.status === "loading") {
    return;
  }
  applyEditorAiReviewAllModal({
    step: "configure",
    error: "",
  });
  render?.();
}

export function cancelEditorAiReviewAllModal(render) {
  if (!state.editorChapter?.chapterId) {
    return;
  }
  if (state.editorChapter.aiReviewAllModal?.step === "reviewing") {
    activeReviewAllRunId += 1;
  }
  state.editorChapter = {
    ...state.editorChapter,
    aiReviewAllModal: createEditorAiReviewAllModalState(),
  };
  render?.();
}

export function dismissEditorAiReviewAllFilterModal(render) {
  if (!state.editorChapter?.chapterId) {
    return;
  }
  state.editorChapter = {
    ...state.editorChapter,
    aiReviewAllModal: createEditorAiReviewAllModalState(),
  };
  render?.();
}

export function updateEditorAiReviewAllMode(render, mode) {
  if (!state.editorChapter?.chapterId || state.editorChapter.aiReviewAllModal?.step === "reviewing") {
    return;
  }
  applyEditorAiReviewAllModal({
    reviewMode: normalizeReviewMode(mode),
    error: "",
  });
  render?.();
}

async function ensureAiReviewAllProviderReady(render) {
  const configRender = (options = null) => {
    if (options?.scope) {
      render?.(options);
    } else {
      render?.();
    }
  };
  const usedStoredTeamActionPreferences = applyStoredSelectedTeamAiActionPreferences(configRender);
  try {
    await ensureSharedAiActionConfigurationLoaded(configRender);
  } catch (error) {
    if (selectedProjectsTeam()?.canDelete !== true && !usedStoredTeamActionPreferences) {
      throw error;
    }
  }
  const { providerId, modelId } = resolveAiReviewProviderAndModel();
  if (!modelId) {
    throw new Error("Select a model for AI Review on the AI Settings page first.");
  }
  const ensureKeyResult = await ensureSelectedTeamAiProviderReady(configRender, providerId);
  if (!ensureKeyResult?.ok) {
    openAiReviewMissingKeyModal();
    throw new Error("The AI provider is not ready.");
  }
  return { providerId, modelId };
}

export async function confirmEditorAiReviewAll(render, operations = {}) {
  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId || editorChapter.aiReviewAllModal?.status === "loading") {
    return;
  }
  if (state.offline?.isEnabled === true) {
    applyEditorAiReviewAllModal({ error: "AI actions are unavailable offline." });
    showNoticeBadge("This operation is not supported in offline mode", render);
    render?.();
    return;
  }

  await flushDirtyEditorRows(render, operations);
  if (state.editorChapter?.chapterId !== editorChapter.chapterId) {
    return;
  }
  if (hasPendingEditorWrites(state.editorChapter)) {
    applyEditorAiReviewAllModal({
      step: "configure",
      status: "idle",
      error: "Save all row text before running AI Review.",
    });
    render?.();
    return;
  }
  if (chapterNeedsRefreshBeforeReview(state.editorChapter)) {
    applyEditorAiReviewAllModal({
      step: "configure",
      status: "idle",
      error: "Refresh or resolve the file before running AI Review.",
    });
    render?.();
    return;
  }

  const counts = buildEditorAiReviewAllCounts(state.editorChapter);
  const work = buildEditorAiReviewAllWork(state.editorChapter);
  if (!counts.languageCode || work.length === 0) {
    applyEditorAiReviewAllModal({
      step: "configure",
      status: "idle",
      languageCode: counts.languageCode,
      reviewedCount: counts.reviewedCount,
      totalTranslationCount: counts.totalTranslationCount,
      totalCount: 0,
      languageProgress: buildLanguageProgress(counts.languageCode, 0),
      error: "There are no unreviewed translations to review.",
    });
    render?.();
    return;
  }

  let providerId = "";
  let modelId = "";
  try {
    ({ providerId, modelId } = await ensureAiReviewAllProviderReady(render));
  } catch (error) {
    applyEditorAiReviewAllModal({
      step: "configure",
      status: "idle",
      error: error instanceof Error ? error.message : String(error),
    });
    render?.();
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    applyEditorAiReviewAllModal({
      step: "configure",
      status: "idle",
      error: "Could not resolve the current project.",
    });
    render?.();
    return;
  }

  const runId = activeReviewAllRunId + 1;
  activeReviewAllRunId = runId;
  const reviewMode = normalizeReviewMode(state.editorChapter.aiReviewAllModal?.reviewMode);
  const sourceLanguageCode = selectedSourceLanguageCode(state.editorChapter);
  const targetLanguageCode = counts.languageCode;
  const targetLanguage = languageByCode(state.editorChapter, targetLanguageCode);
  let completedCount = 0;
  let started = false;
  applyEditorAiReviewAllModal({
    isOpen: true,
    step: "reviewing",
    status: "loading",
    error: "",
    reviewMode,
    languageCode: targetLanguageCode,
    reviewedCount: counts.reviewedCount,
    totalTranslationCount: counts.totalTranslationCount,
    completedCount,
    totalCount: work.length,
    languageProgress: buildLanguageProgress(targetLanguageCode, work.length, completedCount),
  });
  render?.();

  try {
    for (const item of work) {
      if (
        activeReviewAllRunId !== runId
        || state.editorChapter?.aiReviewAllModal?.step !== "reviewing"
      ) {
        if (started) {
          enablePleaseCheckFilterAndShowModal();
          render?.();
        }
        return;
      }

      const row = findEditorRowById(item.rowId, state.editorChapter);
      const latestTranslation = readRowFieldText(row, targetLanguageCode);
      if (!row || !latestTranslation.trim() || row.fieldStates?.[targetLanguageCode]?.reviewed === true) {
        continue;
      }

      started = true;
      const sourceText = readRowFieldText(row, sourceLanguageCode);
      const reviewPayload = await invoke("run_ai_review", {
        request: {
          providerId,
          modelId,
          reviewMode,
          text: latestTranslation,
          latestTranslation,
          sourceText,
          languageCode: languageBaseCode(targetLanguage) || targetLanguageCode,
          glossaryHints: reviewMode === "meaning"
            ? resolveDirectGlossaryHints(row, sourceLanguageCode, targetLanguageCode)
            : [],
          installationId: team.installationId,
        },
      });
      if (
        activeReviewAllRunId !== runId
        || state.editorChapter?.aiReviewAllModal?.step !== "reviewing"
      ) {
        enablePleaseCheckFilterAndShowModal();
        render?.();
        return;
      }

      const reviewed = reviewPayload?.reviewed === true;
      const suggestedText = reviewed ? "" : String(reviewPayload?.suggestedText ?? "");
      const savePayload = await invoke("apply_gtms_editor_ai_review_result", {
        input: {
          installationId: team.installationId,
          projectId: context.project.id,
          repoName: context.project.name,
          chapterId: editorChapter.chapterId,
          rowId: item.rowId,
          languageCode: targetLanguageCode,
          suggestedText,
          reviewed,
          pleaseCheck: !reviewed,
          aiModel: modelId,
        },
      });
      if (state.editorChapter?.chapterId !== editorChapter.chapterId) {
        return;
      }
      operations.updateEditorChapterRow?.(item.rowId, (currentRow) =>
        applyReviewResultToRow(currentRow, targetLanguageCode, savePayload),
      );
      state.editorChapter = {
        ...state.editorChapter,
        chapterBaseCommitSha:
          typeof savePayload?.chapterBaseCommitSha === "string" && savePayload.chapterBaseCommitSha.trim()
            ? savePayload.chapterBaseCommitSha.trim()
            : state.editorChapter.chapterBaseCommitSha,
      };
      reconcileDirtyTrackedEditorRows([item.rowId]);
      if (
        state.editorChapter.activeRowId === item.rowId
        && state.editorChapter.activeLanguageCode === targetLanguageCode
      ) {
        loadActiveEditorFieldHistory(render);
      }

      completedCount += 1;
      applyEditorAiReviewAllModal({
        step: "reviewing",
        status: "loading",
        completedCount,
        totalCount: work.length,
        languageProgress: buildLanguageProgress(targetLanguageCode, work.length, completedCount),
      });
      render?.({ scope: "translate-visible-rows", rowIds: [item.rowId], reason: "ai-review-all" });
      render?.({ scope: "translate-ai-review-all-modal" });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (started) {
      enablePleaseCheckFilterAndShowModal(message);
      showNoticeBadge(message || "AI Review failed.", render);
      render?.();
      return;
    }
    applyEditorAiReviewAllModal({
      step: "configure",
      status: "idle",
      error: message,
    });
    render?.();
    return;
  }

  if (activeReviewAllRunId !== runId) {
    if (started) {
      enablePleaseCheckFilterAndShowModal();
      render?.();
    }
    return;
  }
  enablePleaseCheckFilterAndShowModal();
  render?.();
}

export const editorAiReviewAllTestApi = {
  buildEditorAiReviewAllCounts,
  buildEditorAiReviewAllWork,
  getActiveReviewAllRunId: () => activeReviewAllRunId,
  resetActiveReviewAllRunId: () => {
    activeReviewAllRunId = 0;
  },
  reviewableTranslationRows,
};
