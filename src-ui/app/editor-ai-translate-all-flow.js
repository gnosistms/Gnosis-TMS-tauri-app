import { AI_ACTION_LABELS, AI_TRANSLATE_ACTION_IDS } from "./ai-action-config.js";
import {
  applyEditorAiTranslatePayloadToRow,
  buildEditorAiTranslateContext,
  ensureEditorAiTranslateProviderReady,
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
  groupWorkByLanguagePair,
  mergeGlossaryHintLists,
} from "./editor-ai-batch-request.js";
import { buildBatchSourceContext } from "./editor-ai-context-window.js";
import { buildEditorAiTranslationGlossaryHints } from "./editor-glossary-highlighting.js";
import { ensureBatchDerivedGlossaries } from "./editor-derived-glossary-batch-flow.js";
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

// entries: [{ item, row, sourceText, sourceFootnote, sourceImageCaption }] —
// rows resolved once by the caller so the request build does no re-scans.
function buildTranslateBatchRequest(chapterState, entries, glossaryHints, providerId, modelId) {
  const sourceLanguageCode = entries[0].item.sourceLanguageCode;
  const targetLanguageCode = entries[0].item.targetLanguageCode;
  const languages = Array.isArray(chapterState?.languages) ? chapterState.languages : [];
  const sourceLanguage = languages.find((language) => language?.code === sourceLanguageCode) ?? null;
  const targetLanguage = languages.find((language) => language?.code === targetLanguageCode) ?? null;

  const rows = entries.map((entry) => ({
    rowId: entry.item.rowId,
    sourceText: entry.sourceText,
    sourceFootnote: entry.sourceFootnote,
    sourceImageCaption: entry.sourceImageCaption,
    targetFootnote: readRowFootnoteText(entry.row, targetLanguageCode),
    targetImageCaption: readRowImageCaptionText(entry.row, targetLanguageCode),
    alternateLanguageTexts: buildEditorAssistantAlternateLanguageTexts(
      entry.row,
      languages,
      sourceLanguageCode,
      targetLanguageCode,
    ),
  }));

  const { contextBefore, contextAfter } = buildBatchSourceContext(
    chapterState,
    entries[0].item.rowId,
    entries[entries.length - 1].item.rowId,
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

  // entry carries the row snapshot the batch request was built from. The guard
  // compares the CURRENT row against those sent values — a mid-flight edit or
  // background-sync merge makes the batch result stale for that row.
  const applyBatchRowResult = async (entry, rowResult, provider, promptText, batchHints) => {
    const { item } = entry;
    const currentRow = findEditorRowById(item.rowId, state.editorChapter);
    if (
      !currentRow
      || readRowFieldText(currentRow, item.sourceLanguageCode) !== entry.sourceText
      || readRowFootnoteText(currentRow, item.sourceLanguageCode) !== entry.sourceFootnote
      || readRowImageCaptionText(currentRow, item.sourceLanguageCode) !== entry.sourceImageCaption
    ) {
      // Source changed while the batch was in flight — the translation no longer
      // matches what the user sees. Leave the row untouched (same as the
      // single-row path's source-changed skip).
      return;
    }
    if (!rowHasTranslateAllWork(currentRow, item.sourceLanguageCode, item.targetLanguageCode)) {
      // Target got filled mid-flight (user typing or background sync). Do not
      // overwrite it; count the cell as done like the pre-batch check does.
      recordTranslated(item);
      return;
    }

    const context = buildEditorAiTranslateContext(state.editorChapter, {
      ...item,
      skipRowWindow: true,
    });
    if (!context) {
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
    if (!isRunActive() || state.editorChapter?.chapterId !== context.chapterId) {
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
      sourceText: entry.sourceText,
      glossarySourceText: entry.glossarySourceText || entry.sourceText,
      glossaryHints: entry.hints ?? batchHints ?? [],
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

  // Resolves the batch's derived glossary per row via the shared batch
  // derivation flow (fresh cached entries reused, the rest derived in combined
  // calls with entries stored back into chapter state so highlights and
  // staleness checks work like the single-row path). Mutates entries in place
  // with { hints, glossarySourceText }; unresolved rows (no pivot text yet,
  // derivation failure, mid-flight edits) are returned for the single-row
  // fallback. Returns { fallbackEntries } or "abort".
  const resolveBatchDerivedGlossary = async (chapterState, entries, provider) => {
    const entryByItem = new Map(entries.map((entry) => [entry.item, entry]));
    const { aborted, results } = await ensureBatchDerivedGlossaries({
      chapterState,
      items: entries.map((entry) => entry.item),
      providerId: provider.providerId,
      modelId: provider.modelId,
      isRunActive,
      operations,
    });
    if (aborted) {
      return "abort";
    }

    const fallbackEntries = [];
    for (const result of results) {
      const entry = entryByItem.get(result.item);
      if (!entry) {
        continue;
      }
      if (result.status === "none") {
        entry.hints = [];
        continue;
      }
      if (result.status === "cached" || result.status === "derived") {
        entry.hints = buildEditorAiTranslationGlossaryHints(
          entry.sourceText,
          entry.item.sourceLanguageCode,
          entry.item.targetLanguageCode,
          result.matcherModel ?? null,
        );
        entry.glossarySourceText = result.glossarySourceText ?? "";
        continue;
      }
      fallbackEntries.push(entry);
    }
    return { fallbackEntries };
  };

  const translateBatch = async (batch, provider, rowsById) => {
    const chapterState = state.editorChapter;
    let liveEntries = [];
    for (const item of batch.items) {
      const row = rowsById.get(item.rowId) ?? findEditorRowById(item.rowId, chapterState);
      const sourceText = readRowFieldText(row, item.sourceLanguageCode);
      const sourceFootnote = readRowFootnoteText(row, item.sourceLanguageCode);
      const sourceImageCaption = readRowImageCaptionText(row, item.sourceLanguageCode);
      if (!row || (!sourceText.trim() && !sourceFootnote.trim() && !sourceImageCaption.trim())) {
        continue;
      }
      if (!rowHasTranslateAllWork(row, item.sourceLanguageCode, item.targetLanguageCode)) {
        recordTranslated(item);
        continue;
      }
      liveEntries.push({ item, row, sourceText, sourceFootnote, sourceImageCaption });
    }
    if (liveEntries.length === 0) {
      return "ok";
    }

    const runSingleRowFallback = async (entries) => {
      for (const entry of entries) {
        const outcome = await translateSingleItem(entry.item);
        if (outcome === "abort" || outcome === "run-error") {
          return outcome;
        }
      }
      return "ok";
    };

    const sourceLanguageCode = liveEntries[0].item.sourceLanguageCode;
    const targetLanguageCode = liveEntries[0].item.targetLanguageCode;
    const languages = Array.isArray(chapterState?.languages) ? chapterState.languages : [];
    const sourceLanguage = languages.find((language) => language?.code === sourceLanguageCode) ?? null;
    const targetLanguage = languages.find((language) => language?.code === targetLanguageCode) ?? null;

    let batchHints = [];
    if (batch.glossaryKind === "direct") {
      batchHints = buildBatchGlossaryHints(
        liveEntries.map((entry) => entry.sourceText),
        languageBaseCode(sourceLanguage),
        languageBaseCode(targetLanguage),
        chapterState?.glossary?.matcherModel ?? null,
      );
    } else if (batch.glossaryKind === "derived") {
      const derived = await resolveBatchDerivedGlossary(chapterState, liveEntries, provider);
      if (derived === "abort") {
        return "abort";
      }
      if (derived.fallbackEntries.length > 0) {
        const fallbackSet = new Set(derived.fallbackEntries);
        liveEntries = liveEntries.filter((entry) => !fallbackSet.has(entry));
        const outcome = await runSingleRowFallback(derived.fallbackEntries);
        if (outcome !== "ok") {
          return outcome;
        }
        if (!isRunActive()) {
          return "abort";
        }
      }
      if (liveEntries.length === 0) {
        return "ok";
      }
      batchHints = mergeGlossaryHintLists(
        liveEntries.map((entry) => entry.hints ?? []),
        sourceLanguageCode,
      );
    }

    const request = buildTranslateBatchRequest(
      chapterState,
      liveEntries,
      batchHints,
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
      return runSingleRowFallback(liveEntries);
    }
    if (!isRunActive()) {
      return "abort";
    }

    const promptText = typeof payload?.promptText === "string" ? payload.promptText : "";
    const returnedById = new Map(
      (Array.isArray(payload?.rows) ? payload.rows : []).map((row) => [row.rowId, row]),
    );
    for (const entry of liveEntries) {
      if (!isRunActive()) {
        return "abort";
      }
      const rowResult = returnedById.get(entry.item.rowId);
      if (!rowResult) {
        const outcome = await translateSingleItem(entry.item);
        if (outcome === "abort" || outcome === "run-error") {
          return outcome;
        }
        continue;
      }
      await applyBatchRowResult(entry, rowResult, provider, promptText, batchHints);
    }
    return "ok";
  };

  const canApplyBatchLocally =
    typeof operations.updateEditorRowFieldValue === "function"
    && typeof operations.persistEditorRowOnBlur === "function";

  // Row lookup map: the chunker and batch assembly would otherwise do an
  // O(chapter rows) findEditorRowById scan per work item.
  const rowsById = new Map(
    (Array.isArray(state.editorChapter?.rows) ? state.editorChapter.rows : [])
      .map((row) => [row.rowId, row]),
  );
  // The work list is row-major (rows outer, target languages inner), so with
  // 2+ selected languages consecutive items alternate pairs and would only ever
  // form singleton batches. Group into contiguous language-pair runs first.
  const orderedWork = groupWorkByLanguagePair(work);
  const kindByPair = new Map();
  const batches = chunkTranslateAllWork(orderedWork, {
    glossaryKindForItem: (item) => {
      const key = `${item.sourceLanguageCode}::${item.targetLanguageCode}`;
      if (!kindByPair.has(key)) {
        kindByPair.set(
          key,
          glossaryUsageKindForPair(
            state.editorChapter,
            item.sourceLanguageCode,
            item.targetLanguageCode,
          ),
        );
      }
      return kindByPair.get(key);
    },
    sourceTokensForItem: (item) =>
      estimateSourceTokens(readRowFieldText(rowsById.get(item.rowId), item.sourceLanguageCode)),
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

    const outcome = await translateBatch(batch, provider, rowsById);
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
