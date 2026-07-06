import { AI_ACTION_LABELS, AI_TRANSLATE_ACTION_IDS } from "./ai-action-config.js";
import {
  applyEditorAiTranslatePayloadToRow,
  buildEditorAiTranslateContext,
  ensureEditorAiTranslateProviderReady,
  latestEditorTranslateSourceTextMatches,
  runEditorAiTranslateForContext,
  translatedSectionValue,
} from "./editor-ai-translate-flow.js";
import { clearEditorAiTranslateAction } from "./editor-ai-translate-state.js";
import { editorFootnotesPlainText, findEditorRowById } from "./editor-utils.js";
import {
  languageBaseCode,
  languageBaseCodesMatch,
  languageSemanticLabel,
} from "./editor-language-utils.js";
import {
  buildEditorAssistantAlternateLanguageTexts,
  logEditorAssistantTranslation,
} from "./editor-ai-assistant-flow.js";
import {
  buildBatchGlossaryHints,
  chunkTranslateAllWork,
  estimateSourceTokens,
} from "./editor-ai-batch-request.js";
import { buildBatchSourceContext } from "./editor-ai-context-window.js";
import { buildEditorDerivedGlossaryModel } from "./editor-glossary-highlighting.js";
import {
  buildDerivedGlossaryTermInputs,
  resolveLanguageLabel,
} from "./editor-derived-glossary-flow.js";
import { openAiMissingKeyModal } from "./ai-settings-flow.js";
import { selectedProjectsTeamInstallationId } from "./project-context.js";
import { invoke } from "./runtime.js";
import { createEditorAiTranslateAllModalState, state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";

const BATCH_TRANSLATE_ACTION_ID = AI_TRANSLATE_ACTION_IDS[0] ?? "translate1";

let activeBatchRunId = 0;

function sourceLanguageCodeForChapter(chapterState) {
  const selectedCode = String(chapterState?.selectedSourceLanguageCode ?? "").trim();
  if (selectedCode) {
    return selectedCode;
  }

  const languages = Array.isArray(chapterState?.languages) ? chapterState.languages : [];
  return (
    languages.find((language) => language?.role === "source")?.code
    ?? languages[0]?.code
    ?? ""
  );
}

function visibleTargetLanguagesForChapter(chapterState) {
  const sourceLanguageCode = sourceLanguageCodeForChapter(chapterState);
  const languages = Array.isArray(chapterState?.languages) ? chapterState.languages : [];
  const sourceLanguage = languages.find((language) => language?.code === sourceLanguageCode) ?? null;
  const collapsedLanguageCodes =
    chapterState?.collapsedLanguageCodes instanceof Set
      ? chapterState.collapsedLanguageCodes
      : new Set();

  return languages
    .filter((language) => {
      const code = String(language?.code ?? "").trim();
      return code
        && code !== sourceLanguageCode
        && !languageBaseCodesMatch(sourceLanguage, language)
        && !collapsedLanguageCodes.has(code);
    });
}

function normalizeSelectedLanguageCodes(chapterState, languageCodes = []) {
  const visibleCodes = new Set(
    visibleTargetLanguagesForChapter(chapterState).map((language) => language.code),
  );
  return [...new Set(
    (Array.isArray(languageCodes) ? languageCodes : [])
      .map((code) => String(code ?? "").trim())
      .filter((code) => visibleCodes.has(code)),
  )];
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

function glossarySourceLanguageCodeForChapter(chapterState) {
  const glossaryState = chapterState?.glossary ?? null;
  const glossaryModel = glossaryState?.matcherModel ?? null;
  return resolveLanguageCode(glossaryState?.sourceLanguage ?? glossaryModel?.sourceLanguage);
}

function prioritizeGlossarySourceLanguageCode(chapterState, languageCodes) {
  const glossarySourceLanguageCode = glossarySourceLanguageCodeForChapter(chapterState);
  const matchingLanguageCode = (Array.isArray(chapterState?.languages) ? chapterState.languages : [])
    .find((language) =>
      languageCodes.includes(language?.code)
      && languageBaseCode(language) === glossarySourceLanguageCode
    )?.code;
  if (!glossarySourceLanguageCode || !matchingLanguageCode) {
    return languageCodes;
  }

  return [
    matchingLanguageCode,
    ...languageCodes.filter((languageCode) => languageCode !== matchingLanguageCode),
  ];
}

function readRowFieldText(row, languageCode) {
  if (!languageCode) {
    return "";
  }

  return typeof row?.fields?.[languageCode] === "string"
    ? row.fields[languageCode]
    : String(row?.fields?.[languageCode] ?? "");
}

function readRowFootnoteText(row, languageCode) {
  if (!languageCode) {
    return "";
  }

  return editorFootnotesPlainText(row?.footnotes?.[languageCode]);
}

function readRowImageCaptionText(row, languageCode) {
  if (!languageCode) {
    return "";
  }

  return typeof row?.imageCaptions?.[languageCode] === "string"
    ? row.imageCaptions[languageCode]
    : String(row?.imageCaptions?.[languageCode] ?? "");
}

function rowHasTranslateAllWork(row, sourceLanguageCode, targetLanguageCode) {
  return (
    (readRowFieldText(row, sourceLanguageCode).trim() && !readRowFieldText(row, targetLanguageCode).trim())
    || (readRowFootnoteText(row, sourceLanguageCode).trim() && !readRowFootnoteText(row, targetLanguageCode).trim())
    || (readRowImageCaptionText(row, sourceLanguageCode).trim() && !readRowImageCaptionText(row, targetLanguageCode).trim())
  );
}

function buildEditorAiTranslateAllWork(chapterState, selectedLanguageCodes) {
  const sourceLanguageCode = sourceLanguageCodeForChapter(chapterState);
  const targetLanguageCodes = prioritizeGlossarySourceLanguageCode(
    chapterState,
    normalizeSelectedLanguageCodes(chapterState, selectedLanguageCodes),
  );
  if (!chapterState?.chapterId || !sourceLanguageCode || targetLanguageCodes.length === 0) {
    return [];
  }

  const work = [];
  for (const row of Array.isArray(chapterState.rows) ? chapterState.rows : []) {
    if (!row?.rowId || row.lifecycleState === "deleted") {
      continue;
    }
    if (
      !readRowFieldText(row, sourceLanguageCode).trim()
      && !readRowFootnoteText(row, sourceLanguageCode).trim()
      && !readRowImageCaptionText(row, sourceLanguageCode).trim()
    ) {
      continue;
    }

    for (const targetLanguageCode of targetLanguageCodes) {
      if (
        targetLanguageCode === sourceLanguageCode
        || !rowHasTranslateAllWork(row, sourceLanguageCode, targetLanguageCode)
      ) {
        continue;
      }
      work.push({
        rowId: row.rowId,
        sourceLanguageCode,
        targetLanguageCode,
      });
    }
  }

  return work;
}

function buildEditorAiTranslateAllLanguageProgress(chapterState, selectedLanguageCodes, work) {
  const selectedCodes = normalizeSelectedLanguageCodes(chapterState, selectedLanguageCodes);
  const workItems = Array.isArray(work) ? work : [];
  return Object.fromEntries(
    selectedCodes.map((languageCode) => [
      languageCode,
      {
        completedCount: 0,
        totalCount: workItems.filter((item) => item?.targetLanguageCode === languageCode).length,
      },
    ]),
  );
}

function incrementEditorAiTranslateAllProgress(languageProgress, languageCode) {
  const code = String(languageCode ?? "").trim();
  const current =
    languageProgress && typeof languageProgress === "object"
      ? languageProgress
      : {};
  const currentLanguageProgress = current[code] ?? { completedCount: 0, totalCount: 0 };
  const totalCount = Math.max(0, Number.parseInt(String(currentLanguageProgress.totalCount ?? 0), 10) || 0);
  const completedCount = Math.min(
    totalCount,
    Math.max(0, Number.parseInt(String(currentLanguageProgress.completedCount ?? 0), 10) || 0) + 1,
  );
  return {
    ...current,
    [code]: {
      completedCount,
      totalCount,
    },
  };
}

function applyEditorAiTranslateAllModal(updates) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    aiTranslateAllModal: {
      ...createEditorAiTranslateAllModalState(),
      ...state.editorChapter.aiTranslateAllModal,
      ...updates,
    },
  };
}

export function openEditorAiTranslateAllModal(render) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  if (state.offline?.isEnabled === true) {
    showNoticeBadge("This operation is not supported in offline mode", render);
    return;
  }

  const selectedLanguageCodes = visibleTargetLanguagesForChapter(state.editorChapter)
    .map((language) => language.code);
  state.editorChapter = {
    ...state.editorChapter,
    aiTranslateAllModal: {
      ...createEditorAiTranslateAllModalState(),
      isOpen: true,
      selectedLanguageCodes,
    },
  };
  render?.();
}

export function cancelEditorAiTranslateAllModal(render) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  const modal = state.editorChapter.aiTranslateAllModal;
  if (modal?.status === "loading") {
    activeBatchRunId += 1;
    state.editorChapter = clearEditorAiTranslateAction(
      state.editorChapter,
      BATCH_TRANSLATE_ACTION_ID,
    );
    state.editorChapter = {
      ...state.editorChapter,
      aiTranslateAllModal: createEditorAiTranslateAllModalState(),
    };
    render?.();
    showNoticeBadge("AI translation stopped.", render);
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    aiTranslateAllModal: createEditorAiTranslateAllModalState(),
  };
  render?.();
}

export function updateEditorAiTranslateAllLanguageSelection(render, languageCode, selected) {
  if (!state.editorChapter?.chapterId || state.editorChapter.aiTranslateAllModal?.status === "loading") {
    return;
  }

  const code = String(languageCode ?? "").trim();
  if (!code) {
    return;
  }

  const selectedCodes = new Set(
    normalizeSelectedLanguageCodes(
      state.editorChapter,
      state.editorChapter.aiTranslateAllModal?.selectedLanguageCodes,
    ),
  );
  if (selected) {
    selectedCodes.add(code);
  } else {
    selectedCodes.delete(code);
  }

  applyEditorAiTranslateAllModal({
    selectedLanguageCodes: normalizeSelectedLanguageCodes(state.editorChapter, [...selectedCodes]),
    error: "",
  });
  render?.();
}

function glossaryUsageKindForPair(chapterState, sourceLanguageCode, targetLanguageCode) {
  const glossaryState = chapterState?.glossary ?? null;
  const glossaryModel = glossaryState?.matcherModel ?? null;
  const glossarySourceLanguageCode = resolveLanguageCode(
    glossaryState?.sourceLanguage ?? glossaryModel?.sourceLanguage,
  );
  const glossaryTargetLanguageCode = resolveLanguageCode(
    glossaryState?.targetLanguage ?? glossaryModel?.targetLanguage,
  );
  const languages = Array.isArray(chapterState?.languages) ? chapterState.languages : [];
  const sourceLanguage = languages.find((language) => language?.code === sourceLanguageCode) ?? null;
  const targetLanguage = languages.find((language) => language?.code === targetLanguageCode) ?? null;

  if (
    !glossarySourceLanguageCode
    || !glossaryTargetLanguageCode
    || glossaryTargetLanguageCode !== languageBaseCode(targetLanguage)
  ) {
    return "none";
  }
  if (glossarySourceLanguageCode === languageBaseCode(sourceLanguage)) {
    return "direct";
  }
  return "derived";
}

function buildTranslateBatchRequest(chapterState, items, glossaryHints, providerId, modelId) {
  const sourceLanguageCode = items[0].sourceLanguageCode;
  const targetLanguageCode = items[0].targetLanguageCode;
  const languages = Array.isArray(chapterState?.languages) ? chapterState.languages : [];
  const sourceLanguage = languages.find((language) => language?.code === sourceLanguageCode) ?? null;
  const targetLanguage = languages.find((language) => language?.code === targetLanguageCode) ?? null;

  const rows = items.map((item) => {
    const row = findEditorRowById(item.rowId, chapterState);
    return {
      rowId: item.rowId,
      sourceText: readRowFieldText(row, sourceLanguageCode),
      sourceFootnote: readRowFootnoteText(row, sourceLanguageCode),
      sourceImageCaption: readRowImageCaptionText(row, sourceLanguageCode),
      targetFootnote: readRowFootnoteText(row, targetLanguageCode),
      targetImageCaption: readRowImageCaptionText(row, targetLanguageCode),
      alternateLanguageTexts: buildEditorAssistantAlternateLanguageTexts(
        row,
        languages,
        sourceLanguageCode,
        targetLanguageCode,
      ),
    };
  });

  const { contextBefore, contextAfter } = buildBatchSourceContext(
    chapterState,
    items[0].rowId,
    items[items.length - 1].rowId,
    sourceLanguageCode,
    targetLanguageCode,
  );

  const installationId = selectedProjectsTeamInstallationId();
  const request = {
    providerId,
    modelId,
    sourceLanguage: languageSemanticLabel(sourceLanguage) || sourceLanguageCode,
    targetLanguage: languageSemanticLabel(targetLanguage) || targetLanguageCode,
    sourceLanguageCode,
    targetLanguageCode,
    glossaryHints: Array.isArray(glossaryHints) ? glossaryHints : [],
    contextBefore,
    contextAfter,
    rows,
  };
  return installationId === null ? request : { ...request, installationId };
}

// Derives one glossary for the whole batch by pivot-translating the combined
// batch source, matching, and aligning once — returning a derived matcher model,
// or null when there is no usable derived glossary (so the caller can fall back).
async function prepareBatchDerivedGlossaryModel({
  chapterState,
  sourceLanguage,
  targetLanguage,
  sourceTexts,
  providerId,
  modelId,
  prepareBatch,
}) {
  const glossaryState = chapterState?.glossary ?? null;
  const glossaryModel = glossaryState?.matcherModel ?? null;
  const glossaryTerms = buildDerivedGlossaryTermInputs(glossaryState);
  if (glossaryTerms.length === 0) {
    return null;
  }
  const glossarySourceLanguageCode = resolveLanguageCode(
    glossaryState?.sourceLanguage ?? glossaryModel?.sourceLanguage,
  );

  const payload = await prepareBatch({
    providerId,
    modelId,
    translationSourceTexts: sourceTexts,
    translationSourceLanguage: languageSemanticLabel(sourceLanguage) || sourceLanguage?.code || "",
    glossarySourceLanguage: resolveLanguageLabel(
      glossaryState?.sourceLanguage ?? glossaryModel?.sourceLanguage,
      glossarySourceLanguageCode,
    ),
    targetLanguage: languageSemanticLabel(targetLanguage) || targetLanguage?.code || "",
    glossaryTerms,
    ...(selectedProjectsTeamInstallationId() === null
      ? {}
      : { installationId: selectedProjectsTeamInstallationId() }),
  });

  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  if (entries.length === 0) {
    return null;
  }
  return buildEditorDerivedGlossaryModel({
    sourceLanguage,
    targetLanguage,
    entries,
    glossaryId: glossaryState?.glossaryId ?? null,
    repoName: glossaryState?.repoName ?? "",
    title: glossaryState?.title ?? "",
  });
}

export async function confirmEditorAiTranslateAll(render, operations = {}) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  if (state.offline?.isEnabled === true) {
    applyEditorAiTranslateAllModal({
      isOpen: true,
      status: "idle",
      error: "AI actions are unavailable offline.",
    });
    showNoticeBadge("This operation is not supported in offline mode", render);
    render?.();
    return;
  }

  const selectedLanguageCodes = normalizeSelectedLanguageCodes(
    state.editorChapter,
    state.editorChapter.aiTranslateAllModal?.selectedLanguageCodes,
  );
  if (selectedLanguageCodes.length === 0) {
    applyEditorAiTranslateAllModal({
      isOpen: true,
      status: "idle",
      error: "Select at least one language before translating.",
      selectedLanguageCodes,
    });
    render?.();
    return;
  }

  const work = buildEditorAiTranslateAllWork(state.editorChapter, selectedLanguageCodes);
  if (work.length === 0) {
    applyEditorAiTranslateAllModal({
      isOpen: true,
      status: "idle",
      error: "There are no empty fields to translate for the selected languages.",
      selectedLanguageCodes,
    });
    render?.();
    return;
  }

  const languageProgress = buildEditorAiTranslateAllLanguageProgress(
    state.editorChapter,
    selectedLanguageCodes,
    work,
  );
  applyEditorAiTranslateAllModal({
    isOpen: true,
    status: "loading",
    error: "",
    selectedLanguageCodes,
    languageProgress,
    translatedCount: 0,
    totalCount: work.length,
  });
  render?.();

  const batchRunId = activeBatchRunId + 1;
  activeBatchRunId = batchRunId;
  let translatedCount = 0;
  let currentLanguageProgress = languageProgress;

  const isRunActive = () =>
    activeBatchRunId === batchRunId
    && state.editorChapter?.aiTranslateAllModal?.status === "loading";

  const recordTranslated = (item) => {
    translatedCount += 1;
    currentLanguageProgress = incrementEditorAiTranslateAllProgress(
      currentLanguageProgress,
      item.targetLanguageCode,
    );
    applyEditorAiTranslateAllModal({
      status: "loading",
      selectedLanguageCodes,
      languageProgress: currentLanguageProgress,
      translatedCount,
      totalCount: work.length,
    });
    render?.({ scope: "translate-ai-translate-all-modal" });
  };

  const failRun = (message) => {
    applyEditorAiTranslateAllModal({
      isOpen: true,
      status: "idle",
      error: message || "AI translation failed.",
      selectedLanguageCodes,
      languageProgress: currentLanguageProgress,
      translatedCount,
      totalCount: work.length,
    });
    render?.();
  };

  // Returns "abort" (run cancelled/changed) or "run-error" (modal error shown) —
  // both stop the whole run — otherwise "ok"/"skip"/"done" to continue.
  const translateSingleItem = async (item) => {
    if (!isRunActive()) {
      return "abort";
    }
    const row = findEditorRowById(item.rowId, state.editorChapter);
    if (
      !row
      || (
        !readRowFieldText(row, item.sourceLanguageCode).trim()
        && !readRowFootnoteText(row, item.sourceLanguageCode).trim()
        && !readRowImageCaptionText(row, item.sourceLanguageCode).trim()
      )
    ) {
      return "skip";
    }
    if (!rowHasTranslateAllWork(row, item.sourceLanguageCode, item.targetLanguageCode)) {
      recordTranslated(item);
      return "done";
    }

    const context = buildEditorAiTranslateContext(state.editorChapter, item);
    if (!context) {
      return "skip";
    }

    const translateForContext =
      typeof operations.runEditorAiTranslateForContext === "function"
        ? operations.runEditorAiTranslateForContext
        : runEditorAiTranslateForContext;
    const result = await translateForContext(
      render,
      BATCH_TRANSLATE_ACTION_ID,
      context,
      operations,
      { renderMode: "visible-rows", showNotice: false },
    );
    if (!isRunActive()) {
      return "abort";
    }
    if (result?.ok) {
      recordTranslated(item);
      return "ok";
    }
    if (result?.skipped) {
      return "skip";
    }
    failRun(result?.error);
    return "run-error";
  };

  const applyBatchRowResult = async (item, rowResult, provider, promptText) => {
    const context = buildEditorAiTranslateContext(state.editorChapter, item);
    if (!context || !latestEditorTranslateSourceTextMatches(context)) {
      return;
    }
    applyEditorAiTranslatePayloadToRow(context, rowResult, operations.updateEditorRowFieldValue);
    render?.({
      scope: "translate-visible-rows",
      rowIds: [item.rowId],
      reason: "ai-translate-all-batch",
    });
    await operations.persistEditorRowOnBlur?.(render, item.rowId, {
      commitMetadata: { operation: "ai-translation", aiModel: provider.modelId },
      waitForDurable: false,
    });
    if (state.editorChapter?.chapterId !== context.chapterId) {
      return;
    }
    operations.syncEditorGlossaryHighlightRowDom?.(item.rowId);
    logEditorAssistantTranslation({
      rowId: item.rowId,
      sourceLanguageCode: context.sourceLanguageCode,
      targetLanguageCode: context.targetLanguageCode,
      sourceLanguageLabel: context.sourceLanguageLabel,
      targetLanguageLabel: context.targetLanguageLabel,
      providerId: provider.providerId,
      modelId: provider.modelId,
      sourceText: context.sourceText,
      glossarySourceText: context.sourceText,
      glossaryHints: [],
      promptText,
      translatedText: translatedSectionValue(rowResult, "translatedText"),
      translatedFootnote: translatedSectionValue(rowResult, "translatedFootnote"),
      translatedImageCaption: translatedSectionValue(rowResult, "translatedImageCaption"),
      appliedText: translatedSectionValue(rowResult, "translatedText"),
      providerContinuation: null,
      summary: `${AI_ACTION_LABELS[BATCH_TRANSLATE_ACTION_ID]} applied to ${context.targetLanguageLabel}.`,
    });
    recordTranslated(item);
  };

  const translateBatch = async (batch, provider) => {
    const chapterState = state.editorChapter;
    const liveItems = [];
    for (const item of batch.items) {
      const row = findEditorRowById(item.rowId, chapterState);
      const hasSource =
        row
        && (
          readRowFieldText(row, item.sourceLanguageCode).trim()
          || readRowFootnoteText(row, item.sourceLanguageCode).trim()
          || readRowImageCaptionText(row, item.sourceLanguageCode).trim()
        );
      if (!hasSource) {
        continue;
      }
      if (!rowHasTranslateAllWork(row, item.sourceLanguageCode, item.targetLanguageCode)) {
        recordTranslated(item);
        continue;
      }
      liveItems.push(item);
    }
    if (liveItems.length === 0) {
      return "ok";
    }

    const runSingleRowFallback = async () => {
      for (const item of liveItems) {
        const outcome = await translateSingleItem(item);
        if (outcome === "abort" || outcome === "run-error") {
          return outcome;
        }
      }
      return "ok";
    };

    const sourceLanguageCode = liveItems[0].sourceLanguageCode;
    const targetLanguageCode = liveItems[0].targetLanguageCode;
    const languages = Array.isArray(chapterState?.languages) ? chapterState.languages : [];
    const sourceLanguage = languages.find((language) => language?.code === sourceLanguageCode) ?? null;
    const targetLanguage = languages.find((language) => language?.code === targetLanguageCode) ?? null;
    const sourceTexts = liveItems.map((item) =>
      readRowFieldText(findEditorRowById(item.rowId, chapterState), sourceLanguageCode),
    );

    let glossaryHints = [];
    if (batch.glossaryKind === "direct") {
      glossaryHints = buildBatchGlossaryHints(
        sourceTexts,
        languageBaseCode(sourceLanguage),
        languageBaseCode(targetLanguage),
        chapterState?.glossary?.matcherModel ?? null,
      );
    } else if (batch.glossaryKind === "derived") {
      const prepareBatch =
        typeof operations.prepareEditorAiTranslatedGlossaryBatch === "function"
          ? operations.prepareEditorAiTranslatedGlossaryBatch
          : (batchRequest) => invoke("prepare_editor_ai_translated_glossary_batch", { request: batchRequest });
      let derivedModel = null;
      try {
        derivedModel = await prepareBatchDerivedGlossaryModel({
          chapterState,
          sourceLanguage,
          targetLanguage,
          sourceTexts,
          providerId: provider.providerId,
          modelId: provider.modelId,
          prepareBatch,
        });
      } catch {
        // Batch derivation failed — fall back to the single-row path, which
        // derives each row's glossary on its own.
        if (!isRunActive()) {
          return "abort";
        }
        return runSingleRowFallback();
      }
      if (!isRunActive()) {
        return "abort";
      }
      glossaryHints = derivedModel
        ? buildBatchGlossaryHints(sourceTexts, sourceLanguageCode, targetLanguageCode, derivedModel)
        : [];
    }

    const request = buildTranslateBatchRequest(
      chapterState,
      liveItems,
      glossaryHints,
      provider.providerId,
      provider.modelId,
    );

    const runBatch =
      typeof operations.runAiTranslationBatch === "function"
        ? operations.runAiTranslationBatch
        : (batchRequest) => invoke("run_ai_translation_batch", { request: batchRequest });

    let payload;
    try {
      payload = await runBatch(request);
    } catch {
      if (!isRunActive()) {
        return "abort";
      }
      return runSingleRowFallback();
    }
    if (!isRunActive()) {
      return "abort";
    }

    const promptText = typeof payload?.promptText === "string" ? payload.promptText : "";
    const returnedById = new Map(
      (Array.isArray(payload?.rows) ? payload.rows : []).map((row) => [row.rowId, row]),
    );
    for (const item of liveItems) {
      if (!isRunActive()) {
        return "abort";
      }
      const rowResult = returnedById.get(item.rowId);
      if (!rowResult) {
        const outcome = await translateSingleItem(item);
        if (outcome === "abort" || outcome === "run-error") {
          return outcome;
        }
        continue;
      }
      await applyBatchRowResult(item, rowResult, provider, promptText);
    }
    return "ok";
  };

  const canApplyBatchLocally =
    typeof operations.updateEditorRowFieldValue === "function"
    && typeof operations.persistEditorRowOnBlur === "function";

  const batches = chunkTranslateAllWork(work, {
    glossaryKindForItem: (item) =>
      glossaryUsageKindForPair(
        state.editorChapter,
        item.sourceLanguageCode,
        item.targetLanguageCode,
      ),
    sourceTokensForItem: (item) =>
      estimateSourceTokens(
        readRowFieldText(
          findEditorRowById(item.rowId, state.editorChapter),
          item.sourceLanguageCode,
        ),
      ),
  });

  let provider = null;
  for (const batch of batches) {
    if (!isRunActive()) {
      return;
    }

    // Single-item or non-applyable batches use the proven single-row path (which
    // owns its own provider/key/glossary handling). Derived-glossary batches with
    // more than one row go through translateBatch, which derives the pivot
    // glossary once for the whole batch.
    if (batch.items.length === 1 || !canApplyBatchLocally) {
      for (const item of batch.items) {
        const outcome = await translateSingleItem(item);
        if (outcome === "abort" || outcome === "run-error") {
          return;
        }
      }
      continue;
    }

    if (!provider) {
      const ensureReady =
        typeof operations.ensureEditorAiTranslateProviderReady === "function"
          ? operations.ensureEditorAiTranslateProviderReady
          : ensureEditorAiTranslateProviderReady;
      const ready = await ensureReady(render, BATCH_TRANSLATE_ACTION_ID);
      if (!isRunActive()) {
        return;
      }
      if (!ready.ok) {
        if (ready.missingKey) {
          state.editorChapter = clearEditorAiTranslateAction(
            state.editorChapter,
            BATCH_TRANSLATE_ACTION_ID,
          );
          state.editorChapter = {
            ...state.editorChapter,
            aiTranslateAllModal: createEditorAiTranslateAllModalState(),
          };
          render?.();
          openAiMissingKeyModal(ready.providerId);
          return;
        }
        failRun(ready.error);
        return;
      }
      provider = { providerId: ready.providerId, modelId: ready.modelId };
    }

    const outcome = await translateBatch(batch, provider);
    if (outcome === "abort" || outcome === "run-error") {
      return;
    }
  }

  if (
    activeBatchRunId !== batchRunId
    || state.editorChapter?.aiTranslateAllModal?.status !== "loading"
  ) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    aiTranslateAllModal: createEditorAiTranslateAllModalState(),
  };
  render?.();
  const fieldLabel = translatedCount === 1 ? "field" : "fields";
  showNoticeBadge(`AI translated ${translatedCount} ${fieldLabel}.`, render);
}

export const editorAiTranslateAllTestApi = {
  buildEditorAiTranslateAllWork,
  buildEditorAiTranslateAllLanguageProgress,
  buildTranslateBatchRequest,
  getActiveBatchRunId: () => activeBatchRunId,
  glossaryUsageKindForPair,
  incrementEditorAiTranslateAllProgress,
  prioritizeGlossarySourceLanguageCode,
  resetActiveBatchRunId: () => {
    activeBatchRunId = 0;
  },
  normalizeSelectedLanguageCodes,
  visibleTargetLanguagesForChapter,
};
