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
import {
  flushDirtyEditorRows,
  hasPendingEditorWrites,
} from "./editor-persistence-flow.js";
import {
  buildEditorAiReviewBatchRequest,
  buildEditorAiReviewRequest,
  editorReviewLanguageByCode,
  normalizeEditorAiReviewMode,
  readEditorReviewRowFieldText,
  readEditorReviewRowFootnote,
  readEditorReviewRowImageCaption,
  selectedEditorReviewSourceLanguageCode,
  selectedEditorReviewTargetLanguageCode,
} from "./editor-ai-review-request.js";
import {
  chunkTranslateAllWork,
  estimateSourceTokens,
  mapWithConcurrency,
} from "./editor-ai-batch-request.js";
import { loadAssistantTargetLanguageHistory } from "./editor-ai-assistant-flow.js";
import {
  cloneRowFields,
  cloneRowFieldStates,
  cloneRowFootnotes,
  editorFootnotesPlainText,
  findEditorRowById,
  normalizeFieldState,
} from "./editor-utils.js";
import { applyEditorFootnoteText } from "./editor-footnotes.js";
import { reconcileDirtyTrackedEditorRows } from "./editor-dirty-row-state.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import { invoke } from "./runtime.js";
import { createEditorAiReviewAllModalState, state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { reportBackendNonfatalError } from "./telemetry.js";
import { ensureSelectedTeamAiProviderReady } from "./team-ai-flow.js";
import { loadActiveEditorFieldHistory } from "./editor-history-flow.js";
import { invokeEditorWriteCommand } from "./editor-write-permission.js";

let activeReviewAllRunId = 0;

function reviewableTranslationRows(chapterState, languageCode = selectedEditorReviewTargetLanguageCode(chapterState)) {
  const code = String(languageCode ?? "").trim();
  if (!code) {
    return [];
  }
  return (Array.isArray(chapterState?.rows) ? chapterState.rows : []).filter((row) =>
    row?.rowId
    && row.lifecycleState !== "deleted"
    && (
      readEditorReviewRowFieldText(row, code).trim()
      || readEditorReviewRowFootnote(row, code).trim()
      || readEditorReviewRowImageCaption(row, code).trim()
    )
  );
}

function buildEditorAiReviewAllWork(chapterState) {
  const languageCode = selectedEditorReviewTargetLanguageCode(chapterState);
  return reviewableTranslationRows(chapterState, languageCode)
    .filter((row) => row.fieldStates?.[languageCode]?.reviewed !== true)
    .map((row) => ({ rowId: row.rowId, languageCode }));
}

function buildEditorAiReviewAllCounts(chapterState) {
  const languageCode = selectedEditorReviewTargetLanguageCode(chapterState);
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

function isAiReviewAllBusy(modal) {
  return modal?.status === "loading" || modal?.status === "preparing";
}

function isActiveAiReviewAllRun(runId, chapterId) {
  return (
    activeReviewAllRunId === runId
    && state.editorChapter?.chapterId === chapterId
    && state.editorChapter?.aiReviewAllModal?.step === "reviewing"
  );
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

function applyReviewResultToRow(row, languageCode, payload) {
  const nextText = String(payload?.text ?? row.fields?.[languageCode] ?? "");
  const nextFootnote = String(payload?.footnote ?? editorFootnotesPlainText(row.footnotes?.[languageCode]) ?? "");
  const nextImageCaption = String(payload?.imageCaption ?? row.imageCaptions?.[languageCode] ?? "");
  const nextFieldState = normalizeFieldState({
    reviewed: payload?.reviewed,
    pleaseCheck: payload?.pleaseCheck,
  });
  const fields = cloneRowFields(row.fields);
  fields[languageCode] = nextText;
  const footnotes = cloneRowFootnotes(row.footnotes);
  if (nextFootnote.trim()) {
    footnotes[languageCode] = applyEditorFootnoteText(footnotes[languageCode], 1, nextFootnote);
  }
  const imageCaptions = cloneRowFields(row.imageCaptions);
  imageCaptions[languageCode] = nextImageCaption;
  return {
    ...row,
    fields,
    footnotes,
    imageCaptions,
    persistedFields: cloneRowFields(fields),
    persistedFootnotes: cloneRowFootnotes(footnotes),
    persistedImageCaptions: cloneRowFields(imageCaptions),
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
  if (!state.editorChapter?.chapterId || isAiReviewAllBusy(state.editorChapter.aiReviewAllModal)) {
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
    reviewMode: normalizeEditorAiReviewMode(mode),
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
  if (!editorChapter?.chapterId || isAiReviewAllBusy(editorChapter.aiReviewAllModal)) {
    return;
  }
  if (state.offline?.isEnabled === true) {
    applyEditorAiReviewAllModal({ error: "AI actions are unavailable offline." });
    showNoticeBadge("This operation is not supported in offline mode", render);
    render?.();
    return;
  }

  const runId = activeReviewAllRunId + 1;
  activeReviewAllRunId = runId;
  const initialCounts = buildEditorAiReviewAllCounts(editorChapter);
  const initialWork = buildEditorAiReviewAllWork(editorChapter);
  const initialReviewMode = normalizeEditorAiReviewMode(editorChapter.aiReviewAllModal?.reviewMode);
  applyEditorAiReviewAllModal({
    isOpen: true,
    step: "reviewing",
    status: "preparing",
    error: "",
    reviewMode: initialReviewMode,
    languageCode: initialCounts.languageCode,
    reviewedCount: initialCounts.reviewedCount,
    totalTranslationCount: initialCounts.totalTranslationCount,
    completedCount: 0,
    totalCount: initialWork.length,
    languageProgress: buildLanguageProgress(initialCounts.languageCode, initialWork.length, 0),
  });
  render?.();

  await flushDirtyEditorRows(render, operations);
  if (!isActiveAiReviewAllRun(runId, editorChapter.chapterId)) {
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
    if (!isActiveAiReviewAllRun(runId, editorChapter.chapterId)) {
      return;
    }
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
  if (!isActiveAiReviewAllRun(runId, editorChapter.chapterId)) {
    return;
  }
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    applyEditorAiReviewAllModal({
      step: "configure",
      status: "idle",
      error: "Could not resolve the current project.",
    });
    render?.();
    return;
  }

  const reviewMode = normalizeEditorAiReviewMode(state.editorChapter.aiReviewAllModal?.reviewMode);
  const sourceLanguageCode = selectedEditorReviewSourceLanguageCode(state.editorChapter);
  const targetLanguageCode = counts.languageCode;
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

  const isReviewActive = () =>
    activeReviewAllRunId === runId
    && state.editorChapter?.aiReviewAllModal?.step === "reviewing";

  const loadHistoryForItem = async (item, latestTranslation) =>
    reviewMode === "meaning"
      ? loadAssistantTargetLanguageHistory({
        chapterId: editorChapter.chapterId,
        rowId: item.rowId,
        targetLanguageCode,
        targetText: latestTranslation,
      })
      : [];

  // Writes one review result (from a batch row or a single-row call). Returns
  // "chapter-changed" (caller must stop the run) or "ok".
  const applyReviewOutcome = async (item, reviewPayload) => {
    const reviewed = reviewPayload?.reviewed === true;
    const suggestedText = reviewed ? "" : String(reviewPayload?.suggestedText ?? "");
    const suggestedFootnote = reviewed ? "" : String(reviewPayload?.suggestedFootnote ?? "");
    const suggestedImageCaption = reviewed ? "" : String(reviewPayload?.suggestedImageCaption ?? "");
    const savePayload = await invokeEditorWriteCommand("apply_gtms_editor_ai_review_result", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        rowId: item.rowId,
        languageCode: targetLanguageCode,
        suggestedText,
        suggestedFootnote,
        suggestedImageCaption,
        reviewed,
        pleaseCheck: !reviewed,
        aiModel: modelId,
      },
    }, { render, actionKind: "sharedWrite", rowId: item.rowId });
    if (state.editorChapter?.chapterId !== editorChapter.chapterId) {
      return "chapter-changed";
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
    return "ok";
  };

  // Reviews one row through the single-row command path (fallback + length-1
  // batches). Returns "abort" | "chapter-changed" | "ok" | "skip".
  // preloadedHistory ({ targetText, history }) lets a batch fallback reuse the
  // history it already loaded instead of re-running the git-history invoke,
  // as long as the row text history was loaded for is still current.
  const reviewSingleItem = async (item, preloadedHistory = null) => {
    if (!isReviewActive()) {
      return "abort";
    }
    const row = findEditorRowById(item.rowId, state.editorChapter);
    const latestTranslation = readEditorReviewRowFieldText(row, targetLanguageCode);
    const latestFootnote = readEditorReviewRowFootnote(row, targetLanguageCode);
    const latestImageCaption = readEditorReviewRowImageCaption(row, targetLanguageCode);
    if (
      !row
      || (!latestTranslation.trim() && !latestFootnote.trim() && !latestImageCaption.trim())
      || row.fieldStates?.[targetLanguageCode]?.reviewed === true
    ) {
      return "skip";
    }

    started = true;
    const targetLanguageHistory =
      preloadedHistory && preloadedHistory.targetText === latestTranslation
        ? preloadedHistory.history
        : await loadHistoryForItem(item, latestTranslation);
    if (!isReviewActive()) {
      return "abort";
    }
    const reviewPayload = await invoke("run_ai_review", {
      request: buildEditorAiReviewRequest({
        chapterState: state.editorChapter,
        row,
        providerId,
        modelId,
        reviewMode,
        sourceLanguageCode,
        targetLanguageCode,
        targetLanguageHistory,
        installationId: team.installationId,
      }),
    });
    if (!isReviewActive()) {
      return "abort";
    }
    return applyReviewOutcome(item, reviewPayload);
  };

  const reviewBatch = async (batch) => {
    const liveItems = [];
    for (const item of batch.items) {
      const row = findEditorRowById(item.rowId, state.editorChapter);
      const latestTranslation = readEditorReviewRowFieldText(row, targetLanguageCode);
      const latestFootnote = readEditorReviewRowFootnote(row, targetLanguageCode);
      const latestImageCaption = readEditorReviewRowImageCaption(row, targetLanguageCode);
      if (
        !row
        || (!latestTranslation.trim() && !latestFootnote.trim() && !latestImageCaption.trim())
        || row.fieldStates?.[targetLanguageCode]?.reviewed === true
      ) {
        continue;
      }
      // Sent values are captured so results can be validated against what was
      // actually reviewed once the (long) batch call returns.
      liveItems.push({ item, row, latestTranslation, latestFootnote, latestImageCaption });
    }
    if (liveItems.length === 0) {
      return "ok";
    }

    started = true;

    const targetLanguageHistoryByRowId = new Map();
    if (reviewMode === "meaning") {
      await mapWithConcurrency(liveItems, 3, async ({ item, row }) => {
        const history = await loadHistoryForItem(
          item,
          readEditorReviewRowFieldText(row, targetLanguageCode),
        );
        targetLanguageHistoryByRowId.set(item.rowId, history);
      });
      if (!isReviewActive()) {
        return "abort";
      }
    }

    const request = buildEditorAiReviewBatchRequest({
      chapterState: state.editorChapter,
      rows: liveItems.map((entry) => entry.row),
      sourceLanguageCode,
      targetLanguageCode,
      providerId,
      modelId,
      reviewMode,
      targetLanguageHistoryByRowId,
      installationId: team.installationId,
    });

    const runBatch =
      typeof operations.runAiReviewBatch === "function"
        ? operations.runAiReviewBatch
        : (batchRequest) => invoke("run_ai_review_batch", { request: batchRequest });

    const preloadedHistoryForEntry = (entry) => {
      const history = targetLanguageHistoryByRowId.get(entry.item.rowId);
      return history === undefined
        ? null
        : { targetText: entry.latestTranslation, history };
    };

    let payload;
    try {
      payload = await runBatch(request);
    } catch (error) {
      console.warn("[gtms ai-review] Batch review call failed; reviewing these rows one at a time.", {
        rowCount: liveItems.length,
        error: error instanceof Error ? error.message : String(error),
      });
      // The invoke wrapper already reports the raw command failure; this adds a
      // stable, countable signal that the run degraded to single-row review.
      reportBackendNonfatalError({ operation: "ai-review-batch", reason: "fallback-single-row" });
      if (!isReviewActive()) {
        return "abort";
      }
      for (const entry of liveItems) {
        const outcome = await reviewSingleItem(entry.item, preloadedHistoryForEntry(entry));
        if (outcome === "abort" || outcome === "chapter-changed") {
          return outcome;
        }
      }
      return "ok";
    }
    if (!isReviewActive()) {
      return "abort";
    }

    const returnedById = new Map(
      (Array.isArray(payload?.rows) ? payload.rows : []).map((row) => [row.rowId, row]),
    );
    console.info("[gtms ai-review] Batch review call succeeded.", {
      requestedRowCount: liveItems.length,
      returnedRowCount: returnedById.size,
    });
    const missingRowIds = liveItems
      .filter((entry) => !returnedById.has(entry.item.rowId))
      .map((entry) => entry.item.rowId);
    if (missingRowIds.length > 0) {
      // The model failed to echo these rowIds back; they fall through to the
      // single-row path below. One aggregate report per batch, not per row.
      console.warn("[gtms ai-review] Batch response is missing rows; reviewing them individually.", {
        missingRowIds,
      });
      reportBackendNonfatalError({ operation: "ai-review-batch", reason: "missing-rows" });
    }
    for (const entry of liveItems) {
      if (!isReviewActive()) {
        return "abort";
      }
      const { item } = entry;
      // Re-validate against the CURRENT row: the batch call plus earlier
      // per-row apply writes leave a long window in which the user or
      // background sync may have changed this row.
      const currentRow = findEditorRowById(item.rowId, state.editorChapter);
      const currentTranslation = readEditorReviewRowFieldText(currentRow, targetLanguageCode);
      const currentFootnote = readEditorReviewRowFootnote(currentRow, targetLanguageCode);
      const currentImageCaption = readEditorReviewRowImageCaption(currentRow, targetLanguageCode);
      if (
        !currentRow
        || (!currentTranslation.trim() && !currentFootnote.trim() && !currentImageCaption.trim())
        || currentRow.fieldStates?.[targetLanguageCode]?.reviewed === true
      ) {
        // Row emptied or manually marked reviewed mid-flight — leave it alone.
        continue;
      }
      const rowResult = returnedById.get(item.rowId);
      const textChangedMidFlight =
        currentTranslation !== entry.latestTranslation
        || currentFootnote !== entry.latestFootnote
        || currentImageCaption !== entry.latestImageCaption;
      // A changed row gets re-reviewed against its current text through the
      // single-row path instead of receiving a verdict for text it no longer has.
      const outcome = rowResult && !textChangedMidFlight
        ? await applyReviewOutcome(item, rowResult)
        : await reviewSingleItem(item, preloadedHistoryForEntry(entry));
      if (outcome === "abort" || outcome === "chapter-changed") {
        return outcome;
      }
    }
    return "ok";
  };

  try {
    // Row lookup map: avoids an O(chapter rows) findEditorRowById scan per work
    // item during chunking.
    const rowsById = new Map(
      (Array.isArray(state.editorChapter?.rows) ? state.editorChapter.rows : [])
        .map((row) => [row.rowId, row]),
    );
    const batches = chunkTranslateAllWork(work, {
      sourceTokensForItem: (item) =>
        estimateSourceTokens(
          readEditorReviewRowFieldText(rowsById.get(item.rowId), targetLanguageCode),
        ),
    });
    for (const batch of batches) {
      if (!isReviewActive()) {
        if (started) {
          enablePleaseCheckFilterAndShowModal();
          render?.();
        }
        return;
      }
      const outcome = batch.items.length === 1
        ? await reviewSingleItem(batch.items[0])
        : await reviewBatch(batch);
      if (outcome === "chapter-changed") {
        return;
      }
      if (outcome === "abort") {
        if (started) {
          enablePleaseCheckFilterAndShowModal();
          render?.();
        }
        return;
      }
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
  applyReviewResultToRow,
  buildEditorAiReviewAllCounts,
  buildEditorAiReviewAllWork,
  getActiveReviewAllRunId: () => activeReviewAllRunId,
  resetActiveReviewAllRunId: () => {
    activeReviewAllRunId = 0;
  },
  reviewableTranslationRows,
};
