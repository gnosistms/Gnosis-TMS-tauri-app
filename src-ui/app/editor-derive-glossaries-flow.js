import { AI_TRANSLATE_ACTION_IDS } from "./ai-action-config.js";
import {
  applyStoredSelectedTeamAiActionPreferences,
  ensureSharedAiActionConfigurationLoaded,
  openAiMissingKeyModal,
  resolveAiActionProviderAndModel,
} from "./ai-settings-flow.js";
import { ensureSelectedTeamAiProviderReady } from "./team-ai-flow.js";
import {
  prepareEditorDerivedGlossaryForContext,
  readRowFieldText,
  resolveEditorDerivedGlossaryUsage,
  resolveLanguageCode,
  resolveLanguageLabel,
} from "./editor-derived-glossary-flow.js";
import { findEditorRowById } from "./editor-utils.js";
import { selectedProjectsTeam } from "./project-context.js";
import {
  createEditorDeriveGlossariesModalState,
  state,
} from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";

const DERIVE_GLOSSARIES_ACTION_ID = AI_TRANSLATE_ACTION_IDS[0] ?? "translate1";

let activeDeriveGlossariesRunId = 0;

function createDeriveGlossaryRequestKey(chapterId, rowId, sourceLanguageCode, targetLanguageCode) {
  const uniqueSuffix =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${chapterId}:${rowId}:${sourceLanguageCode}:${targetLanguageCode}:derive-glossary:${uniqueSuffix}`;
}

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

function languageByCode(chapterState, languageCode) {
  const code = String(languageCode ?? "").trim();
  if (!code) {
    return null;
  }
  const language = (Array.isArray(chapterState?.languages) ? chapterState.languages : [])
    .find((candidate) => candidate?.code === code);
  if (language) {
    return language;
  }
  return { code, name: code };
}

export function resolveEditorDeriveGlossariesConfig(chapterState) {
  const languages = Array.isArray(chapterState?.languages) ? chapterState.languages : [];
  const languageCodes = new Set(
    languages
      .map((language) => String(language?.code ?? "").trim())
      .filter(Boolean),
  );
  const glossaryState = chapterState?.glossary ?? null;
  const glossaryModel = glossaryState?.matcherModel ?? null;
  const glossarySourceLanguageCode = resolveLanguageCode(
    glossaryState?.sourceLanguage ?? glossaryModel?.sourceLanguage,
  );
  const glossaryTargetLanguageCode = resolveLanguageCode(
    glossaryState?.targetLanguage ?? glossaryModel?.targetLanguage,
  );
  const glossarySourceLanguage = languageByCode(chapterState, glossarySourceLanguageCode);
  const glossaryTargetLanguage = languageByCode(chapterState, glossaryTargetLanguageCode);
  const derivableLanguages = languages.filter((language) => {
    const code = String(language?.code ?? "").trim();
    return (
      code
      && code !== glossarySourceLanguageCode
      && code !== glossaryTargetLanguageCode
    );
  });

  return {
    canDerive:
      Boolean(chapterState?.chapterId)
      && languages.length >= 3
      && Boolean(glossaryState?.matcherModel)
      && languageCodes.has(glossarySourceLanguageCode)
      && languageCodes.has(glossaryTargetLanguageCode)
      && derivableLanguages.length > 0,
    editorSourceLanguageCode: sourceLanguageCodeForChapter(chapterState),
    editorSourceLanguage: languageByCode(chapterState, sourceLanguageCodeForChapter(chapterState)),
    glossarySourceLanguageCode,
    glossarySourceLanguage,
    glossaryTargetLanguageCode,
    glossaryTargetLanguage,
    derivableLanguages,
  };
}

function buildEditorDeriveGlossariesWork(chapterState, derivableLanguages) {
  const config = resolveEditorDeriveGlossariesConfig(chapterState);
  if (!config.canDerive || !chapterState?.chapterId) {
    return [];
  }

  const work = [];
  for (const row of Array.isArray(chapterState.rows) ? chapterState.rows : []) {
    if (!row?.rowId || row.lifecycleState === "deleted") {
      continue;
    }
    const editorSourceText = readRowFieldText(row, config.editorSourceLanguageCode);
    const glossaryTargetText = readRowFieldText(row, config.glossaryTargetLanguageCode);
    if (!editorSourceText.trim() || !glossaryTargetText.trim()) {
      continue;
    }

    for (const language of Array.isArray(derivableLanguages) ? derivableLanguages : []) {
      const sourceLanguageCode = String(language?.code ?? "").trim();
      if (!sourceLanguageCode || !readRowFieldText(row, sourceLanguageCode).trim()) {
        continue;
      }
      const item = {
        rowId: row.rowId,
        sourceLanguageCode,
        targetLanguageCode: config.glossaryTargetLanguageCode,
      };
      if (editorDeriveGlossaryWorkItemHasFreshCache(chapterState, item)) {
        continue;
      }
      work.push(item);
    }
  }

  return work;
}

function editorDeriveGlossaryWorkItemHasFreshCache(chapterState, item) {
  const context = buildDeriveContext(chapterState, item);
  if (!context) {
    return false;
  }

  const glossaryUsage = resolveEditorDerivedGlossaryUsage(context, {
    useCurrentGlossarySourceText: true,
  });
  return (
    glossaryUsage.kind === "derived"
    && glossaryUsage.cachedDerivedEntry
    && glossaryUsage.cachedDerivedEntryIsStale === false
  );
}

function buildEditorDeriveGlossariesLanguageProgress(derivableLanguages, work) {
  const workItems = Array.isArray(work) ? work : [];
  return Object.fromEntries(
    (Array.isArray(derivableLanguages) ? derivableLanguages : []).map((language) => {
      const languageCode = String(language?.code ?? "").trim();
      return [
        languageCode,
        {
          completedCount: 0,
          totalCount: workItems.filter((item) => item?.sourceLanguageCode === languageCode).length,
        },
      ];
    }),
  );
}

function incrementEditorDeriveGlossariesProgress(languageProgress, languageCode) {
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

function applyEditorDeriveGlossariesModal(updates) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    deriveGlossariesModal: {
      ...createEditorDeriveGlossariesModalState(),
      ...state.editorChapter.deriveGlossariesModal,
      ...updates,
    },
  };
}

export function openEditorDeriveGlossariesModal(render) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  if (state.offline?.isEnabled === true) {
    showNoticeBadge("This operation is not supported in offline mode", render);
    return;
  }

  const config = resolveEditorDeriveGlossariesConfig(state.editorChapter);
  if (!config.canDerive) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    deriveGlossariesModal: {
      ...createEditorDeriveGlossariesModalState(),
      isOpen: true,
      selectedLanguageCodes: config.derivableLanguages.map((language) => language.code),
    },
  };
  render?.();
}

export function cancelEditorDeriveGlossariesModal(render) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  const modal = state.editorChapter.deriveGlossariesModal;
  if (modal?.status === "loading") {
    activeDeriveGlossariesRunId += 1;
    state.editorChapter = {
      ...state.editorChapter,
      deriveGlossariesModal: createEditorDeriveGlossariesModalState(),
    };
    render?.();
    showNoticeBadge("Glossary derivation stopped.", render);
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    deriveGlossariesModal: createEditorDeriveGlossariesModalState(),
  };
  render?.();
}

function buildDeriveContext(chapterState, item) {
  const row = findEditorRowById(item.rowId, chapterState);
  if (!row) {
    return null;
  }
  const sourceLanguage = languageByCode(chapterState, item.sourceLanguageCode);
  const targetLanguage = languageByCode(chapterState, item.targetLanguageCode);
  if (!sourceLanguage || !targetLanguage) {
    return null;
  }
  return {
    chapterState,
    projectId: chapterState.projectId,
    row,
    chapterId: chapterState.chapterId,
    rowId: item.rowId,
    sourceLanguageCode: item.sourceLanguageCode,
    targetLanguageCode: item.targetLanguageCode,
    sourceLanguage,
    targetLanguage,
    sourceLanguageLabel: resolveLanguageLabel(sourceLanguage, item.sourceLanguageCode),
    targetLanguageLabel: resolveLanguageLabel(targetLanguage, item.targetLanguageCode),
    sourceText: readRowFieldText(row, item.sourceLanguageCode),
  };
}

function createConfigRender(render) {
  return (options = null) => {
    if (!render) {
      return;
    }
    render(options?.scope ? options : { scope: "translate-sidebar" });
  };
}

export async function confirmEditorDeriveGlossaries(render, operations = {}) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  if (state.offline?.isEnabled === true) {
    applyEditorDeriveGlossariesModal({
      isOpen: true,
      status: "idle",
      error: "AI actions are unavailable offline.",
    });
    showNoticeBadge("This operation is not supported in offline mode", render);
    render?.();
    return;
  }

  const config = resolveEditorDeriveGlossariesConfig(state.editorChapter);
  if (!config.canDerive) {
    return;
  }

  const work = buildEditorDeriveGlossariesWork(
    state.editorChapter,
    config.derivableLanguages,
  );
  if (work.length === 0) {
    applyEditorDeriveGlossariesModal({
      isOpen: true,
      status: "idle",
      error: "There are no eligible rows for glossary derivation.",
      selectedLanguageCodes: config.derivableLanguages.map((language) => language.code),
    });
    render?.();
    return;
  }

  const languageProgress = buildEditorDeriveGlossariesLanguageProgress(
    config.derivableLanguages,
    work,
  );
  applyEditorDeriveGlossariesModal({
    isOpen: true,
    status: "loading",
    error: "",
    selectedLanguageCodes: config.derivableLanguages.map((language) => language.code),
    languageProgress,
    completedCount: 0,
    totalCount: work.length,
  });
  render?.();

  const configRender = createConfigRender(render);
  const usedStoredTeamActionPreferences = applyStoredSelectedTeamAiActionPreferences(configRender);
  try {
    await ensureSharedAiActionConfigurationLoaded(configRender);
  } catch (error) {
    if (selectedProjectsTeam()?.canDelete !== true && !usedStoredTeamActionPreferences) {
      applyEditorDeriveGlossariesModal({
        status: "idle",
        error: error instanceof Error ? error.message : String(error),
      });
      render?.();
      return;
    }
  }

  const { providerId, modelId } = resolveAiActionProviderAndModel(DERIVE_GLOSSARIES_ACTION_ID);
  if (!modelId) {
    applyEditorDeriveGlossariesModal({
      status: "idle",
      error: "Select a model for Translate on the AI Settings page first.",
    });
    render?.();
    return;
  }

  try {
    const ensureKeyResult = await ensureSelectedTeamAiProviderReady(configRender, providerId);
    if (!ensureKeyResult?.ok) {
      openAiMissingKeyModal(providerId);
      render?.();
      return;
    }
  } catch (error) {
    applyEditorDeriveGlossariesModal({
      status: "idle",
      error: error instanceof Error ? error.message : String(error),
    });
    render?.();
    return;
  }

  const batchRunId = activeDeriveGlossariesRunId + 1;
  activeDeriveGlossariesRunId = batchRunId;
  let completedCount = 0;
  let derivedCount = 0;
  let currentLanguageProgress = languageProgress;

  for (const item of work) {
    if (
      activeDeriveGlossariesRunId !== batchRunId
      || state.editorChapter?.deriveGlossariesModal?.status !== "loading"
    ) {
      return;
    }

    const row = findEditorRowById(item.rowId, state.editorChapter);
    if (
      !row
      || !readRowFieldText(row, config.editorSourceLanguageCode).trim()
      || !readRowFieldText(row, config.glossaryTargetLanguageCode).trim()
      || !readRowFieldText(row, item.sourceLanguageCode).trim()
    ) {
      completedCount += 1;
      currentLanguageProgress = incrementEditorDeriveGlossariesProgress(
        currentLanguageProgress,
        item.sourceLanguageCode,
      );
      applyEditorDeriveGlossariesModal({
        status: "loading",
        languageProgress: currentLanguageProgress,
        completedCount,
        totalCount: work.length,
      });
      render?.({ scope: "translate-derive-glossaries-modal" });
      continue;
    }

    const context = buildDeriveContext(state.editorChapter, item);
    if (!context) {
      continue;
    }
    const glossaryUsage = resolveEditorDerivedGlossaryUsage(context, {
      useCurrentGlossarySourceText: true,
    });
    if (glossaryUsage.kind !== "derived") {
      completedCount += 1;
      currentLanguageProgress = incrementEditorDeriveGlossariesProgress(
        currentLanguageProgress,
        item.sourceLanguageCode,
      );
      continue;
    }
    if (
      glossaryUsage.cachedDerivedEntry
      && glossaryUsage.cachedDerivedEntryIsStale === false
    ) {
      completedCount += 1;
      currentLanguageProgress = incrementEditorDeriveGlossariesProgress(
        currentLanguageProgress,
        item.sourceLanguageCode,
      );
      applyEditorDeriveGlossariesModal({
        status: "loading",
        languageProgress: currentLanguageProgress,
        completedCount,
        totalCount: work.length,
      });
      render?.({ scope: "translate-derive-glossaries-modal" });
      continue;
    }

    const requestKey = createDeriveGlossaryRequestKey(
      context.chapterId,
      context.rowId,
      context.sourceLanguageCode,
      context.targetLanguageCode,
    );
    const prepareForContext =
      typeof operations.prepareEditorDerivedGlossaryForContext === "function"
        ? operations.prepareEditorDerivedGlossaryForContext
        : prepareEditorDerivedGlossaryForContext;

    try {
      const result = await prepareForContext({
        render,
        context,
        glossaryUsage,
        providerId,
        modelId,
        requestKey,
        retainedDerivedEntry: glossaryUsage.cachedDerivedEntry ?? null,
        updateEditorRowFieldValue: operations.updateEditorRowFieldValue,
        persistEditorRowOnBlur: operations.persistEditorRowOnBlur,
        persistGlossarySourceImmediately: true,
        generateMissingGlossarySourceTextWhenMissing: true,
        generationSourceText: readRowFieldText(row, config.editorSourceLanguageCode),
        generationSourceLanguageLabel: resolveLanguageLabel(
          config.editorSourceLanguage,
          config.editorSourceLanguageCode,
        ),
        renderOptions: {
          renderMode: "visible-rows",
        },
        renderDerivedGlossaryState(reason) {
          render?.({
            scope: "translate-visible-rows",
            rowIds: [context.rowId],
            reason: `derive-glossaries-${reason}`,
          });
        },
        requestStillCurrent: () =>
          activeDeriveGlossariesRunId === batchRunId
          && state.editorChapter?.deriveGlossariesModal?.status === "loading",
        sourceStillCurrent: () => {
          const latestRow = findEditorRowById(context.rowId, state.editorChapter);
          return readRowFieldText(latestRow, context.sourceLanguageCode) === context.sourceText;
        },
        operations,
      });
      if (result?.skipped) {
        return;
      }
      if (result?.ok) {
        derivedCount += 1;
      }
    } catch (error) {
      applyEditorDeriveGlossariesModal({
        isOpen: true,
        status: "idle",
        error: error instanceof Error ? error.message : String(error),
        languageProgress: currentLanguageProgress,
        completedCount,
        totalCount: work.length,
      });
      render?.();
      return;
    }

    completedCount += 1;
    currentLanguageProgress = incrementEditorDeriveGlossariesProgress(
      currentLanguageProgress,
      item.sourceLanguageCode,
    );
    applyEditorDeriveGlossariesModal({
      status: "loading",
      languageProgress: currentLanguageProgress,
      completedCount,
      totalCount: work.length,
    });
    render?.({ scope: "translate-derive-glossaries-modal" });
  }

  if (
    activeDeriveGlossariesRunId !== batchRunId
    || state.editorChapter?.deriveGlossariesModal?.status !== "loading"
  ) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    deriveGlossariesModal: createEditorDeriveGlossariesModalState(),
  };
  render?.();
  const pairLabel = derivedCount === 1 ? "glossary" : "glossaries";
  showNoticeBadge(`Derived ${derivedCount} ${pairLabel}.`, render);
}

export const editorDeriveGlossariesTestApi = {
  buildEditorDeriveGlossariesLanguageProgress,
  buildEditorDeriveGlossariesWork,
  editorDeriveGlossaryWorkItemHasFreshCache,
  getActiveDeriveGlossariesRunId: () => activeDeriveGlossariesRunId,
  incrementEditorDeriveGlossariesProgress,
  resetActiveDeriveGlossariesRunId: () => {
    activeDeriveGlossariesRunId = 0;
  },
  resolveEditorDeriveGlossariesConfig,
};
