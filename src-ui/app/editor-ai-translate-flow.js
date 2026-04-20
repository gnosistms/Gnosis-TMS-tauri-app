import { AI_ACTION_LABELS, AI_TRANSLATE_ACTION_IDS } from "./ai-action-config.js";
import {
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
  buildEditorDerivedGlossaryContext,
  buildEditorGlossaryRevisionKey,
  resolveEditorDerivedGlossarySourceText,
  resolveEditorDerivedGlossaryEntry,
} from "./editor-derived-glossary-state.js";
import {
  buildEditorAiTranslationGlossaryHints,
  buildEditorDerivedGlossaryModel,
} from "./editor-glossary-highlighting.js";
import {
  captureTranslateAnchorForRow,
} from "./scroll-state.js";
import { selectedProjectsTeamInstallationId } from "./project-context.js";
import { invoke } from "./runtime.js";
import { showNoticeBadge } from "./status-feedback.js";
import { findEditorRowById } from "./editor-utils.js";
import { state } from "./state.js";
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

function resolveLanguageCode(language) {
  if (typeof language === "string" && language.trim()) {
    return language.trim();
  }

  if (language && typeof language === "object") {
    const code = typeof language.code === "string" ? language.code.trim() : "";
    if (code) {
      return code;
    }
  }

  return "";
}

function resolveLanguageLabel(language, fallbackCode = "") {
  if (language && typeof language === "object") {
    const name = typeof language.name === "string" ? language.name.trim() : "";
    if (name) {
      return name;
    }
  }

  return fallbackCode || "";
}

function sanitizeTermList(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function readRowFieldText(row, languageCode) {
  if (!languageCode) {
    return "";
  }

  return typeof row?.fields?.[languageCode] === "string"
    ? row.fields[languageCode]
    : String(row?.fields?.[languageCode] ?? "");
}

function buildDerivedGlossaryTermInputs(glossaryState) {
  return (Array.isArray(glossaryState?.terms) ? glossaryState.terms : [])
    .filter((term) => term?.lifecycleState !== "deleted")
    .map((term) => ({
      glossarySourceTerms: sanitizeTermList(term?.sourceTerms),
      targetVariants: sanitizeTermList(term?.targetTerms),
      notes:
        typeof term?.notesToTranslators === "string" && term.notesToTranslators.trim()
          ? [term.notesToTranslators.trim()]
          : [],
    }))
    .filter((term) => term.glossarySourceTerms.length > 0);
}

function buildDerivedGlossaryState({
  glossaryState,
  sourceLanguage,
  targetLanguage,
  requestKey,
  derivedContext,
  payload = {},
}) {
  const glossarySourceText =
    typeof payload?.glossarySourceText === "string"
      ? payload.glossarySourceText
      : derivedContext.glossarySourceText;
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  return {
    status: "ready",
    error: "",
    requestKey,
    ...derivedContext,
    glossarySourceText,
    entries,
    matcherModel: buildEditorDerivedGlossaryModel({
      sourceLanguage,
      targetLanguage,
      entries,
      glossaryId: glossaryState?.glossaryId ?? null,
      repoName: glossaryState?.repoName ?? "",
      title: glossaryState?.title ?? "",
    }),
  };
}

function resolvePreparedDerivedGlossaryContext(glossaryUsage, payload = {}) {
  const glossarySourceText =
    typeof payload?.glossarySourceText === "string"
      ? payload.glossarySourceText
      : glossaryUsage?.derivedContext?.glossarySourceText ?? "";
  const shouldStoreInRow = glossarySourceText.trim().length > 0;

  return {
    ...glossaryUsage.derivedContext,
    glossarySourceText,
    glossarySourceTextOrigin:
      shouldStoreInRow
        ? "row"
        : glossaryUsage?.derivedContext?.glossarySourceTextOrigin ?? "generated",
  };
}

function syncPreparedDerivedGlossarySourceTextToRow(
  render,
  context,
  glossaryUsage,
  derivedContext,
  updateEditorRowFieldValue,
) {
  const glossarySourceLanguageCode = glossaryUsage?.glossarySourceLanguageCode ?? "";
  if (
    !glossarySourceLanguageCode
    || typeof updateEditorRowFieldValue !== "function"
    || derivedContext?.glossarySourceTextOrigin !== "row"
  ) {
    return false;
  }

  const currentRow = findEditorRowById(context.rowId, state.editorChapter);
  const currentGlossarySourceText = readRowFieldText(currentRow, glossarySourceLanguageCode);
  if (currentGlossarySourceText === derivedContext.glossarySourceText) {
    return false;
  }

  updateEditorRowFieldValue(
    context.rowId,
    glossarySourceLanguageCode,
    derivedContext.glossarySourceText,
  );
  renderEditorAiTranslateBody(render, captureEditorAiTranslateViewport(context));
  return true;
}

function latestEditorTranslateSourceTextMatches(context) {
  const latestRow = findEditorRowById(context.rowId, state.editorChapter);
  return (latestRow?.fields?.[context.sourceLanguageCode] ?? "") === context.sourceText;
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
    || glossaryTargetLanguageCode !== context.targetLanguageCode
  ) {
    return {
      kind: "none",
      glossaryHints: [],
    };
  }

  if (glossarySourceLanguageCode === context.sourceLanguageCode) {
    return {
      kind: "direct",
      glossaryHints: buildEditorAiTranslationGlossaryHints(
        context.sourceText,
        context.sourceLanguageCode,
        context.targetLanguageCode,
        glossaryModel,
      ),
    };
  }

  const glossaryTerms = buildDerivedGlossaryTermInputs(glossaryState);
  if (glossaryTerms.length === 0) {
    return {
      kind: "none",
      glossaryHints: [],
    };
  }

  const {
    glossarySourceText,
    glossarySourceTextOrigin,
  } = resolveEditorDerivedGlossarySourceText(
    context.row,
    context.sourceLanguageCode,
    glossarySourceLanguageCode,
  );
  const derivedContext = buildEditorDerivedGlossaryContext({
    translationSourceLanguageCode: context.sourceLanguageCode,
    glossarySourceLanguageCode,
    targetLanguageCode: context.targetLanguageCode,
    translationSourceText: context.sourceText,
    glossarySourceText,
    glossarySourceTextOrigin,
    glossaryRevisionKey: buildEditorGlossaryRevisionKey(glossaryState),
  });
  const cachedDerivedEntry = resolveEditorDerivedGlossaryEntry(
    context.chapterState,
    context.rowId,
    derivedContext,
  );

  return {
    kind: "derived",
    glossaryState,
    glossaryTerms,
    glossarySourceLanguageCode,
    glossarySourceLanguageLabel: resolveLanguageLabel(
      glossaryState?.sourceLanguage ?? glossaryModel?.sourceLanguage,
      glossarySourceLanguageCode,
    ),
    derivedContext,
    cachedDerivedEntry,
  };
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
    chapterState,
    row,
    chapterId: chapterState.chapterId,
    rowId: chapterState.activeRowId,
    sourceLanguageCode,
    targetLanguageCode,
    sourceLanguage,
    targetLanguage,
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

  const configRender = createEditorAiTranslateConfigRender(render);
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
  const loadingViewportSnapshot = captureEditorAiTranslateViewport(context, {
    preferPrimed: true,
  });
  render?.({ scope: "translate-sidebar" });
  renderEditorAiTranslateBody(render, loadingViewportSnapshot);

  try {
    await ensureSharedAiActionConfigurationLoaded(configRender);
  } catch {
    // Keep the current local selection and let the downstream key/model checks
    // surface the actionable error.
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
    return;
  }

  try {
    const ensureKeyResult = await ensureSelectedTeamAiProviderReady(configRender, providerId);
    if (!ensureKeyResult?.ok) {
      state.editorChapter = clearEditorAiTranslateAction(state.editorChapter, actionId);
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
      { rerenderBody: true },
    );
    return;
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
      if (!derivedEntry) {
        state.editorChapter = applyEditorDerivedGlossaryEntry(
          state.editorChapter,
          context.rowId,
          {
            status: "loading",
            error: "",
            requestKey,
            ...glossaryUsage.derivedContext,
            entries: [],
            matcherModel: null,
          },
        );
        renderEditorAiTranslateBody(render, captureEditorAiTranslateViewport(context));

        const payload = await invoke("prepare_editor_ai_translated_glossary", {
          request: withSelectedInstallation({
            providerId,
            modelId,
            translationSourceText: context.sourceText,
            translationSourceLanguage: context.sourceLanguageLabel,
            glossarySourceLanguage: glossaryUsage.glossarySourceLanguageLabel,
            targetLanguage: context.targetLanguageLabel,
            glossarySourceText: glossaryUsage.derivedContext.glossarySourceText,
            glossaryTerms: glossaryUsage.glossaryTerms,
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
          return;
        }

        if (!latestEditorTranslateSourceTextMatches(context)) {
          state.editorChapter = clearEditorAiTranslateAction(state.editorChapter, actionId);
          render?.({ scope: "translate-sidebar" });
          renderEditorAiTranslateBody(render, captureEditorAiTranslateViewport(context));
          return;
        }

        const preparedDerivedContext = resolvePreparedDerivedGlossaryContext(
          glossaryUsage,
          payload,
        );
        const wrotePreparedGlossarySourceText = syncPreparedDerivedGlossarySourceTextToRow(
          render,
          context,
          glossaryUsage,
          preparedDerivedContext,
          updateEditorRowFieldValue,
        );
        preparedDerivedGlossaryNeedsPersist =
          preparedDerivedContext.glossarySourceTextOrigin === "row"
          && (
            glossaryUsage.derivedContext.glossarySourceTextOrigin !== "row"
            || wrotePreparedGlossarySourceText
          );
        derivedEntry = buildDerivedGlossaryState({
          glossaryState: glossaryUsage.glossaryState,
          sourceLanguage: context.sourceLanguage,
          targetLanguage: context.targetLanguage,
          requestKey,
          derivedContext: preparedDerivedContext,
          payload,
        });
        state.editorChapter = applyEditorDerivedGlossaryEntry(
          state.editorChapter,
          context.rowId,
          derivedEntry,
        );
        retainedDerivedEntry = derivedEntry;
        renderEditorAiTranslateBody(render, captureEditorAiTranslateViewport(context));
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
        sourceLanguage: context.sourceLanguageLabel,
        targetLanguage: context.targetLanguageLabel,
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
      return;
    }

    const latestRow = findEditorRowById(context.rowId, state.editorChapter);
    if ((latestRow?.fields?.[context.sourceLanguageCode] ?? "") !== context.sourceText) {
      state.editorChapter = clearEditorAiTranslateAction(state.editorChapter, actionId);
      render?.({ scope: "translate-sidebar" });
      renderEditorAiTranslateBody(render, captureEditorAiTranslateViewport(context));
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

    const applyViewportSnapshot = captureEditorAiTranslateViewport(context);
    updateEditorRowFieldValue(
      context.rowId,
      context.targetLanguageCode,
      typeof payload?.translatedText === "string" ? payload.translatedText : "",
    );
    renderEditorAiTranslateBody(render, applyViewportSnapshot);

    await persistEditorRowOnBlur(render, context.rowId, {
      commitMetadata: {
        operation: "ai-translation",
        aiModel: modelId,
      },
    });

    if (state.editorChapter?.chapterId !== context.chapterId) {
      return;
    }

    state.editorChapter = clearEditorAiTranslateAction(state.editorChapter, actionId);
    render?.({ scope: "translate-sidebar" });
    showNoticeBadge(`${AI_ACTION_LABELS[actionId]} inserted.`, render);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (errorMeansMissingAiKey(message)) {
      state.editorChapter = clearEditorAiTranslateAction(state.editorChapter, actionId);
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

    if (glossaryUsage.kind === "derived" && !retainedDerivedEntry) {
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
