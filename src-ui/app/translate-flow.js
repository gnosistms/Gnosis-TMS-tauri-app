import { saveStoredProjectsForTeam } from "./project-cache.js";
import { invoke } from "./runtime.js";
import { state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";

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
  const { selectedSourceLanguageCode, selectedTargetLanguageCode } = normalizeLanguageSelections(
    payload.languages,
    existingChapter.selectedSourceLanguageCode ?? payload.selectedSourceLanguageCode,
    existingChapter.selectedTargetLanguageCode ?? payload.selectedTargetLanguageCode,
  );

  state.editorChapter = {
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
  };

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

export async function loadSelectedChapterEditorData(render) {
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

  state.selectedProjectId = context.project.id;
  state.editorChapter = {
    ...state.editorChapter,
    status: "loading",
    error: "",
    projectId: context.project.id,
    chapterId: context.chapter.id,
    fileTitle: context.chapter.name ?? "",
    languages: Array.isArray(context.chapter.languages) ? context.chapter.languages : [],
    sourceWordCounts:
      context.chapter.sourceWordCounts && typeof context.chapter.sourceWordCounts === "object"
        ? context.chapter.sourceWordCounts
        : {},
    selectedSourceLanguageCode: context.chapter.selectedSourceLanguageCode ?? null,
    selectedTargetLanguageCode: context.chapter.selectedTargetLanguageCode ?? null,
    persistedSourceLanguageCode: context.chapter.selectedSourceLanguageCode ?? null,
    persistedTargetLanguageCode: context.chapter.selectedTargetLanguageCode ?? null,
    selectionPersistStatus: "idle",
    rows: [],
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.editorChapter = {
      ...state.editorChapter,
      status: "error",
      error: message,
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
