import { AI_TRANSLATE_ACTION_IDS } from "./ai-action-config.js";
import {
  createEditorAiTranslateActionState,
  createEditorAiTranslateState,
} from "./state.js";

export function normalizeEditorAiTranslateActionState(actionState) {
  return {
    ...createEditorAiTranslateActionState(),
    ...(actionState && typeof actionState === "object" ? actionState : {}),
    rowId: typeof actionState?.rowId === "string" ? actionState.rowId : null,
    sourceLanguageCode:
      typeof actionState?.sourceLanguageCode === "string" ? actionState.sourceLanguageCode : null,
    targetLanguageCode:
      typeof actionState?.targetLanguageCode === "string" ? actionState.targetLanguageCode : null,
    requestKey: typeof actionState?.requestKey === "string" ? actionState.requestKey : null,
    sourceText: typeof actionState?.sourceText === "string" ? actionState.sourceText : "",
  };
}

export function normalizeEditorAiTranslateState(aiTranslate) {
  const normalizedState =
    aiTranslate && typeof aiTranslate === "object" ? aiTranslate : createEditorAiTranslateState();
  return Object.fromEntries(
    AI_TRANSLATE_ACTION_IDS.map((actionId) => [
      actionId,
      normalizeEditorAiTranslateActionState(normalizedState[actionId]),
    ]),
  );
}

export function currentEditorAiTranslateActionForSelection(
  chapterState,
  actionId,
  rowId,
  sourceLanguageCode,
  targetLanguageCode,
) {
  const actionState = normalizeEditorAiTranslateState(chapterState?.aiTranslate)[actionId];
  if (
    actionState.rowId === rowId
    && actionState.sourceLanguageCode === sourceLanguageCode
    && actionState.targetLanguageCode === targetLanguageCode
  ) {
    return actionState;
  }

  return createEditorAiTranslateActionState();
}

export function currentEditorAiTranslateRequestMatches(
  chapterState,
  chapterId,
  actionId,
  rowId,
  sourceLanguageCode,
  targetLanguageCode,
  requestKey,
) {
  const actionState = normalizeEditorAiTranslateState(chapterState?.aiTranslate)[actionId];
  return (
    chapterState?.chapterId === chapterId
    && actionState.rowId === rowId
    && actionState.sourceLanguageCode === sourceLanguageCode
    && actionState.targetLanguageCode === targetLanguageCode
    && actionState.requestKey === requestKey
  );
}

function replaceTranslateActionState(chapterState, actionId, nextActionState) {
  if (!chapterState?.chapterId || !AI_TRANSLATE_ACTION_IDS.includes(actionId)) {
    return chapterState;
  }

  const aiTranslate = normalizeEditorAiTranslateState(chapterState.aiTranslate);
  return {
    ...chapterState,
    aiTranslate: {
      ...aiTranslate,
      [actionId]: {
        ...createEditorAiTranslateActionState(),
        ...nextActionState,
      },
    },
  };
}

export function applyEditorAiTranslateActionLoading(
  chapterState,
  actionId,
  rowId,
  sourceLanguageCode,
  targetLanguageCode,
  requestKey,
  sourceText,
) {
  return replaceTranslateActionState(chapterState, actionId, {
    status: "loading",
    error: "",
    rowId,
    sourceLanguageCode,
    targetLanguageCode,
    requestKey,
    sourceText: typeof sourceText === "string" ? sourceText : "",
  });
}

export function applyEditorAiTranslateActionApplying(
  chapterState,
  actionId,
  rowId,
  sourceLanguageCode,
  targetLanguageCode,
  requestKey,
  sourceText,
) {
  return replaceTranslateActionState(chapterState, actionId, {
    status: "applying",
    error: "",
    rowId,
    sourceLanguageCode,
    targetLanguageCode,
    requestKey,
    sourceText: typeof sourceText === "string" ? sourceText : "",
  });
}

export function applyEditorAiTranslateActionFailed(
  chapterState,
  actionId,
  rowId,
  sourceLanguageCode,
  targetLanguageCode,
  requestKey,
  sourceText,
  error,
) {
  return replaceTranslateActionState(chapterState, actionId, {
    status: "error",
    error: typeof error === "string" ? error : "",
    rowId,
    sourceLanguageCode,
    targetLanguageCode,
    requestKey,
    sourceText: typeof sourceText === "string" ? sourceText : "",
  });
}

export function clearEditorAiTranslateAction(chapterState, actionId) {
  return replaceTranslateActionState(
    chapterState,
    actionId,
    createEditorAiTranslateActionState(),
  );
}

export function resolveVisibleEditorAiTranslateAction(
  chapterState,
  actionId,
  rowId,
  sourceLanguageCode,
  targetLanguageCode,
  currentSourceText,
) {
  const actionState = currentEditorAiTranslateActionForSelection(
    chapterState,
    actionId,
    rowId,
    sourceLanguageCode,
    targetLanguageCode,
  );
  const normalizedCurrentSourceText =
    typeof currentSourceText === "string" ? currentSourceText : String(currentSourceText ?? "");
  const isStale =
    actionState.requestKey !== null && actionState.sourceText !== normalizedCurrentSourceText;

  return {
    ...actionState,
    isStale,
    showError: actionState.status === "error" && !isStale && actionState.error.trim().length > 0,
    isLoading:
      (actionState.status === "loading" || actionState.status === "applying") && !isStale,
  };
}
