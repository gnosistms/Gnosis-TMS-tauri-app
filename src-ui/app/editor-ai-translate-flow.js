import { AI_ACTION_LABELS, AI_TRANSLATE_ACTION_IDS } from "./ai-action-config.js";
import {
  applyStoredSelectedTeamAiActionPreferences,
  ensureSharedAiActionConfigurationLoaded,
  openAiMissingKeyModal,
  resolveAiActionProviderAndModel,
} from "./ai-settings-flow.js";
import { ensureSelectedTeamAiProviderReady } from "./team-ai-flow.js";
import {
  applyEditorAiTranslateActionApplying,
  applyEditorAiTranslateActionFailed,
  applyEditorAiTranslateActionLoading,
  clearEditorAiTranslateAction,
  currentEditorAiTranslateRequestMatches,
} from "./editor-ai-translate-state.js";
import { resolveEditorAiTranslateLanguages } from "./editor-ai-translate-target.js";
import {
  applyEditorDerivedGlossaryEntry,
  removeEditorDerivedGlossaryEntry,
  resolveEditorDerivedGlossaryEntry,
} from "./editor-derived-glossary-state.js";
import {
  buildEditorAiTranslationGlossaryHints,
} from "./editor-glossary-highlighting.js";
import {
  prepareEditorDerivedGlossaryForContext,
  resolveEditorDerivedGlossaryUsage,
  resolveLanguageCode,
} from "./editor-derived-glossary-flow.js";
import {
  captureTranslateAnchorForRow,
} from "./scroll-state.js";
import { selectedProjectsTeam, selectedProjectsTeamInstallationId } from "./project-context.js";
import { invoke } from "./runtime.js";
import { showNoticeBadge } from "./status-feedback.js";
import { editorFootnotesPlainText, findEditorRowById } from "./editor-utils.js";
import { state } from "./state.js";
import {
  buildAssistantSourceContextWindow,
  buildEditorAssistantAlternateLanguageTexts,
  logEditorAssistantTranslation,
  logEditorAssistantTranslationDraft,
} from "./editor-ai-assistant-flow.js";
import {
  languageBaseCode,
  languageBaseCodesMatch,
  languageSemanticLabel,
} from "./editor-language-utils.js";
import {
  captureTranslateViewport,
  renderTranslateBodyPreservingViewport,
} from "./translate-viewport.js";

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

function maybeInstallationPayload() {
  const installationId = selectedProjectsTeamInstallationId();
  return installationId === null ? {} : { installationId };
}

function withSelectedInstallation(request = {}) {
  const installationId = selectedProjectsTeamInstallationId();
  return installationId === null ? request : { ...request, installationId };
}

function errorMeansMissingAiKey(message) {
  const normalizedMessage = String(message ?? "").trim().toLowerCase();
  return (
    normalizedMessage.includes("api key is saved yet")
    || normalizedMessage.includes("save one first")
  );
}

function latestEditorTranslateSourceTextMatches(context) {
  const latestRow = findEditorRowById(context.rowId, state.editorChapter);
  return (
    (latestRow?.fields?.[context.sourceLanguageCode] ?? "") === context.sourceText
    && editorFootnotesPlainText(latestRow?.footnotes?.[context.sourceLanguageCode]) === context.sourceFootnote
    && (latestRow?.imageCaptions?.[context.sourceLanguageCode] ?? "") === context.sourceImageCaption
  );
}

function latestEditorTranslateTargetTextIsEmpty(context) {
  const latestRow = findEditorRowById(context.rowId, state.editorChapter);
  return !String(latestRow?.fields?.[context.targetLanguageCode] ?? "").trim();
}

function requestedSourceFootnote(context) {
  return context?.sourceFootnote?.trim() && !context?.targetFootnote?.trim()
    ? context.sourceFootnote
    : "";
}

function requestedSourceImageCaption(context) {
  return context?.sourceImageCaption?.trim() && !context?.targetImageCaption?.trim()
    ? context.sourceImageCaption
    : "";
}

function translatedSectionValue(payload, key) {
  return typeof payload?.[key] === "string" ? payload[key] : "";
}

function applyEditorAiTranslatePayloadToRow(context, payload, updateEditorRowFieldValue) {
  const translatedText = translatedSectionValue(payload, "translatedText");
  const translatedFootnote = translatedSectionValue(payload, "translatedFootnote");
  const translatedImageCaption = translatedSectionValue(payload, "translatedImageCaption");

  const shouldWriteMainText =
    !context.targetText?.trim()
    || (!requestedSourceFootnote(context) && !requestedSourceImageCaption(context));
  if (shouldWriteMainText) {
    updateEditorRowFieldValue(
      context.rowId,
      context.targetLanguageCode,
      translatedText,
    );
  }
  if (requestedSourceFootnote(context) && translatedFootnote.trim()) {
    updateEditorRowFieldValue(
      context.rowId,
      context.targetLanguageCode,
      translatedFootnote,
      "footnote",
    );
  }
  if (requestedSourceImageCaption(context) && translatedImageCaption.trim()) {
    updateEditorRowFieldValue(
      context.rowId,
      context.targetLanguageCode,
      translatedImageCaption,
      "image-caption",
    );
  }
}

function resolveGlossaryUsage(context) {
  const glossaryState = context.chapterState?.glossary ?? null;
  const glossaryModel = glossaryState?.matcherModel ?? null;
  const glossarySourceLanguageCode = resolveLanguageCode(
    glossaryState?.sourceLanguage ?? glossaryModel?.sourceLanguage,
  );
  const glossaryTargetLanguageCode = resolveLanguageCode(
    glossaryState?.targetLanguage ?? glossaryModel?.targetLanguage,
  );

  if (
    !glossarySourceLanguageCode
    || !glossaryTargetLanguageCode
    || glossaryTargetLanguageCode !== languageBaseCode(context.targetLanguage)
  ) {
    return {
      kind: "none",
      glossaryHints: [],
    };
  }

  if (glossarySourceLanguageCode === languageBaseCode(context.sourceLanguage)) {
    return {
      kind: "direct",
      glossaryHints: buildEditorAiTranslationGlossaryHints(
        context.sourceText,
        languageBaseCode(context.sourceLanguage),
        languageBaseCode(context.targetLanguage),
        glossaryModel,
      ),
    };
  }

  return resolveEditorDerivedGlossaryUsage(context);
}

function glossarySourceFieldIsEmpty(context, glossaryUsage) {
  const glossarySourceLanguageCode = glossaryUsage?.glossarySourceLanguageCode ?? "";
  if (!glossarySourceLanguageCode) {
    return false;
  }

  const latestRow = findEditorRowById(context.rowId, state.editorChapter) ?? context.row;
  const currentValue = latestRow?.fields?.[glossarySourceLanguageCode];
  return !String(currentValue ?? "").trim();
}

export function buildEditorAiTranslateContext(chapterState = state.editorChapter, options = {}) {
  const rowId =
    typeof options.rowId === "string" && options.rowId.trim()
      ? options.rowId.trim()
      : chapterState?.activeRowId;
  if (!chapterState?.chapterId || !rowId) {
    return null;
  }

  const row = findEditorRowById(rowId, chapterState);
  if (!row) {
    return null;
  }

  const selectedLanguages = resolveEditorAiTranslateLanguages(chapterState);
  const sourceLanguageCode =
    typeof options.sourceLanguageCode === "string" && options.sourceLanguageCode.trim()
      ? options.sourceLanguageCode.trim()
      : selectedLanguages.sourceLanguageCode;
  const targetLanguageCode =
    typeof options.targetLanguageCode === "string" && options.targetLanguageCode.trim()
      ? options.targetLanguageCode.trim()
      : selectedLanguages.targetLanguageCode;
  const languages = Array.isArray(chapterState.languages) ? chapterState.languages : [];
  const sourceLanguage =
    languages.find((language) => language.code === sourceLanguageCode)
    ?? selectedLanguages.sourceLanguage;
  const targetLanguage =
    languages.find((language) => language.code === targetLanguageCode)
    ?? selectedLanguages.targetLanguage;
  if (!sourceLanguage || !targetLanguage) {
    return null;
  }

  return {
    chapterState,
    projectId: chapterState.projectId,
    row,
    chapterId: chapterState.chapterId,
    rowId,
    sourceLanguageCode,
    targetLanguageCode,
    sourceLanguage,
    targetLanguage,
    sourceLanguageLabel: languageSemanticLabel(sourceLanguage) || sourceLanguageCode,
    targetLanguageLabel: languageSemanticLabel(targetLanguage) || targetLanguageCode,
    sourceText: row.fields?.[sourceLanguageCode] ?? "",
    sourceFootnote: editorFootnotesPlainText(row.footnotes?.[sourceLanguageCode]),
    sourceImageCaption: row.imageCaptions?.[sourceLanguageCode] ?? "",
    targetText: row.fields?.[targetLanguageCode] ?? "",
    targetFootnote: editorFootnotesPlainText(row.footnotes?.[targetLanguageCode]),
    targetImageCaption: row.imageCaptions?.[targetLanguageCode] ?? "",
    rowWindow: buildAssistantSourceContextWindow(
      chapterState,
      rowId,
      sourceLanguageCode,
      targetLanguageCode,
    ),
    alternateLanguageTexts: buildEditorAssistantAlternateLanguageTexts(
      row,
      languages,
      sourceLanguageCode,
      targetLanguageCode,
    ),
  };
}

function activeEditorTranslateContext(chapterState = state.editorChapter) {
  return buildEditorAiTranslateContext(chapterState);
}

function captureEditorAiTranslateAnchor(context) {
  if (!context) {
    return null;
  }

  return (
    captureTranslateAnchorForRow(context.rowId, context.targetLanguageCode, { preferRow: true })
    ?? captureTranslateAnchorForRow(context.rowId, context.sourceLanguageCode, { preferRow: true })
  );
}

function captureEditorAiTranslateViewport(context, options = {}) {
  const stableAnchor = captureEditorAiTranslateAnchor(context);
  const viewportSnapshot = captureTranslateViewport(null, {
    preferPrimed: options.preferPrimed === true,
    expectedRowId: context?.rowId ?? "",
    fallbackAnchor: stableAnchor,
  });
  if (stableAnchor?.rowId) {
    viewportSnapshot.anchor = stableAnchor;
  }
  return viewportSnapshot;
}

function renderEditorAiTranslateBody(render, viewportSnapshot = null) {
  renderTranslateBodyPreservingViewport(render, viewportSnapshot);
}

function renderEditorAiTranslateRow(render, context, options = {}) {
  if (options.renderMode === "visible-rows") {
    render?.({
      scope: "translate-visible-rows",
      rowIds: [context.rowId],
      reason: options.reason ?? "ai-translate",
    });
    return;
  }

  renderEditorAiTranslateBody(
    render,
    captureEditorAiTranslateViewport(context, {
      preferPrimed: options.preferPrimed === true,
    }),
  );
}

function createEditorAiTranslateConfigRender(render) {
  return (options = null) => {
    if (!render) {
      return;
    }

    if (
      options?.scope === "translate-body"
      || options?.scope === "translate-header"
      || options?.scope === "translate-sidebar"
    ) {
      render(options);
      return;
    }

    render({ scope: "translate-sidebar" });
  };
}

function failEditorAiTranslate(render, actionId, context, message, options = {}) {
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
  if (options.rerenderBody === true) {
    renderEditorAiTranslateBody(render, captureEditorAiTranslateViewport(context));
  }
}

export async function runEditorAiTranslateForContext(
  render,
  actionId,
  context,
  operations = {},
  options = {},
) {
  if (state.offline?.isEnabled === true) {
    const message = "This operation is not supported in offline mode";
    showNoticeBadge(message, render);
    return { ok: false, error: message };
  }

  const {
    updateEditorRowFieldValue,
    persistEditorRowOnBlur,
    syncEditorGlossaryHighlightRowDom,
  } = operations;
  if (
    !AI_TRANSLATE_ACTION_IDS.includes(actionId)
    || typeof updateEditorRowFieldValue !== "function"
    || typeof persistEditorRowOnBlur !== "function"
  ) {
    return { ok: false, error: "AI translation is not available." };
  }

  if (!context) {
    return { ok: false, error: "Select a translation row before translating." };
  }

  if (!context.sourceLanguageCode || !context.targetLanguageCode) {
    failEditorAiTranslate(
      render,
      actionId,
      context,
      "Select both the source and target language before translating.",
    );
    return { ok: false, error: "Select both the source and target language before translating." };
  }

  if (context.sourceLanguageCode === context.targetLanguageCode || languageBaseCodesMatch(context.sourceLanguage, context.targetLanguage)) {
    failEditorAiTranslate(
      render,
      actionId,
      context,
      "Choose a language other than the source language before translating.",
    );
    return { ok: false, error: "Choose a language other than the source language before translating." };
  }

  if (
    !context.sourceText.trim()
    && !requestedSourceFootnote(context)
    && !requestedSourceImageCaption(context)
  ) {
    failEditorAiTranslate(
      render,
      actionId,
      context,
      "There is no source text to translate yet.",
    );
    return { ok: false, error: "There is no source text to translate yet." };
  }

  const configRender = createEditorAiTranslateConfigRender(render);
  const requestKey = createAiTranslateRequestKey(
    context.chapterId,
    context.rowId,
    context.sourceLanguageCode,
    context.targetLanguageCode,
    actionId,
  );
  const requestStillMatches = () => currentEditorAiTranslateRequestMatches(
    state.editorChapter,
    context.chapterId,
    actionId,
    context.rowId,
    context.sourceLanguageCode,
    context.targetLanguageCode,
    requestKey,
  );

  const syncFinalGlossaryHighlights = () => {
    if (typeof syncEditorGlossaryHighlightRowDom === "function") {
      syncEditorGlossaryHighlightRowDom(context.rowId);
    }
  };
  state.editorChapter = applyEditorAiTranslateActionLoading(
    state.editorChapter,
    actionId,
    context.rowId,
    context.sourceLanguageCode,
    context.targetLanguageCode,
    requestKey,
    context.sourceText,
  );
  const loadingViewportSnapshot = captureEditorAiTranslateViewport(context, {
    preferPrimed: true,
  });
  render?.({ scope: "translate-sidebar" });
  if (options.renderMode === "visible-rows") {
    renderEditorAiTranslateRow(render, context, {
      renderMode: "visible-rows",
      reason: "ai-translate-loading",
    });
  } else {
    renderEditorAiTranslateBody(render, loadingViewportSnapshot);
  }

  const usedStoredTeamActionPreferences = applyStoredSelectedTeamAiActionPreferences(configRender);
  try {
    await ensureSharedAiActionConfigurationLoaded(configRender);
  } catch (error) {
    if (selectedProjectsTeam()?.canDelete !== true && !usedStoredTeamActionPreferences) {
      if (!requestStillMatches()) {
        return { ok: false, skipped: true };
      }
      const message = error instanceof Error ? error.message : String(error);
      failEditorAiTranslate(
        render,
        actionId,
        context,
        message,
        { rerenderBody: true },
      );
      return { ok: false, error: message };
    }
  }
  if (!requestStillMatches()) {
    return { ok: false, skipped: true };
  }

  const { providerId, modelId } = resolveAiActionProviderAndModel(actionId);
  if (!modelId) {
    failEditorAiTranslate(
      render,
      actionId,
      context,
      `Select a model for ${AI_ACTION_LABELS[actionId]} on the AI Settings page first.`,
      { rerenderBody: true },
    );
    return {
      ok: false,
      error: `Select a model for ${AI_ACTION_LABELS[actionId]} on the AI Settings page first.`,
    };
  }

  try {
    const ensureKeyResult = await ensureSelectedTeamAiProviderReady(configRender, providerId);
    if (!requestStillMatches()) {
      return { ok: false, skipped: true };
    }
    if (!ensureKeyResult?.ok) {
      state.editorChapter = clearEditorAiTranslateAction(state.editorChapter, actionId);
      openAiMissingKeyModal(providerId);
      render?.();
      return { ok: false, error: "The AI provider is not ready.", missingKey: true };
    }
  } catch (error) {
    if (!requestStillMatches()) {
      return { ok: false, skipped: true };
    }
    const message = error instanceof Error ? error.message : String(error);
    failEditorAiTranslate(
      render,
      actionId,
      context,
      message,
      { rerenderBody: true },
    );
    return { ok: false, error: message };
  }

  let glossaryUsage = { kind: "none" };
  let retainedDerivedEntry = null;
  let preparedDerivedGlossaryNeedsPersist = false;
  try {
    glossaryUsage = resolveGlossaryUsage(context);
    retainedDerivedEntry = glossaryUsage.kind === "derived"
      ? (glossaryUsage.cachedDerivedEntry ?? null)
      : null;
    let glossaryHints = Array.isArray(glossaryUsage.glossaryHints)
      ? glossaryUsage.glossaryHints
      : [];

    if (glossaryUsage.kind === "derived") {
      let derivedEntry = glossaryUsage.cachedDerivedEntry;
      if (!derivedEntry || glossaryUsage.cachedDerivedEntryIsStale) {
        const shouldSyncGlossarySourceTextToRow = glossarySourceFieldIsEmpty(
          context,
          glossaryUsage,
        );
        const derivedResult = await prepareEditorDerivedGlossaryForContext({
          render,
          context,
          glossaryUsage,
          providerId,
          modelId,
          requestKey,
          retainedDerivedEntry,
          updateEditorRowFieldValue,
          persistEditorRowOnBlur,
          persistGlossarySourceImmediately:
            options.applyMode === "draft" && shouldSyncGlossarySourceTextToRow,
          syncGlossarySourceTextToRow: shouldSyncGlossarySourceTextToRow,
          renderOptions: {
            renderMode: options.renderMode,
          },
          renderDerivedGlossaryState(reason, renderOptions = {}) {
            const reasonByState = {
              loading: "ai-translate-derived-glossary-loading",
              source: "ai-translate-derived-glossary-source",
              ready: "ai-translate-derived-glossary-ready",
            };
            renderEditorAiTranslateRow(render, context, {
              ...renderOptions,
              reason: reasonByState[reason] ?? "ai-translate-derived-glossary",
            });
          },
          requestStillCurrent: () => currentEditorAiTranslateRequestMatches(
            state.editorChapter,
            context.chapterId,
            actionId,
            context.rowId,
            context.sourceLanguageCode,
            context.targetLanguageCode,
            requestKey,
          ),
          sourceStillCurrent: () => latestEditorTranslateSourceTextMatches(context),
        });

        if (derivedResult?.sourceChanged) {
          const inFlightDerivedEntry = resolveEditorDerivedGlossaryEntry(
            state.editorChapter,
            context.rowId,
          );
          if (inFlightDerivedEntry?.requestKey === requestKey) {
            state.editorChapter = retainedDerivedEntry
              ? applyEditorDerivedGlossaryEntry(
                state.editorChapter,
                context.rowId,
                retainedDerivedEntry,
              )
              : removeEditorDerivedGlossaryEntry(state.editorChapter, context.rowId);
          }
          state.editorChapter = clearEditorAiTranslateAction(state.editorChapter, actionId);
          render?.({ scope: "translate-sidebar" });
          renderEditorAiTranslateRow(render, context, {
            renderMode: options.renderMode,
            reason: "ai-translate-source-changed",
          });
          return { ok: false, skipped: true };
        }

        if (derivedResult?.skipped) {
          return { ok: false, skipped: true };
        }
        preparedDerivedGlossaryNeedsPersist =
          derivedResult?.preparedDerivedGlossaryNeedsPersist === true;
        derivedEntry = derivedResult?.derivedEntry ?? derivedEntry;
        retainedDerivedEntry = derivedEntry;
      }

      glossaryHints = buildEditorAiTranslationGlossaryHints(
        context.sourceText,
        context.sourceLanguageCode,
        context.targetLanguageCode,
        derivedEntry?.matcherModel ?? null,
      );
    }

    const payload = await invoke("run_ai_translation", {
      request: withSelectedInstallation({
        providerId,
        modelId,
        text: context.sourceText,
        sourceLanguageCode: context.sourceLanguageCode,
        targetLanguageCode: context.targetLanguageCode,
        ...(requestedSourceFootnote(context)
          ? { sourceFootnote: requestedSourceFootnote(context) }
          : {}),
        ...(requestedSourceImageCaption(context)
          ? { sourceImageCaption: requestedSourceImageCaption(context) }
          : {}),
        ...(context.targetFootnote?.trim() ? { targetFootnote: context.targetFootnote } : {}),
        ...(context.targetImageCaption?.trim() ? { targetImageCaption: context.targetImageCaption } : {}),
        sourceLanguage: context.sourceLanguageLabel,
        targetLanguage: context.targetLanguageLabel,
        rowWindow: context.rowWindow,
        alternateLanguageTexts: context.alternateLanguageTexts,
        ...(Array.isArray(glossaryHints) && glossaryHints.length > 0
          ? { glossaryHints }
          : {}),
      }),
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
      return { ok: false, skipped: true };
    }

    if (!latestEditorTranslateSourceTextMatches(context)) {
      state.editorChapter = clearEditorAiTranslateAction(state.editorChapter, actionId);
      render?.({ scope: "translate-sidebar" });
      renderEditorAiTranslateRow(render, context, {
        renderMode: options.renderMode,
        reason: "ai-translate-source-changed",
      });
      return { ok: false, skipped: true };
    }

    if (options.applyMode === "draft") {
      if (options.autoApplyDraft === true && latestEditorTranslateTargetTextIsEmpty(context)) {
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

        applyEditorAiTranslatePayloadToRow(context, payload, updateEditorRowFieldValue);
        renderEditorAiTranslateRow(render, context, {
          renderMode: options.renderMode,
          reason: "ai-translate-auto-apply",
        });

        await persistEditorRowOnBlur(render, context.rowId, {
          commitMetadata: {
            operation: "ai-translation",
            aiModel: modelId,
          },
          waitForDurable: false,
        });

        if (state.editorChapter?.chapterId !== context.chapterId) {
          return { ok: false, skipped: true };
        }

        logEditorAssistantTranslation({
          rowId: context.rowId,
          sourceLanguageCode: context.sourceLanguageCode,
          targetLanguageCode: context.targetLanguageCode,
          sourceLanguageLabel: context.sourceLanguageLabel,
          targetLanguageLabel: context.targetLanguageLabel,
          providerId,
          modelId,
          sourceText: context.sourceText,
          glossarySourceText:
            glossaryUsage.kind === "derived"
              ? (retainedDerivedEntry?.glossarySourceText ?? "")
              : context.sourceText,
          glossaryHints,
          promptText: typeof payload?.promptText === "string" ? payload.promptText : "",
          translatedText: translatedSectionValue(payload, "translatedText"),
          translatedFootnote: translatedSectionValue(payload, "translatedFootnote"),
          translatedImageCaption: translatedSectionValue(payload, "translatedImageCaption"),
          appliedText: translatedSectionValue(payload, "translatedText"),
          providerContinuation: payload?.providerContinuation ?? null,
          summary: `${AI_ACTION_LABELS[actionId]} applied to ${context.targetLanguageLabel}.`,
        });

        state.editorChapter = clearEditorAiTranslateAction(state.editorChapter, actionId);
        render?.({ scope: "translate-sidebar" });
        renderEditorAiTranslateRow(render, context, {
          renderMode: options.renderMode,
          reason: "ai-translate-auto-apply-complete",
        });
        syncFinalGlossaryHighlights();
        if (options.showNotice !== false) {
          showNoticeBadge(`${AI_ACTION_LABELS[actionId]} inserted.`, render);
        }
        return {
          ok: true,
          translated: true,
          applied: true,
          providerContinuation: payload?.providerContinuation ?? null,
          translatedText: translatedSectionValue(payload, "translatedText"),
          translatedFootnote: translatedSectionValue(payload, "translatedFootnote"),
          translatedImageCaption: translatedSectionValue(payload, "translatedImageCaption"),
        };
      }

      logEditorAssistantTranslationDraft({
        rowId: context.rowId,
        sourceLanguageCode: context.sourceLanguageCode,
        targetLanguageCode: context.targetLanguageCode,
        sourceLanguageLabel: context.sourceLanguageLabel,
        targetLanguageLabel: context.targetLanguageLabel,
        providerId,
        modelId,
        sourceText: context.sourceText,
        targetText: context.targetText,
        glossarySourceText:
          glossaryUsage.kind === "derived"
            ? (retainedDerivedEntry?.glossarySourceText ?? "")
            : context.sourceText,
        glossaryHints,
        promptText: typeof payload?.promptText === "string" ? payload.promptText : "",
        draftTranslationText: translatedSectionValue(payload, "translatedText"),
        draftTranslationFootnote: translatedSectionValue(payload, "translatedFootnote"),
        draftTranslationImageCaption: translatedSectionValue(payload, "translatedImageCaption"),
        providerContinuation: payload?.providerContinuation ?? null,
        summary: `${AI_ACTION_LABELS[actionId]} draft for ${context.targetLanguageLabel}.`,
      });
      state.editorChapter = clearEditorAiTranslateAction(state.editorChapter, actionId);
      render?.({ scope: "translate-sidebar" });
      renderEditorAiTranslateRow(render, context, {
        renderMode: options.renderMode,
        reason: "ai-translate-draft",
      });
      if (options.showNotice !== false) {
        showNoticeBadge(`${AI_ACTION_LABELS[actionId]} draft ready.`, render);
      }
      return {
        ok: true,
        translated: true,
        drafted: true,
        providerContinuation: payload?.providerContinuation ?? null,
        translatedText: translatedSectionValue(payload, "translatedText"),
        translatedFootnote: translatedSectionValue(payload, "translatedFootnote"),
        translatedImageCaption: translatedSectionValue(payload, "translatedImageCaption"),
      };
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

    applyEditorAiTranslatePayloadToRow(context, payload, updateEditorRowFieldValue);
    renderEditorAiTranslateRow(render, context, {
      renderMode: options.renderMode,
      reason: "ai-translate-apply",
    });

    await persistEditorRowOnBlur(render, context.rowId, {
      commitMetadata: {
        operation: "ai-translation",
        aiModel: modelId,
      },
    });

    if (state.editorChapter?.chapterId !== context.chapterId) {
      return { ok: false, skipped: true };
    }

    logEditorAssistantTranslation({
      rowId: context.rowId,
      sourceLanguageCode: context.sourceLanguageCode,
      targetLanguageCode: context.targetLanguageCode,
      sourceLanguageLabel: context.sourceLanguageLabel,
      targetLanguageLabel: context.targetLanguageLabel,
      providerId,
      modelId,
      sourceText: context.sourceText,
      glossarySourceText:
        glossaryUsage.kind === "derived"
          ? (retainedDerivedEntry?.glossarySourceText ?? "")
          : context.sourceText,
      glossaryHints,
      promptText: typeof payload?.promptText === "string" ? payload.promptText : "",
      translatedText: translatedSectionValue(payload, "translatedText"),
      translatedFootnote: translatedSectionValue(payload, "translatedFootnote"),
      translatedImageCaption: translatedSectionValue(payload, "translatedImageCaption"),
      appliedText: translatedSectionValue(payload, "translatedText"),
      providerContinuation: payload?.providerContinuation ?? null,
      summary: `${AI_ACTION_LABELS[actionId]} applied to ${context.targetLanguageLabel}.`,
    });

    state.editorChapter = clearEditorAiTranslateAction(state.editorChapter, actionId);
    render?.({ scope: "translate-sidebar" });
    renderEditorAiTranslateRow(render, context, {
      renderMode: options.renderMode,
      reason: "ai-translate-apply-complete",
    });
    syncFinalGlossaryHighlights();
    if (options.showNotice !== false) {
      showNoticeBadge(`${AI_ACTION_LABELS[actionId]} inserted.`, render);
    }
    return {
      ok: true,
      translated: true,
      providerContinuation: payload?.providerContinuation ?? null,
      translatedText: translatedSectionValue(payload, "translatedText"),
      translatedFootnote: translatedSectionValue(payload, "translatedFootnote"),
      translatedImageCaption: translatedSectionValue(payload, "translatedImageCaption"),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
      return { ok: false, skipped: true };
    }

    if (errorMeansMissingAiKey(message)) {
      state.editorChapter = clearEditorAiTranslateAction(state.editorChapter, actionId);
      openAiMissingKeyModal(providerId);
      render?.();
      return { ok: false, error: message, missingKey: true };
    }

    if (
      preparedDerivedGlossaryNeedsPersist
      && latestEditorTranslateSourceTextMatches(context)
    ) {
      try {
        await persistEditorRowOnBlur(render, context.rowId, {
          commitMetadata: {
            aiModel: modelId,
          },
        });
      } catch {
        // Keep the translation failure as the primary error surface. Row persistence
        // failures already update row state and notices through the persistence flow.
      }
    }

    if (glossaryUsage.kind === "derived") {
      const currentDerivedEntry = resolveEditorDerivedGlossaryEntry(
        state.editorChapter,
        context.rowId,
      );
      if (
        retainedDerivedEntry
        && currentDerivedEntry?.status === "loading"
        && currentDerivedEntry.requestKey === requestKey
      ) {
        state.editorChapter = applyEditorDerivedGlossaryEntry(
          state.editorChapter,
          context.rowId,
          retainedDerivedEntry,
        );
      } else if (!retainedDerivedEntry) {
        state.editorChapter = applyEditorDerivedGlossaryEntry(
          state.editorChapter,
          context.rowId,
          {
            status: "error",
            error: message,
            requestKey,
            ...glossaryUsage.derivedContext,
            entries: [],
            matcherModel: null,
          },
        );
      }
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
    return { ok: false, error: message };
  }
}

export async function runEditorAiTranslate(render, actionId, operations = {}) {
  const context = activeEditorTranslateContext();
  return runEditorAiTranslateForContext(render, actionId, context, operations, {
    applyMode: "draft",
    autoApplyDraft: true,
  });
}
