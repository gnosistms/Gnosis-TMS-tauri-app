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
import { findEditorRowById, hasActiveEditorField } from "./editor-utils.js";
import {
  editorFootnoteMarkerSequencesEqual,
  mergeEditorFootnoteCorrections,
  serializeEditorFootnotesForLegacy,
} from "./editor-footnotes.js";
import { selectedProjectsTeam, selectedProjectsTeamInstallationId } from "./project-context.js";
import {
  buildEditorAiReviewRequest,
  editorReviewLanguageByCode,
  normalizeEditorAiReviewMode,
  readEditorReviewRowFieldText,
  readEditorReviewRowImageCaption,
  selectedEditorReviewSourceLanguageCode,
} from "./editor-ai-review-request.js";
import { loadAssistantTargetLanguageHistory } from "./editor-ai-assistant-flow.js";
import { loadEditorAiReviewQaHints } from "./editor-ai-qa.js";
import { invoke } from "./runtime.js";
import { state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { renderEditorRowScoped } from "./editor-row-scoped-render.js";

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
  const sourceLanguageCode = selectedEditorReviewSourceLanguageCode(chapterState);
  return {
    chapterId: chapterState.chapterId,
    rowId: chapterState.activeRowId,
    row,
    sourceLanguageCode,
    languageCode,
    language: editorReviewLanguageByCode(chapterState, languageCode),
    text: readEditorReviewRowFieldText(row, languageCode),
    footnote: serializeEditorFootnotesForLegacy(row.footnotes?.[languageCode]),
    imageCaption: readEditorReviewRowImageCaption(row, languageCode),
  };
}

export async function runEditorAiReview(render, reviewMode = "grammar") {
  if (state.offline?.isEnabled === true) {
    showNoticeBadge("This operation is not supported in offline mode", render);
    return;
  }

  const context = activeEditorReviewContext();
  if (!context) {
    return;
  }

  if (!context.text.trim() && !context.footnote.trim() && !context.imageCaption.trim()) {
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

  const normalizedReviewMode = normalizeEditorAiReviewMode(reviewMode);
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
      context.footnote,
      context.imageCaption,
      normalizedReviewMode,
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
    const targetLanguageHistory = normalizedReviewMode === "meaning"
      ? await loadAssistantTargetLanguageHistory({
        chapterId: context.chapterId,
        rowId: context.rowId,
        targetLanguageCode: context.languageCode,
        targetText: context.text,
      })
      : [];
    const qaHintsByRowId = await loadEditorAiReviewQaHints({
      targetLanguageCode: context.languageCode,
      rows: [{
        rowId: context.rowId,
        text: context.text,
        footnote: context.footnote,
        imageCaption: context.imageCaption,
      }],
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
    const payload = await invoke("run_ai_review", {
      request: withSelectedInstallation({
        ...buildEditorAiReviewRequest({
          chapterState: state.editorChapter,
          row: context.row,
          providerId,
          modelId,
          reviewMode: normalizedReviewMode,
          sourceLanguageCode: context.sourceLanguageCode,
          targetLanguageCode: context.languageCode,
          targetLanguageHistory,
          qaHints: qaHintsByRowId.get(context.rowId) ?? [],
        }),
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

    const suggestedText = String(payload?.suggestedText ?? "");
    const suggestedFootnotes = Array.isArray(payload?.suggestedFootnotes)
      ? payload.suggestedFootnotes
      : [];
    const mergedFootnotes = mergeEditorFootnoteCorrections(
      context.row?.footnotes?.[context.languageCode],
      suggestedFootnotes,
    );
    if (
      (suggestedText.trim() && !editorFootnoteMarkerSequencesEqual(context.text, suggestedText))
      || !mergedFootnotes.ok
    ) {
      state.editorChapter = applyEditorAiReviewFailed(
        state.editorChapter,
        context.rowId,
        context.languageCode,
        requestKey,
        context.text,
        "The AI review changed footnote markers, so its suggestion was not applied.",
        context.footnote,
        context.imageCaption,
      );
      render?.({ scope: "translate-sidebar" });
      return;
    }
    const suggestedFootnote = suggestedFootnotes.length > 0
      ? serializeEditorFootnotesForLegacy(mergedFootnotes.footnotes)
      : "";
    state.editorChapter = applyEditorAiReviewLoaded(
      state.editorChapter,
      context.rowId,
      context.languageCode,
      requestKey,
      context.text,
      context.footnote,
      context.imageCaption,
      suggestedText,
      suggestedFootnote,
      suggestedFootnotes,
      payload?.suggestedImageCaption ?? "",
      payload?.promptText ?? "",
      normalizedReviewMode,
      typeof payload?.reviewed === "boolean" ? payload.reviewed : null,
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
      context.footnote,
      context.imageCaption,
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
    context.footnote,
    context.imageCaption,
  );
  if (!visibleAiReview.showSuggestion) {
    return;
  }

  const mergedFootnotes = mergeEditorFootnoteCorrections(
    context.row?.footnotes?.[context.languageCode],
    visibleAiReview.suggestedFootnotes,
  );
  if (
    (visibleAiReview.suggestedText?.trim()
      && !editorFootnoteMarkerSequencesEqual(context.text, visibleAiReview.suggestedText))
    || !mergedFootnotes.ok
  ) {
    state.editorChapter = applyEditorAiReviewFailed(
      state.editorChapter,
      context.rowId,
      context.languageCode,
      visibleAiReview.requestKey,
      context.text,
      "The AI review changed footnote markers, so its suggestion was not applied.",
      context.footnote,
      context.imageCaption,
    );
    render?.({ scope: "translate-sidebar" });
    return;
  }

  state.editorChapter = applyEditorAiReviewApplying(state.editorChapter);
  render?.({ scope: "translate-sidebar" });

  try {
    if (visibleAiReview.suggestedText?.trim()) {
      updateEditorRowFieldValue(
        context.rowId,
        context.languageCode,
        visibleAiReview.suggestedText,
      );
    }
    for (const correction of visibleAiReview.suggestedFootnotes) {
      updateEditorRowFieldValue(
        context.rowId,
        context.languageCode,
        correction.text,
        "footnote",
        { marker: correction.marker },
      );
    }
    if (visibleAiReview.suggestedImageCaption?.trim()) {
      updateEditorRowFieldValue(
        context.rowId,
        context.languageCode,
        visibleAiReview.suggestedImageCaption,
        "image-caption",
      );
    }
    renderEditorRowScoped(render, context.rowId, "ai-review-applied");

    const queued = await persistEditorRowOnBlur(render, context.rowId, {
      waitForDurable: false,
    });

    if (state.editorChapter?.chapterId !== context.chapterId) {
      return;
    }

    if (queued !== false) {
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
  } catch (error) {
    if (state.editorChapter?.chapterId !== context.chapterId) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    state.editorChapter = {
      ...state.editorChapter,
      aiReview: {
        ...normalizeEditorAiReviewState(state.editorChapter.aiReview),
        status: "ready",
        error: message,
      },
    };
    showNoticeBadge(message || "The AI review suggestion could not be applied.", render);
  }

  if (state.editorChapter?.chapterId === context.chapterId) {
    render?.({ scope: "translate-sidebar" });
  }
}
