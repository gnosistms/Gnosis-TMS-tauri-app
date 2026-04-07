import { saveStoredProjectsForTeam } from "./project-cache.js";
import { invoke } from "./runtime.js";
import {
  coerceEditorFontSizePx,
  createEditorHistoryState,
  createTargetLanguageManagerState,
  state,
} from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";

export const MANAGE_TARGET_LANGUAGES_OPTION_VALUE = "__manage_target_languages__";

function selectedTeam() {
  return state.teams.find((team) => team.id === state.selectedTeamId) ?? null;
}

export function findChapterContextById(chapterId = state.selectedChapterId) {
  if (!chapterId) {
    return null;
  }

  for (const project of [...(state.projects ?? []), ...(state.deletedProjects ?? [])]) {
    const chapter = Array.isArray(project?.chapters)
      ? project.chapters.find((item) => item?.id === chapterId)
      : null;
    if (chapter) {
      return { project, chapter };
    }
  }

  return null;
}

function normalizeLanguageSelections(languages, sourceCode, targetCode) {
  const options = Array.isArray(languages) ? languages : [];
  const codes = new Set(options.map((language) => language.code).filter(Boolean));
  const fallbackSource =
    options.find((language) => language.role === "source")?.code ?? options[0]?.code ?? null;
  const nextSource = codes.has(sourceCode) ? sourceCode : fallbackSource;
  const fallbackTarget =
    options.find((language) => language.code !== nextSource && language.role === "target")?.code
    ?? options.find((language) => language.code !== nextSource)?.code
    ?? nextSource
    ?? null;
  const nextTarget =
    targetCode && codes.has(targetCode) && targetCode !== nextSource ? targetCode : fallbackTarget;

  return {
    selectedSourceLanguageCode: nextSource,
    selectedTargetLanguageCode: nextTarget,
  };
}

function cloneRowFields(fields) {
  return Object.fromEntries(
    Object.entries(fields && typeof fields === "object" ? fields : {}).map(([code, value]) => [
      code,
      typeof value === "string" ? value : String(value ?? ""),
    ]),
  );
}

function buildEditorHistoryRequestKey(chapterId, rowId, languageCode) {
  if (!chapterId || !rowId || !languageCode) {
    return null;
  }

  return `${chapterId}:${rowId}:${languageCode}`;
}

function normalizeEditorHistoryState(history) {
  return {
    ...createEditorHistoryState(),
    ...(history && typeof history === "object" ? history : {}),
    rowId: typeof history?.rowId === "string" ? history.rowId : null,
    languageCode: typeof history?.languageCode === "string" ? history.languageCode : null,
    requestKey: typeof history?.requestKey === "string" ? history.requestKey : null,
    restoringCommitSha:
      typeof history?.restoringCommitSha === "string" ? history.restoringCommitSha : null,
    entries: Array.isArray(history?.entries) ? history.entries : [],
  };
}

function cloneCollapsedLanguageCodes(collapsedLanguageCodes) {
  return collapsedLanguageCodes instanceof Set
    ? new Set(collapsedLanguageCodes)
    : new Set();
}

function hasEditorRow(chapterState, rowId) {
  return Array.isArray(chapterState?.rows)
    && chapterState.rows.some((row) => row?.rowId === rowId);
}

function hasEditorLanguage(chapterState, languageCode) {
  return Array.isArray(chapterState?.languages)
    && chapterState.languages.some((language) => language?.code === languageCode);
}

function hasActiveEditorField(chapterState) {
  return hasEditorRow(chapterState, chapterState?.activeRowId)
    && hasEditorLanguage(chapterState, chapterState?.activeLanguageCode);
}

function currentEditorHistoryForSelection(chapterState, rowId, languageCode) {
  const history = normalizeEditorHistoryState(chapterState?.history);
  if (history.rowId === rowId && history.languageCode === languageCode) {
    return history;
  }

  return createEditorHistoryState();
}

function applyEditorUiState(nextEditorChapter, previousEditorChapter = state.editorChapter) {
  const activeRowId =
    typeof previousEditorChapter?.activeRowId === "string" ? previousEditorChapter.activeRowId : null;
  const activeLanguageCode =
    typeof previousEditorChapter?.activeLanguageCode === "string"
      ? previousEditorChapter.activeLanguageCode
      : null;
  const history = currentEditorHistoryForSelection(
    previousEditorChapter,
    activeRowId,
    activeLanguageCode,
  );

  return {
    ...nextEditorChapter,
    fontSizePx: coerceEditorFontSizePx(previousEditorChapter?.fontSizePx),
    collapsedLanguageCodes: cloneCollapsedLanguageCodes(previousEditorChapter?.collapsedLanguageCodes),
    activeRowId:
      hasEditorRow(nextEditorChapter, activeRowId) && hasEditorLanguage(nextEditorChapter, activeLanguageCode)
        ? activeRowId
        : null,
    activeLanguageCode:
      hasEditorRow(nextEditorChapter, activeRowId) && hasEditorLanguage(nextEditorChapter, activeLanguageCode)
        ? activeLanguageCode
        : null,
    history:
      hasEditorRow(nextEditorChapter, activeRowId) && hasEditorLanguage(nextEditorChapter, activeLanguageCode)
        ? history
        : createEditorHistoryState(),
  };
}

function findEditorRowById(rowId, chapterState = state.editorChapter) {
  return chapterState?.rows?.find((row) => row?.rowId === rowId) ?? null;
}

function rowFieldsEqual(left, right) {
  const leftEntries = Object.entries(left && typeof left === "object" ? left : {});
  const rightEntries = Object.entries(right && typeof right === "object" ? right : {});
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([code, value]) => (right?.[code] ?? "") === value);
}

function normalizeEditorRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const fields = cloneRowFields(row?.fields);
    return {
      ...row,
      fields,
      persistedFields: cloneRowFields(fields),
      saveStatus: "idle",
      saveError: "",
    };
  });
}

export function resolveChapterSourceWordCount(chapter) {
  if (!chapter || typeof chapter !== "object") {
    return 0;
  }

  const sourceCode = chapter.selectedSourceLanguageCode;
  const counts =
    chapter.sourceWordCounts && typeof chapter.sourceWordCounts === "object"
      ? chapter.sourceWordCounts
      : {};
  const value = sourceCode ? counts[sourceCode] : null;
  return Number.isFinite(value) ? value : 0;
}

function persistProjectsForSelectedTeam() {
  const team = selectedTeam();
  if (!team) {
    return;
  }

  saveStoredProjectsForTeam(team, {
    projects: state.projects,
    deletedProjects: state.deletedProjects,
  });
}

function applyChapterMetadataToState(chapterId, updates) {
  if (!chapterId || !updates || typeof updates !== "object") {
    return;
  }

  const applyToProject = (project) => {
    if (!project || !Array.isArray(project.chapters)) {
      return project;
    }

    let changed = false;
    const chapters = project.chapters.map((chapter) => {
      if (!chapter || chapter.id !== chapterId) {
        return chapter;
      }

      changed = true;
      const nextChapter = {
        ...chapter,
        ...updates,
      };
      nextChapter.sourceWordCount = resolveChapterSourceWordCount(nextChapter);
      return nextChapter;
    });

    return changed ? { ...project, chapters } : project;
  };

  state.projects = state.projects.map(applyToProject);
  state.deletedProjects = state.deletedProjects.map(applyToProject);
  persistProjectsForSelectedTeam();
}

function updateEditorChapterRow(rowId, updater) {
  if (!state.editorChapter?.chapterId || !Array.isArray(state.editorChapter.rows)) {
    return null;
  }

  let updatedRow = null;
  const nextRows = state.editorChapter.rows.map((row) => {
    if (!row || row.rowId !== rowId) {
      return row;
    }

    updatedRow = updater(row);
    return updatedRow;
  });

  if (!updatedRow) {
    return null;
  }

  state.editorChapter = {
    ...state.editorChapter,
    rows: nextRows,
  };

  return updatedRow;
}

function applyEditorPayloadToState(payload, projectId, existingChapter = {}) {
  const previousEditorChapter = state.editorChapter;
  const { selectedSourceLanguageCode, selectedTargetLanguageCode } = normalizeLanguageSelections(
    payload.languages,
    existingChapter.selectedSourceLanguageCode ?? payload.selectedSourceLanguageCode,
    existingChapter.selectedTargetLanguageCode ?? payload.selectedTargetLanguageCode,
  );

  state.editorChapter = applyEditorUiState({
    status: "ready",
    error: "",
    projectId,
    chapterId: payload.chapterId,
    fileTitle: payload.fileTitle,
    languages: Array.isArray(payload.languages) ? payload.languages : [],
    sourceWordCounts:
      payload.sourceWordCounts && typeof payload.sourceWordCounts === "object"
        ? payload.sourceWordCounts
        : {},
    selectedSourceLanguageCode,
    selectedTargetLanguageCode,
    persistedSourceLanguageCode: selectedSourceLanguageCode,
    persistedTargetLanguageCode: selectedTargetLanguageCode,
    selectionPersistStatus: "idle",
    rows: normalizeEditorRows(payload.rows),
  }, previousEditorChapter);

  applyChapterMetadataToState(payload.chapterId, {
    name: payload.fileTitle,
    languages: state.editorChapter.languages,
    sourceWordCounts: state.editorChapter.sourceWordCounts,
    selectedSourceLanguageCode,
    selectedTargetLanguageCode,
  });
}

function applyEditorSelectionsToProjectState(chapterState = state.editorChapter) {
  if (!chapterState?.chapterId) {
    return;
  }

  applyChapterMetadataToState(chapterState.chapterId, {
    name: chapterState.fileTitle,
    languages: chapterState.languages,
    sourceWordCounts: chapterState.sourceWordCounts,
    selectedSourceLanguageCode: chapterState.selectedSourceLanguageCode,
    selectedTargetLanguageCode: chapterState.selectedTargetLanguageCode,
  });
}

function setEditorSelections(nextSelections) {
  state.editorChapter = {
    ...state.editorChapter,
    ...nextSelections,
  };
  applyEditorSelectionsToProjectState(state.editorChapter);
}

async function fetchEditorFieldHistory(render, requestKey) {
  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId || !editorChapter.activeRowId || !editorChapter.activeLanguageCode) {
    return;
  }

  const team = selectedTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  const rowId = editorChapter.activeRowId;
  const languageCode = editorChapter.activeLanguageCode;

  try {
    const payload = await invoke("load_gtms_editor_field_history", {
      input: {
        installationId: team.installationId,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        rowId,
        languageCode,
      },
    });

    if (
      state.editorChapter?.chapterId !== editorChapter.chapterId
      || state.editorChapter.activeRowId !== rowId
      || state.editorChapter.activeLanguageCode !== languageCode
      || state.editorChapter.history?.requestKey !== requestKey
    ) {
      return;
    }

    state.editorChapter = {
      ...state.editorChapter,
      history: {
        status: "ready",
        error: "",
        rowId,
        languageCode,
        requestKey,
        restoringCommitSha: null,
        entries: Array.isArray(payload?.entries) ? payload.entries : [],
      },
    };
    render?.();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      state.editorChapter?.chapterId !== editorChapter.chapterId
      || state.editorChapter.activeRowId !== rowId
      || state.editorChapter.activeLanguageCode !== languageCode
      || state.editorChapter.history?.requestKey !== requestKey
    ) {
      return;
    }

    state.editorChapter = {
      ...state.editorChapter,
      history: {
        ...normalizeEditorHistoryState(state.editorChapter.history),
        status: "error",
        error: message,
        rowId,
        languageCode,
        requestKey,
        restoringCommitSha: null,
      },
    };
    render?.();
  }
}

export function loadActiveEditorFieldHistory(render) {
  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId || !hasActiveEditorField(editorChapter)) {
    return;
  }

  const requestKey = buildEditorHistoryRequestKey(
    editorChapter.chapterId,
    editorChapter.activeRowId,
    editorChapter.activeLanguageCode,
  );
  const currentHistory = currentEditorHistoryForSelection(
    editorChapter,
    editorChapter.activeRowId,
    editorChapter.activeLanguageCode,
  );
  state.editorChapter = {
    ...editorChapter,
    history: {
      ...currentHistory,
      status: "loading",
      error: "",
      rowId: editorChapter.activeRowId,
      languageCode: editorChapter.activeLanguageCode,
      requestKey,
      restoringCommitSha: null,
    },
  };
  render?.();
  void fetchEditorFieldHistory(render, requestKey);
}

export function setActiveEditorField(render, rowId, languageCode) {
  if (!rowId || !languageCode || !hasEditorRow(state.editorChapter, rowId) || !hasEditorLanguage(state.editorChapter, languageCode)) {
    return;
  }

  const editorChapter = state.editorChapter;
  if (
    editorChapter.activeRowId === rowId
    && editorChapter.activeLanguageCode === languageCode
    && (editorChapter.history?.status === "loading" || editorChapter.history?.status === "ready")
  ) {
    return;
  }

  state.editorChapter = {
    ...editorChapter,
    activeRowId: rowId,
    activeLanguageCode: languageCode,
    history: createEditorHistoryState(),
  };
  loadActiveEditorFieldHistory(render);
}

export async function persistEditorChapterSelections(render) {
  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId) {
    return;
  }

  if (editorChapter.selectionPersistStatus === "saving") {
    state.editorChapter = {
      ...editorChapter,
      selectionPersistStatus: "dirty",
    };
    return;
  }

  const desiredSourceLanguageCode = editorChapter.selectedSourceLanguageCode;
  const desiredTargetLanguageCode = editorChapter.selectedTargetLanguageCode;
  if (!desiredSourceLanguageCode || !desiredTargetLanguageCode) {
    return;
  }

  const persistedSourceLanguageCode = editorChapter.persistedSourceLanguageCode;
  const persistedTargetLanguageCode = editorChapter.persistedTargetLanguageCode;
  if (
    desiredSourceLanguageCode === persistedSourceLanguageCode
    && desiredTargetLanguageCode === persistedTargetLanguageCode
  ) {
    if (editorChapter.selectionPersistStatus !== "idle") {
      state.editorChapter = {
        ...editorChapter,
        selectionPersistStatus: "idle",
      };
      render?.();
    }
    return;
  }

  const team = selectedTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    selectionPersistStatus: "saving",
  };

  try {
    const payload = await invoke("update_gtms_chapter_language_selection", {
      input: {
        installationId: team.installationId,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        sourceLanguageCode: desiredSourceLanguageCode,
        targetLanguageCode: desiredTargetLanguageCode,
      },
    });

    applyChapterMetadataToState(editorChapter.chapterId, {
      selectedSourceLanguageCode: payload.sourceLanguageCode,
      selectedTargetLanguageCode: payload.targetLanguageCode,
    });

    const shouldPersistAgain =
      state.editorChapter?.chapterId === editorChapter.chapterId
      && (
        state.editorChapter.selectionPersistStatus === "dirty"
        || state.editorChapter.selectedSourceLanguageCode !== payload.sourceLanguageCode
        || state.editorChapter.selectedTargetLanguageCode !== payload.targetLanguageCode
      );

    if (state.editorChapter?.chapterId === editorChapter.chapterId) {
      state.editorChapter = {
        ...state.editorChapter,
        persistedSourceLanguageCode: payload.sourceLanguageCode,
        persistedTargetLanguageCode: payload.targetLanguageCode,
        selectionPersistStatus: "idle",
      };
      render?.();
    }

    if (shouldPersistAgain) {
      void persistEditorChapterSelections(render);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.editorChapter?.chapterId === editorChapter.chapterId) {
      const restoredSelections = normalizeLanguageSelections(
        state.editorChapter.languages,
        persistedSourceLanguageCode,
        persistedTargetLanguageCode,
      );
      state.editorChapter = {
        ...state.editorChapter,
        ...restoredSelections,
        selectionPersistStatus: "idle",
      };
      applyEditorSelectionsToProjectState(state.editorChapter);
      render?.();
    }
    showNoticeBadge(message || "The language selection could not be saved.", render);
  }
}

export async function loadSelectedChapterEditorData(render, options = {}) {
  const team = selectedTeam();
  const context = findChapterContextById();
  if (!context || !Number.isFinite(team?.installationId)) {
    state.editorChapter = {
      ...state.editorChapter,
      status: "error",
      error: "Could not determine which file to open.",
    };
    render();
    return;
  }

  const preserveVisibleRows =
    options.preserveVisibleRows === true
    && state.screen === "translate"
    && state.editorChapter?.chapterId === context.chapter.id
    && Array.isArray(state.editorChapter.rows)
    && state.editorChapter.rows.length > 0;
  const nextSelectedSourceLanguageCode = preserveVisibleRows
    ? state.editorChapter.selectedSourceLanguageCode
    : context.chapter.selectedSourceLanguageCode ?? null;
  const nextSelectedTargetLanguageCode = preserveVisibleRows
    ? state.editorChapter.selectedTargetLanguageCode
    : context.chapter.selectedTargetLanguageCode ?? null;

  state.selectedProjectId = context.project.id;
  state.editorChapter = {
    ...state.editorChapter,
    status: preserveVisibleRows ? "refreshing" : "loading",
    error: "",
    projectId: context.project.id,
    chapterId: context.chapter.id,
    fileTitle: context.chapter.name ?? "",
    languages: preserveVisibleRows
      ? state.editorChapter.languages
      : Array.isArray(context.chapter.languages) ? context.chapter.languages : [],
    sourceWordCounts:
      preserveVisibleRows
        ? state.editorChapter.sourceWordCounts
        : context.chapter.sourceWordCounts && typeof context.chapter.sourceWordCounts === "object"
        ? context.chapter.sourceWordCounts
        : {},
    selectedSourceLanguageCode: nextSelectedSourceLanguageCode,
    selectedTargetLanguageCode: nextSelectedTargetLanguageCode,
    persistedSourceLanguageCode: nextSelectedSourceLanguageCode,
    persistedTargetLanguageCode: nextSelectedTargetLanguageCode,
    selectionPersistStatus: "idle",
    activeRowId: preserveVisibleRows ? state.editorChapter.activeRowId : null,
    activeLanguageCode: preserveVisibleRows ? state.editorChapter.activeLanguageCode : null,
    history: preserveVisibleRows ? state.editorChapter.history : createEditorHistoryState(),
    rows: preserveVisibleRows ? state.editorChapter.rows : [],
  };
  render();

  try {
    const payload = await invoke("load_gtms_chapter_editor_data", {
      input: {
        installationId: team.installationId,
        repoName: context.project.name,
        chapterId: context.chapter.id,
      },
    });
    applyEditorPayloadToState(payload, context.project.id, context.chapter);
    render();
    if (hasActiveEditorField(state.editorChapter)) {
      loadActiveEditorFieldHistory(render);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.editorChapter = {
      ...state.editorChapter,
      status: "error",
      error: message,
      activeRowId: null,
      activeLanguageCode: null,
      history: createEditorHistoryState(),
      rows: [],
    };
    showNoticeBadge(message || "The file could not be loaded.", render);
    render();
  }
}

export async function openTranslateChapter(render, chapterId) {
  const context = findChapterContextById(chapterId);
  if (!context) {
    showNoticeBadge("Could not determine which file to open.", render);
    return;
  }

  void persistEditorChapterSelections(render);
  state.selectedProjectId = context.project.id;
  state.selectedChapterId = chapterId;
  state.screen = "translate";
  render();
  await loadSelectedChapterEditorData(render);
}

export function updateEditorSourceLanguage(render, nextCode) {
  if (!nextCode || !Array.isArray(state.editorChapter.languages) || state.editorChapter.languages.length === 0) {
    return;
  }

  const selections = normalizeLanguageSelections(
    state.editorChapter.languages,
    nextCode,
    state.editorChapter.selectedTargetLanguageCode,
  );
  setEditorSelections(selections);
  render();
  void persistEditorChapterSelections(render);
}

export function updateEditorTargetLanguage(render, nextCode) {
  if (!nextCode || !Array.isArray(state.editorChapter.languages) || state.editorChapter.languages.length === 0) {
    return;
  }

  const selections = normalizeLanguageSelections(
    state.editorChapter.languages,
    state.editorChapter.selectedSourceLanguageCode,
    nextCode,
  );
  setEditorSelections(selections);
  render();
  void persistEditorChapterSelections(render);
}

export function updateEditorFontSize(nextValue) {
  state.editorChapter = {
    ...state.editorChapter,
    fontSizePx: coerceEditorFontSizePx(nextValue),
  };
}

export async function restoreEditorFieldHistory(render, commitSha) {
  const editorChapter = state.editorChapter;
  if (!commitSha || !editorChapter?.chapterId || !hasActiveEditorField(editorChapter)) {
    return;
  }

  const row = findEditorRowById(editorChapter.activeRowId, editorChapter);
  if (!row || row.saveStatus !== "idle") {
    showNoticeBadge("Save the current row before restoring history.", render);
    return;
  }

  const team = selectedTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  state.editorChapter = {
    ...editorChapter,
    history: {
      ...currentEditorHistoryForSelection(
        editorChapter,
        editorChapter.activeRowId,
        editorChapter.activeLanguageCode,
      ),
      status: "restoring",
      error: "",
      rowId: editorChapter.activeRowId,
      languageCode: editorChapter.activeLanguageCode,
      requestKey: buildEditorHistoryRequestKey(
        editorChapter.chapterId,
        editorChapter.activeRowId,
        editorChapter.activeLanguageCode,
      ),
      restoringCommitSha: commitSha,
    },
  };
  render?.();

  try {
    const payload = await invoke("restore_gtms_editor_field_from_history", {
      input: {
        installationId: team.installationId,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        rowId: editorChapter.activeRowId,
        languageCode: editorChapter.activeLanguageCode,
        commitSha,
      },
    });

    if (
      state.editorChapter?.chapterId === editorChapter.chapterId
      && state.editorChapter.activeRowId === editorChapter.activeRowId
      && state.editorChapter.activeLanguageCode === editorChapter.activeLanguageCode
    ) {
      updateEditorChapterRow(editorChapter.activeRowId, (currentRow) => ({
        ...currentRow,
        fields: {
          ...cloneRowFields(currentRow.fields),
          [editorChapter.activeLanguageCode]: payload?.plainText ?? "",
        },
        persistedFields: {
          ...cloneRowFields(currentRow.persistedFields),
          [editorChapter.activeLanguageCode]: payload?.plainText ?? "",
        },
        saveStatus: "idle",
        saveError: "",
      }));

      state.editorChapter = {
        ...state.editorChapter,
        sourceWordCounts:
          payload?.sourceWordCounts && typeof payload.sourceWordCounts === "object"
            ? payload.sourceWordCounts
            : state.editorChapter.sourceWordCounts,
        history: {
          ...normalizeEditorHistoryState(state.editorChapter.history),
          status: "idle",
          error: "",
          restoringCommitSha: null,
        },
      };
      applyEditorSelectionsToProjectState(state.editorChapter);
      render?.();
      loadActiveEditorFieldHistory(render);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      state.editorChapter?.chapterId === editorChapter.chapterId
      && state.editorChapter.activeRowId === editorChapter.activeRowId
      && state.editorChapter.activeLanguageCode === editorChapter.activeLanguageCode
    ) {
      state.editorChapter = {
        ...state.editorChapter,
        history: {
          ...normalizeEditorHistoryState(state.editorChapter.history),
          status: "ready",
          error: "",
          restoringCommitSha: null,
        },
      };
      render?.();
    }
    showNoticeBadge(message || "The selected history entry could not be restored.", render);
  }
}

export function openTargetLanguageManager() {
  state.targetLanguageManager = {
    ...state.targetLanguageManager,
    isOpen: true,
    status: "idle",
    error: "",
  };
}

export function closeTargetLanguageManager() {
  state.targetLanguageManager = createTargetLanguageManagerState();
}

export function updateEditorRowFieldValue(rowId, languageCode, nextValue) {
  if (!rowId || !languageCode) {
    return;
  }

  updateEditorChapterRow(rowId, (row) => {
    const fields = {
      ...cloneRowFields(row.fields),
      [languageCode]: nextValue,
    };
    const nextSaveStatus =
      row.saveStatus === "saving"
        ? "dirty"
        : rowFieldsEqual(fields, row.persistedFields)
          ? "idle"
          : "dirty";

    return {
      ...row,
      fields,
      saveStatus: nextSaveStatus,
      saveError: "",
    };
  });
}

export function toggleEditorLanguageCollapsed(languageCode) {
  if (!languageCode) {
    return;
  }

  const collapsedLanguageCodes =
    state.editorChapter?.collapsedLanguageCodes instanceof Set
      ? new Set(state.editorChapter.collapsedLanguageCodes)
      : new Set();

  if (collapsedLanguageCodes.has(languageCode)) {
    collapsedLanguageCodes.delete(languageCode);
  } else {
    collapsedLanguageCodes.add(languageCode);
  }

  state.editorChapter = {
    ...state.editorChapter,
    collapsedLanguageCodes,
  };
}

export async function persistEditorRowOnBlur(render, rowId) {
  if (!rowId || !state.editorChapter?.chapterId) {
    return;
  }

  const editorChapter = state.editorChapter;
  const row = editorChapter.rows.find((item) => item?.rowId === rowId);
  if (!row) {
    return;
  }

  if (row.saveStatus === "saving") {
    updateEditorChapterRow(rowId, (currentRow) => ({
      ...currentRow,
      saveStatus: "dirty",
    }));
    return;
  }

  if (rowFieldsEqual(row.fields, row.persistedFields)) {
    if (row.saveStatus !== "idle" || row.saveError) {
      updateEditorChapterRow(rowId, (currentRow) => ({
        ...currentRow,
        saveStatus: "idle",
        saveError: "",
      }));
      render?.();
    }
    return;
  }

  const team = selectedTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  const fieldsToPersist = cloneRowFields(row.fields);
  updateEditorChapterRow(rowId, (currentRow) => ({
    ...currentRow,
    saveStatus: "saving",
    saveError: "",
  }));
  render?.();

  try {
    const payload = await invoke("update_gtms_editor_row_fields", {
      input: {
        installationId: team.installationId,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        rowId,
        fields: fieldsToPersist,
      },
    });

    if (state.editorChapter?.chapterId === editorChapter.chapterId) {
      const updatedRow = updateEditorChapterRow(rowId, (currentRow) => {
        const rowChangedDuringSave = !rowFieldsEqual(currentRow.fields, fieldsToPersist);
        return {
          ...currentRow,
          persistedFields: cloneRowFields(fieldsToPersist),
          saveStatus: rowChangedDuringSave ? "dirty" : "idle",
          saveError: "",
        };
      });

      state.editorChapter = {
        ...state.editorChapter,
        sourceWordCounts:
          payload?.sourceWordCounts && typeof payload.sourceWordCounts === "object"
            ? payload.sourceWordCounts
            : state.editorChapter.sourceWordCounts,
      };
      applyEditorSelectionsToProjectState(state.editorChapter);
      render?.();
      if (state.editorChapter.activeRowId === rowId) {
        loadActiveEditorFieldHistory(render);
      }

      if (updatedRow?.saveStatus === "dirty") {
        void persistEditorRowOnBlur(render, rowId);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.editorChapter?.chapterId === editorChapter.chapterId) {
      updateEditorChapterRow(rowId, (currentRow) => ({
        ...currentRow,
        saveStatus: "error",
        saveError: message,
      }));
      render?.();
    }
    showNoticeBadge(message || "The row could not be saved.", render);
  }
}
