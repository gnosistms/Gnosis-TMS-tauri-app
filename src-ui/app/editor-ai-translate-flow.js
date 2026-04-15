import { AI_ACTION_LABELS, AI_TRANSLATE_ACTION_IDS } from "./ai-action-config.js";
import {
  openAiMissingKeyModal,
  resolveAiActionProviderAndModel,
} from "./ai-settings-flow.js";
import {
  applyEditorAiTranslateActionApplying,
  applyEditorAiTranslateActionFailed,
  applyEditorAiTranslateActionLoading,
  clearEditorAiTranslateAction,
  currentEditorAiTranslateRequestMatches,
} from "./editor-ai-translate-state.js";
import { resolveEditorAiTranslateLanguages } from "./editor-ai-translate-target.js";
import { invoke } from "./runtime.js";
import { showNoticeBadge } from "./status-feedback.js";
import { findEditorRowById } from "./editor-utils.js";
import { state } from "./state.js";

function createAiTranslateRequestKey(
  chapterId,
  rowId,
  sourceLanguageCode,
  targetLanguageCode,
  actionId,
) {
  const uniqueSuffix =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${chapterId}:${rowId}:${sourceLanguageCode}:${targetLanguageCode}:${actionId}:${uniqueSuffix}`;
}

function errorMeansMissingAiKey(message) {
  const normalizedMessage = String(message ?? "").trim().toLowerCase();
  return (
    normalizedMessage.includes("api key is saved yet")
    || normalizedMessage.includes("save one first")
  );
}

function activeEditorTranslateContext(chapterState = state.editorChapter) {
  if (!chapterState?.chapterId || !chapterState?.activeRowId) {
    return null;
  }

  const row = findEditorRowById(chapterState.activeRowId, chapterState);
  if (!row) {
    return null;
  }

  const {
    sourceLanguageCode,
    targetLanguageCode,
    sourceLanguage,
    targetLanguage,
  } = resolveEditorAiTranslateLanguages(chapterState);
  if (!sourceLanguage || !targetLanguage) {
    return null;
  }

  return {
    chapterId: chapterState.chapterId,
    rowId: chapterState.activeRowId,
    sourceLanguageCode,
    targetLanguageCode,
    sourceLanguageLabel:
      typeof sourceLanguage?.name === "string" && sourceLanguage.name.trim()
        ? sourceLanguage.name.trim()
        : sourceLanguageCode,
    targetLanguageLabel:
      typeof targetLanguage?.name === "string" && targetLanguage.name.trim()
        ? targetLanguage.name.trim()
        : targetLanguageCode,
    sourceText: row.fields?.[sourceLanguageCode] ?? "",
  };
}

function failEditorAiTranslate(render, actionId, context, message) {
  const requestKey = createAiTranslateRequestKey(
    context.chapterId,
    context.rowId,
    context.sourceLanguageCode,
    context.targetLanguageCode,
    actionId,
  );
  state.editorChapter = applyEditorAiTranslateActionFailed(
    state.editorChapter,
    actionId,
    context.rowId,
    context.sourceLanguageCode,
    context.targetLanguageCode,
    requestKey,
    context.sourceText,
    message,
  );
  render?.({ scope: "translate-sidebar" });
}

export async function runEditorAiTranslate(render, actionId, operations = {}) {
  const {
    updateEditorRowFieldValue,
    persistEditorRowOnBlur,
  } = operations;
  if (
    !AI_TRANSLATE_ACTION_IDS.includes(actionId)
    || typeof updateEditorRowFieldValue !== "function"
    || typeof persistEditorRowOnBlur !== "function"
  ) {
    return;
  }

  const context = activeEditorTranslateContext();
  if (!context) {
    return;
  }

  if (!context.sourceLanguageCode || !context.targetLanguageCode) {
    failEditorAiTranslate(
      render,
      actionId,
      context,
      "Select both the source and target language before translating.",
    );
    return;
  }

  if (context.sourceLanguageCode === context.targetLanguageCode) {
    failEditorAiTranslate(
      render,
      actionId,
      context,
      "Choose a language other than the source language before translating.",
    );
    return;
  }

  if (!context.sourceText.trim()) {
    failEditorAiTranslate(
      render,
      actionId,
      context,
      "There is no source text to translate yet.",
    );
    return;
  }

  const { providerId, modelId } = resolveAiActionProviderAndModel(actionId);
  if (!modelId) {
    failEditorAiTranslate(
      render,
      actionId,
      context,
      `Select a model for ${AI_ACTION_LABELS[actionId]} on the AI Settings page first.`,
    );
    return;
  }

  try {
    const savedKey = await invoke("load_ai_provider_secret", { providerId });
    if (typeof savedKey !== "string" || !savedKey.trim()) {
      openAiMissingKeyModal(providerId);
      render?.();
      return;
    }
  } catch (error) {
    failEditorAiTranslate(
      render,
      actionId,
      context,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }

  const requestKey = createAiTranslateRequestKey(
    context.chapterId,
    context.rowId,
    context.sourceLanguageCode,
    context.targetLanguageCode,
    actionId,
  );
  state.editorChapter = applyEditorAiTranslateActionLoading(
    state.editorChapter,
    actionId,
    context.rowId,
    context.sourceLanguageCode,
    context.targetLanguageCode,
    requestKey,
    context.sourceText,
  );
  render?.();

  try {
    const payload = await invoke("run_ai_translation", {
      request: {
        providerId,
        modelId,
        text: context.sourceText,
        sourceLanguage: context.sourceLanguageLabel,
        targetLanguage: context.targetLanguageLabel,
      },
    });

    if (
      !currentEditorAiTranslateRequestMatches(
        state.editorChapter,
        context.chapterId,
        actionId,
        context.rowId,
        context.sourceLanguageCode,
        context.targetLanguageCode,
        requestKey,
      )
    ) {
      return;
    }

    const latestRow = findEditorRowById(context.rowId, state.editorChapter);
    if ((latestRow?.fields?.[context.sourceLanguageCode] ?? "") !== context.sourceText) {
      state.editorChapter = clearEditorAiTranslateAction(state.editorChapter, actionId);
      render?.();
      return;
    }

    state.editorChapter = applyEditorAiTranslateActionApplying(
      state.editorChapter,
      actionId,
      context.rowId,
      context.sourceLanguageCode,
      context.targetLanguageCode,
      requestKey,
      context.sourceText,
    );
    render?.({ scope: "translate-sidebar" });

    updateEditorRowFieldValue(
      context.rowId,
      context.targetLanguageCode,
      typeof payload?.translatedText === "string" ? payload.translatedText : "",
    );
    render?.({ scope: "translate-body" });

    await persistEditorRowOnBlur(render, context.rowId);

    if (state.editorChapter?.chapterId !== context.chapterId) {
      return;
    }

    state.editorChapter = clearEditorAiTranslateAction(state.editorChapter, actionId);
    render?.({ scope: "translate-sidebar" });
    showNoticeBadge(`${AI_ACTION_LABELS[actionId]} inserted.`, render);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (errorMeansMissingAiKey(message)) {
      openAiMissingKeyModal(providerId);
      render?.();
      return;
    }

    if (
      !currentEditorAiTranslateRequestMatches(
        state.editorChapter,
        context.chapterId,
        actionId,
        context.rowId,
        context.sourceLanguageCode,
        context.targetLanguageCode,
        requestKey,
      )
    ) {
      return;
    }

    state.editorChapter = applyEditorAiTranslateActionFailed(
      state.editorChapter,
      actionId,
      context.rowId,
      context.sourceLanguageCode,
      context.targetLanguageCode,
      requestKey,
      context.sourceText,
      message,
    );
    render?.();
  }
}
