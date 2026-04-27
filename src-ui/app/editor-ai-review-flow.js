import {
  applyEditorAiReviewApplying,
  applyEditorAiReviewFailed,
  applyEditorAiReviewLoaded,
  applyEditorAiReviewLoading,
  clearEditorAiReview,
  currentEditorAiReviewRequestMatches,
  normalizeEditorAiReviewState,
  resolveVisibleEditorAiReview,
} from "./editor-ai-review-state.js";
import {
  applyStoredSelectedTeamAiActionPreferences,
  ensureSharedAiActionConfigurationLoaded,
  openAiReviewMissingKeyModal,
  resolveAiReviewProviderAndModel,
} from "./ai-settings-flow.js";
import { ensureSelectedTeamAiProviderReady } from "./team-ai-flow.js";
import { rowHasFieldChanges } from "./editor-row-persistence-model.js";
import { captureTranslateAnchorForRow } from "./scroll-state.js";
import { findEditorRowById, hasActiveEditorField } from "./editor-utils.js";
import { selectedProjectsTeam, selectedProjectsTeamInstallationId } from "./project-context.js";
import { invoke } from "./runtime.js";
import { state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import {
  captureTranslateViewport,
  renderTranslateBodyPreservingViewport,
} from "./translate-viewport.js";

function createAiReviewRequestKey(chapterId, rowId, languageCode) {
  const uniqueSuffix =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${chapterId}:${rowId}:${languageCode}:${uniqueSuffix}`;
}

function errorMeansMissingAiKey(message) {
  const normalizedMessage = String(message ?? "").trim().toLowerCase();
  return (
    normalizedMessage.includes("api key is saved yet")
    || normalizedMessage.includes("save one first")
  );
}

function maybeInstallationPayload() {
  const installationId = selectedProjectsTeamInstallationId();
  return installationId === null ? {} : { installationId };
}

function withSelectedInstallation(request = {}) {
  const installationId = selectedProjectsTeamInstallationId();
  return installationId === null ? request : { ...request, installationId };
}

function activeEditorReviewContext(chapterState = state.editorChapter) {
  if (!chapterState?.chapterId || !hasActiveEditorField(chapterState)) {
    return null;
  }

  const row = findEditorRowById(chapterState.activeRowId, chapterState);
  if (!row) {
    return null;
  }

  const languageCode = chapterState.activeLanguageCode;
  return {
    chapterId: chapterState.chapterId,
    rowId: chapterState.activeRowId,
    languageCode,
    text: row.fields?.[languageCode] ?? "",
  };
}

export async function runEditorAiReview(render) {
  if (state.offline?.isEnabled === true) {
    showNoticeBadge("This operation is not supported in offline mode", render);
    return;
  }

  const context = activeEditorReviewContext();
  if (!context) {
    return;
  }

  if (!context.text.trim()) {
    const requestKey = createAiReviewRequestKey(
      context.chapterId,
      context.rowId,
      context.languageCode,
    );
    state.editorChapter = applyEditorAiReviewFailed(
      state.editorChapter,
      context.rowId,
      context.languageCode,
      requestKey,
      context.text,
      "There is no text to review yet.",
    );
    render?.({ scope: "translate-sidebar" });
    return;
  }

  const requestKey = createAiReviewRequestKey(
    context.chapterId,
    context.rowId,
    context.languageCode,
  );
  const previousAiReviewState = normalizeEditorAiReviewState(state.editorChapter.aiReview);
  state.editorChapter = applyEditorAiReviewLoading(
    state.editorChapter,
    context.rowId,
    context.languageCode,
    requestKey,
    context.text,
  );
  render?.({ scope: "translate-sidebar" });

  const usedStoredTeamActionPreferences = applyStoredSelectedTeamAiActionPreferences(render);
  try {
    await ensureSharedAiActionConfigurationLoaded(render);
  } catch (error) {
    if (selectedProjectsTeam()?.canDelete !== true && !usedStoredTeamActionPreferences) {
      if (
        !currentEditorAiReviewRequestMatches(
          state.editorChapter,
          context.chapterId,
          context.rowId,
          context.languageCode,
          requestKey,
        )
      ) {
        return;
      }
      state.editorChapter = applyEditorAiReviewFailed(
        state.editorChapter,
        context.rowId,
        context.languageCode,
        requestKey,
        context.text,
        error instanceof Error ? error.message : String(error),
      );
      render?.({ scope: "translate-sidebar" });
      return;
    }
  }

  const { providerId, modelId } = resolveAiReviewProviderAndModel();

  try {
    const ensureKeyResult = await ensureSelectedTeamAiProviderReady(render, providerId);
    if (!ensureKeyResult?.ok) {
      openAiReviewMissingKeyModal();
      if (
        currentEditorAiReviewRequestMatches(
          state.editorChapter,
          context.chapterId,
          context.rowId,
          context.languageCode,
          requestKey,
        )
      ) {
        state.editorChapter = {
          ...state.editorChapter,
          aiReview: previousAiReviewState,
        };
        render?.({ scope: "translate-sidebar" });
      } else {
        render?.();
      }
      return;
    }
  } catch (error) {
    if (
      !currentEditorAiReviewRequestMatches(
        state.editorChapter,
        context.chapterId,
        context.rowId,
        context.languageCode,
        requestKey,
      )
    ) {
      return;
    }
    state.editorChapter = applyEditorAiReviewFailed(
      state.editorChapter,
      context.rowId,
      context.languageCode,
      requestKey,
      context.text,
      error instanceof Error ? error.message : String(error),
    );
    render?.({ scope: "translate-sidebar" });
    return;
  }

  try {
    const payload = await invoke("run_ai_review", {
      request: withSelectedInstallation({
        providerId,
        modelId,
        text: context.text,
        languageCode: context.languageCode,
      }),
    });

    if (
      !currentEditorAiReviewRequestMatches(
        state.editorChapter,
        context.chapterId,
        context.rowId,
        context.languageCode,
        requestKey,
      )
    ) {
      return;
    }

    state.editorChapter = applyEditorAiReviewLoaded(
      state.editorChapter,
      context.rowId,
      context.languageCode,
      requestKey,
      context.text,
      payload?.suggestedText ?? "",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (errorMeansMissingAiKey(message)) {
      openAiReviewMissingKeyModal();
      if (
        currentEditorAiReviewRequestMatches(
          state.editorChapter,
          context.chapterId,
          context.rowId,
          context.languageCode,
          requestKey,
        )
      ) {
        state.editorChapter = {
          ...state.editorChapter,
          aiReview: previousAiReviewState,
        };
        render?.({ scope: "translate-sidebar" });
      } else {
        render?.();
      }
      return;
    }

    if (
      !currentEditorAiReviewRequestMatches(
        state.editorChapter,
        context.chapterId,
        context.rowId,
        context.languageCode,
        requestKey,
      )
    ) {
      return;
    }

    state.editorChapter = applyEditorAiReviewFailed(
      state.editorChapter,
      context.rowId,
      context.languageCode,
      requestKey,
      context.text,
      message,
    );
  }

  render?.({ scope: "translate-sidebar" });
}

export async function applyEditorAiReview(render, operations = {}) {
  const {
    updateEditorRowFieldValue,
    persistEditorRowOnBlur,
  } = operations;
  if (
    typeof updateEditorRowFieldValue !== "function"
    || typeof persistEditorRowOnBlur !== "function"
  ) {
    return;
  }

  const context = activeEditorReviewContext();
  if (!context) {
    return;
  }

  const visibleAiReview = resolveVisibleEditorAiReview(
    state.editorChapter,
    context.rowId,
    context.languageCode,
    context.text,
  );
  if (!visibleAiReview.showSuggestion) {
    return;
  }

  state.editorChapter = applyEditorAiReviewApplying(state.editorChapter);
  render?.({ scope: "translate-sidebar" });

  const reviewViewportSnapshot = captureTranslateViewport(null, {
    fallbackAnchor: captureTranslateAnchorForRow(
      context.rowId,
      context.languageCode,
    ),
  });
  updateEditorRowFieldValue(
    context.rowId,
    context.languageCode,
    visibleAiReview.suggestedText,
  );
  renderTranslateBodyPreservingViewport(render, reviewViewportSnapshot);

  await persistEditorRowOnBlur(render, context.rowId);

  if (state.editorChapter?.chapterId !== context.chapterId) {
    return;
  }

  const row = findEditorRowById(context.rowId, state.editorChapter);
  if (!row || (!rowHasFieldChanges(row) && row.saveStatus === "idle")) {
    state.editorChapter = clearEditorAiReview(state.editorChapter);
  } else {
    state.editorChapter = {
      ...state.editorChapter,
      aiReview: {
        ...normalizeEditorAiReviewState(state.editorChapter.aiReview),
        status: "ready",
      },
    };
  }

  render?.({ scope: "translate-sidebar" });
}
