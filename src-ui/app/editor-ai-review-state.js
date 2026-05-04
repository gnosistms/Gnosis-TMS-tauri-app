import { createEditorAiReviewState } from "./state.js";

function normalizeEditorAiReviewComparisonText(value) {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n") : String(value ?? "");
}

export function normalizeEditorAiReviewState(aiReview) {
  return {
    ...createEditorAiReviewState(),
    ...(aiReview && typeof aiReview === "object" ? aiReview : {}),
    rowId: typeof aiReview?.rowId === "string" ? aiReview.rowId : null,
    languageCode: typeof aiReview?.languageCode === "string" ? aiReview.languageCode : null,
    requestKey: typeof aiReview?.requestKey === "string" ? aiReview.requestKey : null,
    sourceText: typeof aiReview?.sourceText === "string" ? aiReview.sourceText : "",
    suggestedText: typeof aiReview?.suggestedText === "string" ? aiReview.suggestedText : "",
  };
}

export function currentEditorAiReviewForSelection(chapterState, rowId, languageCode) {
  const aiReview = normalizeEditorAiReviewState(chapterState?.aiReview);
  if (aiReview.rowId === rowId && aiReview.languageCode === languageCode) {
    return aiReview;
  }

  return createEditorAiReviewState();
}

export function currentEditorAiReviewRequestMatches(
  chapterState,
  chapterId,
  rowId,
  languageCode,
  requestKey,
) {
  const aiReview = normalizeEditorAiReviewState(chapterState?.aiReview);
  return (
    chapterState?.chapterId === chapterId
    && aiReview.rowId === rowId
    && aiReview.languageCode === languageCode
    && aiReview.requestKey === requestKey
  );
}

export function applyEditorAiReviewLoading(
  chapterState,
  rowId,
  languageCode,
  requestKey,
  sourceText,
) {
  if (!chapterState?.chapterId || !rowId || !languageCode) {
    return chapterState;
  }

  return {
    ...chapterState,
    aiReview: {
      ...createEditorAiReviewState(),
      status: "loading",
      rowId,
      languageCode,
      requestKey,
      sourceText: typeof sourceText === "string" ? sourceText : "",
    },
  };
}

export function applyEditorAiReviewLoaded(
  chapterState,
  rowId,
  languageCode,
  requestKey,
  sourceText,
  suggestedText,
) {
  if (!chapterState?.chapterId || !rowId || !languageCode) {
    return chapterState;
  }

  return {
    ...chapterState,
    aiReview: {
      ...createEditorAiReviewState(),
      status: "ready",
      rowId,
      languageCode,
      requestKey,
      sourceText: typeof sourceText === "string" ? sourceText : "",
      suggestedText: typeof suggestedText === "string" ? suggestedText : "",
    },
  };
}

export function applyEditorAiReviewFailed(
  chapterState,
  rowId,
  languageCode,
  requestKey,
  sourceText,
  error,
) {
  if (!chapterState?.chapterId || !rowId || !languageCode) {
    return chapterState;
  }

  return {
    ...chapterState,
    aiReview: {
      ...createEditorAiReviewState(),
      status: "error",
      error: typeof error === "string" ? error : "",
      rowId,
      languageCode,
      requestKey,
      sourceText: typeof sourceText === "string" ? sourceText : "",
    },
  };
}

export function applyEditorAiReviewApplying(chapterState) {
  if (!chapterState?.chapterId) {
    return chapterState;
  }

  const aiReview = normalizeEditorAiReviewState(chapterState.aiReview);
  return {
    ...chapterState,
    aiReview: {
      ...aiReview,
      status: "applying",
      error: "",
    },
  };
}

export function clearEditorAiReview(chapterState) {
  if (!chapterState?.chapterId) {
    return chapterState;
  }

  return {
    ...chapterState,
    aiReview: createEditorAiReviewState(),
  };
}

export function resolveVisibleEditorAiReview(chapterState, rowId, languageCode, currentText) {
  const aiReview = currentEditorAiReviewForSelection(chapterState, rowId, languageCode);
  const normalizedCurrentText = normalizeEditorAiReviewComparisonText(currentText);
  const hasSuggestion =
    (aiReview.status === "ready" || aiReview.status === "applying")
    && aiReview.suggestedText.trim().length > 0;
  const isStale = hasSuggestion && aiReview.sourceText !== normalizedCurrentText;
  const suggestedTextMatchesCurrentText =
    hasSuggestion
    && !isStale
    && normalizeEditorAiReviewComparisonText(aiReview.suggestedText) === normalizedCurrentText;
  const showSuggestion = hasSuggestion && !isStale && !suggestedTextMatchesCurrentText;

  return {
    ...aiReview,
    hasSuggestion,
    isStale,
    showLooksGoodMessage: suggestedTextMatchesCurrentText,
    showSuggestion,
    showReviewNow:
      aiReview.status !== "loading"
      && aiReview.status !== "applying"
      && !showSuggestion
      && !suggestedTextMatchesCurrentText,
  };
}
