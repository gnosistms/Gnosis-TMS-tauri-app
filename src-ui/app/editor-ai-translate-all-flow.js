import { AI_TRANSLATE_ACTION_IDS } from "./ai-action-config.js";
import {
  buildEditorAiTranslateContext,
  runEditorAiTranslateForContext,
} from "./editor-ai-translate-flow.js";
import { clearEditorAiTranslateAction } from "./editor-ai-translate-state.js";
import { findEditorRowById } from "./editor-utils.js";
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
  const collapsedLanguageCodes =
    chapterState?.collapsedLanguageCodes instanceof Set
      ? chapterState.collapsedLanguageCodes
      : new Set();

  return (Array.isArray(chapterState?.languages) ? chapterState.languages : [])
    .filter((language) => {
      const code = String(language?.code ?? "").trim();
      return code && code !== sourceLanguageCode && !collapsedLanguageCodes.has(code);
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

function readRowFieldText(row, languageCode) {
  if (!languageCode) {
    return "";
  }

  return typeof row?.fields?.[languageCode] === "string"
    ? row.fields[languageCode]
    : String(row?.fields?.[languageCode] ?? "");
}

function buildEditorAiTranslateAllWork(chapterState, selectedLanguageCodes) {
  const sourceLanguageCode = sourceLanguageCodeForChapter(chapterState);
  const targetLanguageCodes = normalizeSelectedLanguageCodes(chapterState, selectedLanguageCodes);
  if (!chapterState?.chapterId || !sourceLanguageCode || targetLanguageCodes.length === 0) {
    return [];
  }

  const work = [];
  for (const row of Array.isArray(chapterState.rows) ? chapterState.rows : []) {
    if (!row?.rowId || row.lifecycleState === "deleted") {
      continue;
    }
    const sourceText = readRowFieldText(row, sourceLanguageCode);
    if (!sourceText.trim()) {
      continue;
    }

    for (const targetLanguageCode of targetLanguageCodes) {
      if (
        targetLanguageCode === sourceLanguageCode
        || readRowFieldText(row, targetLanguageCode).trim()
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

export async function confirmEditorAiTranslateAll(render, operations = {}) {
  if (!state.editorChapter?.chapterId) {
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
  for (const item of work) {
    if (
      activeBatchRunId !== batchRunId
      || state.editorChapter?.aiTranslateAllModal?.status !== "loading"
    ) {
      return;
    }

    const row = findEditorRowById(item.rowId, state.editorChapter);
    if (
      !row
      || !readRowFieldText(row, item.sourceLanguageCode).trim()
    ) {
      continue;
    }
    if (readRowFieldText(row, item.targetLanguageCode).trim()) {
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
      continue;
    }

    const context = buildEditorAiTranslateContext(state.editorChapter, item);
    if (!context) {
      continue;
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
      {
        renderMode: "visible-rows",
        showNotice: false,
      },
    );
    if (
      activeBatchRunId !== batchRunId
      || state.editorChapter?.aiTranslateAllModal?.status !== "loading"
    ) {
      return;
    }
    if (result?.ok) {
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
      continue;
    }
    if (result?.skipped) {
      continue;
    }

    applyEditorAiTranslateAllModal({
      isOpen: true,
      status: "idle",
      error: result?.error || "AI translation failed.",
      selectedLanguageCodes,
      languageProgress: currentLanguageProgress,
      translatedCount,
      totalCount: work.length,
    });
    render?.();
    return;
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
  getActiveBatchRunId: () => activeBatchRunId,
  incrementEditorAiTranslateAllProgress,
  resetActiveBatchRunId: () => {
    activeBatchRunId = 0;
  },
  normalizeSelectedLanguageCodes,
  visibleTargetLanguagesForChapter,
};
