import {
  deletedRowGroupIdAfterSoftDelete,
  expandedDeletedRowGroupIdsAfterRestore,
  expandedDeletedRowGroupIdsAfterSoftDelete,
} from "./editor-deleted-rows.js";
import { normalizeStoredAiActionPreferences } from "./ai-action-config.js";
import { buildEditorGlossaryModel } from "./editor-glossary-highlighting.js";
import {
  createEditorChapterGlossaryState,
  createEditorChapterState,
  createEditorHistoryState,
} from "./state.js";

const FIXTURE_MODE = "editor-regression";
const DEFAULT_LANGUAGES = [
  { code: "es", name: "Spanish", role: "source" },
  { code: "vi", name: "Vietnamese", role: "target" },
];
const DEFAULT_GLOSSARY_TERMS = [
  {
    termId: "fixture-term-alpha",
    lifecycleState: "active",
    sourceTerms: ["alpha"],
    targetTerms: ["alpha"],
    notesToTranslators: "",
    footnote: "",
  },
];

function normalizePositiveInteger(value, fallback) {
  const nextValue = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(nextValue) && nextValue > 0 ? nextValue : fallback;
}

function padFixtureIndex(index) {
  return String(index).padStart(4, "0");
}

function normalizeFixtureTermList(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function normalizeFixtureGlossaryTerm(term, index) {
  if (typeof term === "string" && term.trim()) {
    return {
      termId: `fixture-term-${padFixtureIndex(index + 1)}`,
      lifecycleState: "active",
      sourceTerms: [term.trim()],
      targetTerms: [term.trim()],
      notesToTranslators: "",
      footnote: "",
    };
  }

  if (!term || typeof term !== "object") {
    return null;
  }

  const sourceTerms = normalizeFixtureTermList(
    Array.isArray(term.sourceTerms)
      ? term.sourceTerms
      : (typeof term.sourceTerm === "string" ? [term.sourceTerm] : []),
  );
  const targetTerms = normalizeFixtureTermList(
    Array.isArray(term.targetTerms)
      ? term.targetTerms
      : (typeof term.targetTerm === "string" ? [term.targetTerm] : sourceTerms),
  );
  if (sourceTerms.length === 0 && targetTerms.length === 0) {
    return null;
  }

  const termId =
    typeof term.termId === "string" && term.termId.trim()
      ? term.termId.trim()
      : `fixture-term-${padFixtureIndex(index + 1)}`;

  return {
    termId,
    lifecycleState: term.lifecycleState === "deleted" ? "deleted" : "active",
    sourceTerms,
    targetTerms,
    notesToTranslators:
      typeof term.notesToTranslators === "string" ? term.notesToTranslators : "",
    footnote: typeof term.footnote === "string" ? term.footnote : "",
  };
}

function buildFixtureGlossary(languages, options = {}) {
  const glossaryTerms =
    options?.glossary === true
      ? DEFAULT_GLOSSARY_TERMS
      : (Array.isArray(options?.glossaryTerms) ? options.glossaryTerms : []);
  const normalizedTerms = glossaryTerms
    .map((term, index) => normalizeFixtureGlossaryTerm(term, index))
    .filter(Boolean);
  if (normalizedTerms.length === 0) {
    return {
      linkedGlossary: null,
      glossaryState: createEditorChapterGlossaryState(),
      glossaryList: [],
    };
  }

  const sourceLanguage = languages.find((language) => language.role === "source") ?? languages[0] ?? null;
  const targetLanguage =
    languages.find((language) => language.role === "target" && language.code !== sourceLanguage?.code)
    ?? languages.find((language) => language.code !== sourceLanguage?.code)
    ?? sourceLanguage;
  const linkedGlossary = {
    glossaryId: "fixture-glossary",
    repoName: "fixture/fixture-glossary",
  };
  const glossaryState = {
    ...createEditorChapterGlossaryState(),
    status: "ready",
    glossaryId: linkedGlossary.glossaryId,
    repoName: linkedGlossary.repoName,
    title: "Fixture Glossary",
    sourceLanguage: sourceLanguage
      ? {
          code: sourceLanguage.code,
          name: sourceLanguage.name,
        }
      : null,
    targetLanguage: targetLanguage
      ? {
          code: targetLanguage.code,
          name: targetLanguage.name,
        }
      : null,
    terms: normalizedTerms,
  };
  glossaryState.matcherModel = buildEditorGlossaryModel(glossaryState);

  return {
    linkedGlossary,
    glossaryState,
    glossaryList: [
      {
        id: linkedGlossary.glossaryId,
        glossaryId: linkedGlossary.glossaryId,
        repoName: linkedGlossary.repoName,
        title: glossaryState.title,
        lifecycleState: "active",
        sourceLanguage: glossaryState.sourceLanguage,
        targetLanguage: glossaryState.targetLanguage,
      },
    ],
  };
}

function createFixtureRow(index, languages, options = {}) {
  const label = padFixtureIndex(index);
  const rowId = `fixture-row-${label}`;
  const storedCommentConfig =
    options?.commentsByRowId && typeof options.commentsByRowId === "object"
      ? options.commentsByRowId[rowId] ?? null
      : null;
  const editorComments = Array.isArray(storedCommentConfig?.comments)
    ? structuredClone(storedCommentConfig.comments)
    : [];
  const commentsRevision = Number.isInteger(storedCommentConfig?.commentsRevision)
    ? storedCommentConfig.commentsRevision
    : editorComments.length;
  const fields = {};
  const fieldStates = {};

  for (const language of languages) {
    if (language.code === "es") {
      fields[language.code] = `alpha ${label} source text`;
    } else if (language.code === "vi") {
      fields[language.code] = `alpha ${label} target text`;
    } else {
      fields[language.code] = `alpha ${label} ${language.code} text`;
    }

    fieldStates[language.code] = {
      reviewed: false,
      pleaseCheck: false,
    };
  }

  return {
    rowId,
    orderKey: label,
    lifecycleState: "active",
    commentCount: editorComments.length,
    commentsRevision,
    editorComments,
    textStyle: "paragraph",
    baseTextStyle: "paragraph",
    persistedTextStyle: "paragraph",
    fields,
    persistedFields: { ...fields },
    fieldStates,
    persistedFieldStates: structuredClone(fieldStates),
    saveStatus: "idle",
    saveError: "",
    markerSaveState: {
      status: "idle",
      languageCode: null,
      kind: null,
      error: "",
    },
  };
}

function rowsWithFixtureLifecycleState(rows, rowId, lifecycleState) {
  return (Array.isArray(rows) ? rows : []).map((row) =>
    row?.rowId === rowId
      ? {
          ...row,
          lifecycleState,
        }
      : row
  );
}

function nextFixtureRowIndex(rows) {
  const items = Array.isArray(rows) ? rows : [];
  let maxIndex = 0;

  for (const row of items) {
    const match = /^fixture-row-(\d+)$/.exec(String(row?.rowId ?? ""));
    if (!match) {
      continue;
    }

    const nextIndex = Number.parseInt(match[1], 10);
    if (Number.isInteger(nextIndex) && nextIndex > maxIndex) {
      maxIndex = nextIndex;
    }
  }

  return maxIndex + 1;
}

export function isEditorRegressionFixtureState(appState) {
  return appState?.editorChapter?.fixtureMode === FIXTURE_MODE;
}

export function createEditorRegressionInsertedRow(chapterState) {
  if (!chapterState?.chapterId) {
    return null;
  }

  const languages = Array.isArray(chapterState.languages) && chapterState.languages.length > 0
    ? chapterState.languages
    : DEFAULT_LANGUAGES;
  return createFixtureRow(nextFixtureRowIndex(chapterState.rows), languages);
}

function notifyMockTauriFixture(payload) {
  const mockTauri = globalThis?.__gnosisMockTauri;
  if (!mockTauri || typeof mockTauri.mountEditorFixture !== "function") {
    return;
  }

  try {
    mockTauri.mountEditorFixture(
      typeof structuredClone === "function"
        ? structuredClone(payload)
        : JSON.parse(JSON.stringify(payload)),
    );
  } catch {
    // Ignore test-harness sync failures in the normal app runtime.
  }
}

export function applyEditorRegressionFixture(appState, options = {}) {
  const rowCount = normalizePositiveInteger(options?.rowCount, 120);
  const languages = Array.isArray(options?.languages) && options.languages.length > 0
    ? options.languages
    : DEFAULT_LANGUAGES;
  const sourceCode = languages.find((language) => language.role === "source")?.code ?? languages[0]?.code ?? "es";
  const targetCode =
    languages.find((language) => language.role === "target" && language.code !== sourceCode)?.code
    ?? languages.find((language) => language.code !== sourceCode)?.code
    ?? sourceCode;
  const chapterId = "fixture-chapter";
  const projectId = "fixture-project";
  const teamId = "fixture-team";
  const fileTitle = typeof options?.fileTitle === "string" && options.fileTitle.trim()
    ? options.fileTitle.trim()
    : "Editor Regression Fixture";
  const rows = Array.from({ length: rowCount }, (_, index) => createFixtureRow(index + 1, languages, options));
  const fixtureGlossary = buildFixtureGlossary(languages, options);
  const chapter = {
    id: chapterId,
    name: fileTitle,
    status: "active",
    languages,
    sourceWordCounts: { [sourceCode]: rowCount * 3 },
    sourceWordCount: rowCount * 3,
    selectedSourceLanguageCode: sourceCode,
    selectedTargetLanguageCode: targetCode,
    linkedGlossary: fixtureGlossary.linkedGlossary,
  };
  const project = {
    id: projectId,
    name: "fixture-project",
    fullName: "fixture/fixture-project",
    status: "active",
    chapters: [chapter],
  };
  const team = {
    id: teamId,
    name: "Fixture Team",
    installationId: 1,
    canManageProjects: true,
    canDelete: true,
    accountType: "organization",
  };
  const editorChapter = {
    ...createEditorChapterState(),
    fixtureMode: FIXTURE_MODE,
    status: "idle",
    error: "",
    projectId,
    chapterId,
    fileTitle,
    languages,
    sourceWordCounts: { [sourceCode]: rowCount * 3 },
    selectedSourceLanguageCode: sourceCode,
    selectedTargetLanguageCode: targetCode,
    persistedSourceLanguageCode: sourceCode,
    persistedTargetLanguageCode: targetCode,
    collapsedLanguageCodes: new Set(
      Array.isArray(options?.collapsedLanguageCodes) ? options.collapsedLanguageCodes.filter(Boolean) : [],
    ),
    filters: {
      searchQuery: typeof options?.searchQuery === "string" ? options.searchQuery : "",
      caseSensitive: options?.caseSensitive === true,
      rowFilterMode: typeof options?.rowFilterMode === "string" ? options.rowFilterMode : "show-all",
    },
    replace: {
      enabled: options?.replaceEnabled === true,
      replaceQuery: typeof options?.replaceQuery === "string" ? options.replaceQuery : "",
      selectedRowIds: new Set(
        Array.isArray(options?.selectedRowIds) ? options.selectedRowIds.filter(Boolean) : [],
      ),
      status: "idle",
      error: "",
    },
    activeRowId: rows[0]?.rowId ?? null,
    activeLanguageCode: targetCode,
    aiTranslate: Object.fromEntries(
      Object.entries(createEditorChapterState().aiTranslate).map(([actionId, actionState]) => [
        actionId,
        {
          ...actionState,
          ...(options?.aiTranslate && typeof options.aiTranslate === "object"
            ? options.aiTranslate[actionId]
            : null),
        },
      ]),
    ),
    glossary: fixtureGlossary.glossaryState,
    rows,
  };

  appState.screen = "translate";
  appState.selectedTeamId = teamId;
  appState.selectedProjectId = projectId;
  appState.selectedChapterId = chapterId;
  appState.teams = [team];
  appState.deletedTeams = [];
  appState.projects = [project];
  appState.deletedProjects = [];
  appState.glossaries = fixtureGlossary.glossaryList;
  appState.users = [];
  appState.expandedProjects = new Set([projectId]);
  appState.expandedDeletedFiles = new Set();
  appState.auth = {
    ...appState.auth,
    status: "success",
    message: "",
    session: {
      sessionToken: "fixture-session",
      login: "fixture-user",
      name: "Fixture User",
      avatarUrl: null,
    },
    pendingAutoOpenSingleTeam: false,
  };
  appState.offline = {
    ...appState.offline,
    checked: true,
    hasConnection: true,
    hasLocalData: true,
    isEnabled: false,
    reconnecting: false,
  };
  appState.aiSettings = {
    ...appState.aiSettings,
    actionConfig: {
      ...appState.aiSettings.actionConfig,
      ...normalizeStoredAiActionPreferences(options.aiActionConfig),
    },
  };
  appState.editorChapter = editorChapter;

  notifyMockTauriFixture({
    rowCount,
    chapterId,
    projectId,
    teamId,
    sourceCode,
    targetCode,
    languages,
    rows,
  });

  return {
    rowCount,
    chapterId,
    projectId,
    teamId,
    sourceCode,
    targetCode,
    firstRowId: rows[0]?.rowId ?? null,
  };
}

export function applyEditorRegressionSoftDelete(appState, rowId) {
  const editorChapter = appState?.editorChapter;
  if (!editorChapter?.chapterId || !rowId) {
    return null;
  }

  const targetRow = Array.isArray(editorChapter.rows)
    ? editorChapter.rows.find((row) => row?.rowId === rowId)
    : null;
  if (!targetRow || targetRow.lifecycleState === "deleted") {
    return null;
  }

  const previousRows = editorChapter.rows;
  const nextRows = rowsWithFixtureLifecycleState(previousRows, rowId, "deleted");
  const expandedDeletedRowGroupIds = expandedDeletedRowGroupIdsAfterSoftDelete(
    previousRows,
    rowId,
    editorChapter.expandedDeletedRowGroupIds,
    nextRows,
  );
  const nextDeletedGroupId = deletedRowGroupIdAfterSoftDelete(previousRows, rowId);
  const selectedRowIds =
    editorChapter.replace?.selectedRowIds instanceof Set
      ? new Set([...editorChapter.replace.selectedRowIds].filter((candidate) => candidate !== rowId))
      : new Set();

  appState.editorChapter = {
    ...editorChapter,
    rows: nextRows,
    expandedDeletedRowGroupIds,
    activeRowId: editorChapter.activeRowId === rowId ? null : editorChapter.activeRowId,
    activeLanguageCode: editorChapter.activeRowId === rowId ? null : editorChapter.activeLanguageCode,
    history:
      editorChapter.activeRowId === rowId
        ? createEditorHistoryState()
        : editorChapter.history,
    replace: {
      ...editorChapter.replace,
      selectedRowIds,
    },
  };

  return {
    rowId,
    deletedGroupId: nextDeletedGroupId,
    expandedDeletedRowGroupIds: [...expandedDeletedRowGroupIds],
  };
}

export function applyEditorRegressionRestore(appState, rowId) {
  const editorChapter = appState?.editorChapter;
  if (!editorChapter?.chapterId || !rowId) {
    return null;
  }

  const targetRow = Array.isArray(editorChapter.rows)
    ? editorChapter.rows.find((row) => row?.rowId === rowId)
    : null;
  if (!targetRow || targetRow.lifecycleState !== "deleted") {
    return null;
  }

  const previousRows = editorChapter.rows;
  const nextRows = rowsWithFixtureLifecycleState(previousRows, rowId, "active");
  const expandedDeletedRowGroupIds = expandedDeletedRowGroupIdsAfterRestore(
    previousRows,
    rowId,
    editorChapter.expandedDeletedRowGroupIds,
    nextRows,
  );

  appState.editorChapter = {
    ...editorChapter,
    rows: nextRows,
    expandedDeletedRowGroupIds,
  };

  return {
    rowId,
    expandedDeletedRowGroupIds: [...expandedDeletedRowGroupIds],
  };
}

export function readEditorRegressionSnapshot(appState) {
  return {
    screen: appState.screen,
    selectedTeamId: appState.selectedTeamId,
    selectedProjectId: appState.selectedProjectId,
    selectedChapterId: appState.selectedChapterId,
    activeRowId: appState.editorChapter?.activeRowId ?? null,
    activeLanguageCode: appState.editorChapter?.activeLanguageCode ?? null,
    dirtyRowIds:
      appState.editorChapter?.dirtyRowIds instanceof Set
        ? [...appState.editorChapter.dirtyRowIds]
        : [],
    expandedDeletedRowGroupIds:
      appState.editorChapter?.expandedDeletedRowGroupIds instanceof Set
        ? [...appState.editorChapter.expandedDeletedRowGroupIds]
        : [],
    commentSeenRevisions:
      appState.editorChapter?.commentSeenRevisions && typeof appState.editorChapter.commentSeenRevisions === "object"
        ? { ...appState.editorChapter.commentSeenRevisions }
        : {},
    filters: appState.editorChapter?.filters
      ? {
          searchQuery: appState.editorChapter.filters.searchQuery ?? "",
          caseSensitive: appState.editorChapter.filters.caseSensitive === true,
          rowFilterMode: appState.editorChapter.filters.rowFilterMode ?? "show-all",
        }
      : null,
    replace: appState.editorChapter?.replace
      ? {
          enabled: appState.editorChapter.replace.enabled === true,
          replaceQuery: appState.editorChapter.replace.replaceQuery ?? "",
          selectedRowIds:
            appState.editorChapter.replace.selectedRowIds instanceof Set
              ? [...appState.editorChapter.replace.selectedRowIds]
              : [],
        }
      : null,
  };
}
