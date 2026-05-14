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
    sourceFootnote: typeof aiReview?.sourceFootnote === "string" ? aiReview.sourceFootnote : "",
    sourceImageCaption: typeof aiReview?.sourceImageCaption === "string" ? aiReview.sourceImageCaption : "",
    suggestedText: typeof aiReview?.suggestedText === "string" ? aiReview.suggestedText : "",
    suggestedFootnote: typeof aiReview?.suggestedFootnote === "string" ? aiReview.suggestedFootnote : "",
    suggestedImageCaption: typeof aiReview?.suggestedImageCaption === "string" ? aiReview.suggestedImageCaption : "",
    promptText: typeof aiReview?.promptText === "string" ? aiReview.promptText : "",
    reviewMode: aiReview?.reviewMode === "meaning" ? "meaning" : "grammar",
    reviewed: typeof aiReview?.reviewed === "boolean" ? aiReview.reviewed : null,
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
  sourceFootnote = "",
  sourceImageCaption = "",
  reviewMode = "grammar",
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
      sourceFootnote: typeof sourceFootnote === "string" ? sourceFootnote : "",
      sourceImageCaption: typeof sourceImageCaption === "string" ? sourceImageCaption : "",
      reviewMode: reviewMode === "meaning" ? "meaning" : "grammar",
    },
  };
}

export function applyEditorAiReviewLoaded(
  chapterState,
  rowId,
  languageCode,
  requestKey,
  sourceText,
  sourceFootnote = "",
  sourceImageCaption = "",
  suggestedText,
  suggestedFootnote = "",
  suggestedImageCaption = "",
  promptText = "",
  reviewMode = "grammar",
  reviewed = null,
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
      sourceFootnote: typeof sourceFootnote === "string" ? sourceFootnote : "",
      sourceImageCaption: typeof sourceImageCaption === "string" ? sourceImageCaption : "",
      suggestedText: typeof suggestedText === "string" ? suggestedText : "",
      suggestedFootnote: typeof suggestedFootnote === "string" ? suggestedFootnote : "",
      suggestedImageCaption: typeof suggestedImageCaption === "string" ? suggestedImageCaption : "",
      promptText: typeof promptText === "string" ? promptText : "",
      reviewMode: reviewMode === "meaning" ? "meaning" : "grammar",
      reviewed: typeof reviewed === "boolean" ? reviewed : null,
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

export function resolveVisibleEditorAiReview(
  chapterState,
  rowId,
  languageCode,
  currentText,
  currentFootnote = "",
  currentImageCaption = "",
) {
  const aiReview = currentEditorAiReviewForSelection(chapterState, rowId, languageCode);
  const normalizedCurrentText = normalizeEditorAiReviewComparisonText(currentText);
  const normalizedCurrentFootnote = normalizeEditorAiReviewComparisonText(currentFootnote);
  const normalizedCurrentImageCaption = normalizeEditorAiReviewComparisonText(currentImageCaption);
  const reviewResultMatchesCurrentText =
    aiReview.sourceText === normalizedCurrentText
    && aiReview.sourceFootnote === normalizedCurrentFootnote
    && aiReview.sourceImageCaption === normalizedCurrentImageCaption;
  const hasSuggestion =
    (aiReview.status === "ready" || aiReview.status === "applying")
    && (
      aiReview.suggestedText.trim().length > 0
      || aiReview.suggestedFootnote.trim().length > 0
      || aiReview.suggestedImageCaption.trim().length > 0
    );
  const hasReviewResult =
    hasSuggestion
    || aiReview.reviewed === true
    || aiReview.reviewed === false
    || aiReview.status === "error";
  const isStale = hasReviewResult && !reviewResultMatchesCurrentText;
  const suggestedTextMatchesCurrentText =
    hasSuggestion
    && !isStale
    && (!aiReview.suggestedText.trim() || normalizeEditorAiReviewComparisonText(aiReview.suggestedText) === normalizedCurrentText)
    && (!aiReview.suggestedFootnote.trim() || normalizeEditorAiReviewComparisonText(aiReview.suggestedFootnote) === normalizedCurrentFootnote)
    && (!aiReview.suggestedImageCaption.trim() || normalizeEditorAiReviewComparisonText(aiReview.suggestedImageCaption) === normalizedCurrentImageCaption);
  const reviewedLooksGood =
    aiReview.status === "ready"
    && aiReview.reviewed === true
    && reviewResultMatchesCurrentText;
  const reviewPassed =
    aiReview.status === "ready"
    && (reviewedLooksGood || suggestedTextMatchesCurrentText);
  const grammarReviewPassed = reviewPassed && aiReview.reviewMode !== "meaning";
  const fullReviewPassed = reviewPassed && aiReview.reviewMode === "meaning";
  const showSuggestion = hasSuggestion && !isStale && !suggestedTextMatchesCurrentText;
  const isBusy = aiReview.status === "loading" || aiReview.status === "applying";
  const canReview = !isBusy && !showSuggestion;
  const showFullReviewButton = canReview && !fullReviewPassed;
  const showGrammarReviewButton = canReview && !grammarReviewPassed && !fullReviewPassed;

  return {
    ...aiReview,
    hasSuggestion,
    isStale,
    grammarReviewPassed,
    fullReviewPassed,
    showLooksGoodMessage: suggestedTextMatchesCurrentText || reviewedLooksGood,
    showSuggestion,
    showFullReviewButton,
    showGrammarReviewButton,
    showReviewNow:
      showFullReviewButton || showGrammarReviewButton,
  };
}
