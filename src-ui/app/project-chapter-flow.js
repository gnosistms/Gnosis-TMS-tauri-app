import { invoke, waitForNextPaint } from "./runtime.js";
import {
  beginProjectsPageSync,
  completeProjectsPageSync,
  failProjectsPageSync,
} from "./page-sync.js";
import {
  saveStoredChapterPendingMutations,
  saveStoredProjectsForTeam,
} from "./project-cache.js";
import {
  removePendingMutation,
  upsertPendingMutation,
} from "./optimistic-collection.js";
import {
  resetChapterPermanentDeletion,
  resetChapterRename,
  state,
} from "./state.js";
import { reconcileProjectRepoSyncStates } from "./project-repo-sync-flow.js";
import { clearScopedSyncBadge, showNoticeBadge, showScopedSyncBadge } from "./status-feedback.js";
import {
  listProjectMetadataRecords,
  lookupLocalMetadataTombstone,
} from "./team-metadata-flow.js";
import { ensureResourceNotTombstoned } from "./resource-lifecycle-engine.js";
import { canPermanentlyDeleteProjectFiles } from "./resource-capabilities.js";
import { normalizedConfirmationValue } from "./resource-entity-modal.js";
import {
  applyProjectSnapshotToState,
  sortProjectSnapshot,
} from "./project-top-level-state.js";
import {
  refreshProjectFilesFromDisk as runRefreshProjectFilesFromDisk,
} from "./project-discovery-flow.js";

export function setProjectUiDebug(render, text) {
  showScopedSyncBadge("projects", text, render);
}

export function clearProjectUiDebug(render) {
  clearScopedSyncBadge("projects", render);
}

function setProjectDiscoveryError(render, error) {
  state.projectDiscovery = {
    status: "error",
    error,
    glossaryWarning: state.projectDiscovery?.glossaryWarning ?? "",
    recoveryMessage: state.projectDiscovery?.recoveryMessage ?? "",
  };
  render?.();
}

export function selectedProjectsTeam() {
  return state.teams.find((team) => team.id === state.selectedTeamId) ?? null;
}

function ensureChapterMutationAllowed(
  render,
  { selectedTeam = selectedProjectsTeam(), actionLabel = "modify files", requireDelete = false } = {},
) {
  if (state.offline?.isEnabled === true) {
    setProjectDiscoveryError(render, `You cannot ${actionLabel} while offline.`);
    return false;
  }

  if (!Number.isFinite(selectedTeam?.installationId)) {
    setProjectDiscoveryError(render, "Could not determine the selected team.");
    return false;
  }

  if (requireDelete ? selectedTeam.canDelete !== true : selectedTeam.canManageProjects !== true) {
    setProjectDiscoveryError(
      render,
      `You do not have permission to ${actionLabel} in this team.`,
    );
    return false;
  }

  return true;
}

export function persistProjectsForTeam(selectedTeam) {
  saveStoredProjectsForTeam(selectedTeam, {
    projects: state.projects,
    deletedProjects: state.deletedProjects,
  });
}

function persistChapterPendingMutationsForTeam(selectedTeam) {
  saveStoredChapterPendingMutations(selectedTeam, state.pendingChapterMutations);
}

export function normalizeListedChapter(chapter) {
  if (!chapter || typeof chapter !== "object") {
    return null;
  }

  const id =
    typeof chapter.id === "string" && chapter.id.trim()
      ? chapter.id.trim()
      : null;
  const name =
    typeof chapter.name === "string" && chapter.name.trim()
      ? chapter.name.trim()
      : null;
  if (!id || !name) {
    return null;
  }

  return {
    ...chapter,
    id,
    name,
    status: chapter.status === "deleted" ? "deleted" : "active",
    languages: Array.isArray(chapter.languages) ? chapter.languages : [],
    sourceWordCounts:
      chapter.sourceWordCounts && typeof chapter.sourceWordCounts === "object"
        ? chapter.sourceWordCounts
        : {},
    selectedSourceLanguageCode:
      typeof chapter.selectedSourceLanguageCode === "string" && chapter.selectedSourceLanguageCode.trim()
        ? chapter.selectedSourceLanguageCode
        : null,
    selectedTargetLanguageCode:
      typeof chapter.selectedTargetLanguageCode === "string" && chapter.selectedTargetLanguageCode.trim()
        ? chapter.selectedTargetLanguageCode
        : null,
    linkedGlossary: normalizeChapterGlossaryLink(chapter.linkedGlossary),
  };
}

function normalizeChapterGlossaryLink(link) {
  if (!link || typeof link !== "object") {
    return null;
  }

  const glossaryId =
    typeof link.glossaryId === "string" && link.glossaryId.trim()
      ? link.glossaryId.trim()
      : null;
  const repoName =
    typeof link.repoName === "string" && link.repoName.trim()
      ? link.repoName.trim()
      : null;

  if (!glossaryId || !repoName) {
    return null;
  }

  return {
    glossaryId,
    repoName,
  };
}

export function projectMetadataRecordIsTombstone(record) {
  return record?.recordState === "tombstone" || record?.remoteState === "deleted";
}

export function projectMatchesMetadataRecord(project, record) {
  const projectId =
    typeof project?.id === "string" && project.id.trim()
      ? project.id.trim()
      : "";
  const repoName =
    typeof project?.name === "string" && project.name.trim()
      ? project.name.trim()
      : "";
  const fullName =
    typeof project?.fullName === "string" && project.fullName.trim()
      ? project.fullName.trim()
      : "";
  const recordRepoNames = [
    typeof record?.repoName === "string" ? record.repoName.trim() : "",
    ...(
      Array.isArray(record?.previousRepoNames)
        ? record.previousRepoNames.map((value) => String(value ?? "").trim())
        : []
    ),
  ].filter(Boolean);

  if (projectId && typeof record?.id === "string" && record.id.trim()) {
    return projectId === record.id.trim();
  }

  if (fullName && typeof record?.fullName === "string" && record.fullName.trim()) {
    return fullName === record.fullName.trim();
  }

  return repoName && recordRepoNames.includes(repoName);
}

export function dropProjectMutationsForProject(selectedTeam, projectId) {
  state.pendingChapterMutations = (Array.isArray(state.pendingChapterMutations) ? state.pendingChapterMutations : [])
    .filter((mutation) => mutation?.projectId !== projectId);
  persistChapterPendingMutationsForTeam(selectedTeam);
}

export function clearSelectedProjectState(project) {
  if (state.selectedProjectId === project?.id) {
    state.selectedProjectId = null;
  }
  if (
    state.selectedChapterId
    && Array.isArray(project?.chapters)
    && project.chapters.some((chapter) => chapter?.id === state.selectedChapterId)
  ) {
    state.selectedChapterId = null;
  }
}

export async function purgeLocalProjectRepo(selectedTeam, projectName, projectId = null) {
  if (!Number.isFinite(selectedTeam?.installationId) || !String(projectName ?? "").trim()) {
    return;
  }

  await invoke("purge_local_gtms_project_repo", {
    input: {
      installationId: selectedTeam.installationId,
      projectId,
      repoName: projectName,
    },
  });
}

export function removeVisibleProject(projectId) {
  applyProjectSnapshotToState({
    items: state.projects.filter((item) => item.id !== projectId),
    deletedItems: state.deletedProjects.filter((item) => item.id !== projectId),
  }, { reconcileExpandedDeletedFiles });
}

export async function ensureProjectNotTombstoned(render, selectedTeam, project, options = {}) {
  return ensureResourceNotTombstoned({
    installationId: selectedTeam?.installationId,
    resource: project,
    resourceId: project?.id ?? "",
    render,
    showNotice: options.showNotice !== false,
    resourceLabel: "project",
    lookupMetadataTombstone: (resourceId) => lookupLocalMetadataTombstone(selectedTeam, "project", resourceId),
    listMetadataRecords: () => listProjectMetadataRecords(selectedTeam),
    isTombstoneRecord: projectMetadataRecordIsTombstone,
    matchesMetadataRecord: projectMatchesMetadataRecord,
    purgeLocalRepo: () => purgeLocalProjectRepo(selectedTeam, project.name, project.id),
    removeVisibleResource: () => {
      removeVisibleProject(project.id);
      clearSelectedProjectState(project);
      dropProjectMutationsForProject(selectedTeam, project.id);
      delete state.projectRepoSyncByProjectId[project.id];
    },
    persistVisibleState: () => persistProjectsForTeam(selectedTeam),
  });
}

export async function refreshProjectFilesFromDisk(render, selectedTeam, projects) {
  return runRefreshProjectFilesFromDisk(render, selectedTeam, projects, {
    applyChapterPendingMutation,
    normalizeListedChapter,
    persistProjectsForTeam,
    reconcileExpandedDeletedFiles,
  });
}

export function findChapterContext(chapterId) {
  for (const project of [...state.projects, ...state.deletedProjects]) {
    const chapter = Array.isArray(project?.chapters)
      ? project.chapters.find((item) => item?.id === chapterId)
      : null;
    if (chapter) {
      return { project, chapter };
    }
  }

  return null;
}

function resolveChapterContext(render, chapterId, missingMessage) {
  const selectedTeam = selectedProjectsTeam();
  const context = findChapterContext(chapterId);

  if (!context?.chapter) {
    setProjectDiscoveryError(render, missingMessage);
    return null;
  }

  return { selectedTeam, context };
}

async function resolveChapterMutationContext(render, chapterId, options = {}) {
  const resolved = resolveChapterContext(
    render,
    chapterId,
    options.missingMessage ?? "Could not find the selected file.",
  );
  if (!resolved) {
    return null;
  }

  if (!ensureChapterMutationAllowed(render, {
    selectedTeam: resolved.selectedTeam,
    actionLabel: options.actionLabel ?? "modify files",
    requireDelete: options.requireDelete === true,
  })) {
    return null;
  }

  if (
    options.ensureNotTombstoned !== false
    && await ensureProjectNotTombstoned(render, resolved.selectedTeam, resolved.context.project)
  ) {
    return null;
  }

  return resolved;
}

function cloneProjectCollections() {
  return {
    projects: structuredClone(state.projects),
    deletedProjects: structuredClone(state.deletedProjects),
    expandedDeletedFiles: new Set(state.expandedDeletedFiles),
  };
}

function restoreProjectCollections(snapshot) {
  state.projects = snapshot.projects;
  state.deletedProjects = snapshot.deletedProjects;
  state.expandedDeletedFiles = snapshot.expandedDeletedFiles;
  reconcileExpandedDeletedFiles();
}

function updateChapterInState(chapterId, updater) {
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
      return updater(chapter, project);
    });

    return changed ? { ...project, chapters } : project;
  };

  state.projects = state.projects.map(applyToProject);
  state.deletedProjects = state.deletedProjects.map(applyToProject);
}

function enqueueChapterMutation(selectedTeam, mutation) {
  state.pendingChapterMutations = upsertPendingMutation(state.pendingChapterMutations, mutation);
  persistChapterPendingMutationsForTeam(selectedTeam);
}

function completeChapterMutation(selectedTeam, mutationId) {
  state.pendingChapterMutations = removePendingMutation(state.pendingChapterMutations, mutationId);
  persistChapterPendingMutationsForTeam(selectedTeam);
}

function startOptimisticChapterMutation({
  render,
  selectedTeam,
  context,
  mutation,
  applyOptimistic,
  optimisticDebugText = "",
  remoteDebugText = "",
  beforeReconcile,
  rollback,
  runRemote,
  showFailureNotice = true,
}) {
  const snapshot = cloneProjectCollections();

  state.projectSyncVersion += 1;
  applyOptimistic?.();
  beginProjectsPageSync();
  persistProjectsForTeam(selectedTeam);
  enqueueChapterMutation(selectedTeam, mutation);
  render();

  if (optimisticDebugText) {
    setProjectUiDebug(render, optimisticDebugText);
  }

  void waitForNextPaint().then(async () => {
    try {
      if (remoteDebugText) {
        setProjectUiDebug(render, remoteDebugText);
      }
      const payload = await runRemote();
      completeChapterMutation(selectedTeam, mutation.id);
      await beforeReconcile?.(payload);
      await reconcileProjectRepoSyncStates(render, selectedTeam, [context.project]);
      await refreshProjectFilesFromDisk(render, selectedTeam, [context.project]);
      clearProjectUiDebug(render);
      await completeProjectsPageSync(render);
      render();
    } catch (error) {
      completeChapterMutation(selectedTeam, mutation.id);
      restoreProjectCollections(snapshot);
      await rollback?.(error);
      persistProjectsForTeam(selectedTeam);
      clearProjectUiDebug(render);
      failProjectsPageSync();
      if (showFailureNotice) {
        showNoticeBadge(error?.message ?? String(error), render);
      }
      render();
    }
  });
}

function chapterGlossaryLinkFromGlossaryId(glossaryId) {
  if (typeof glossaryId !== "string" || !glossaryId.trim()) {
    return null;
  }

  const glossary = state.glossaries.find(
    (item) => item?.id === glossaryId && item.lifecycleState !== "deleted",
  );
  if (!glossary) {
    return null;
  }

  return {
    glossaryId: glossary.id,
    repoName: glossary.repoName,
  };
}

function chapterGlossaryLinkInput(link) {
  if (!link) {
    return null;
  }

  return {
    glossaryId: link.glossaryId,
    repoName: link.repoName,
  };
}

function glossarySummaryByLink(link) {
  if (!link) {
    return null;
  }

  return (
    state.glossaries.find((glossary) => glossary?.id === link.glossaryId)
    ?? state.glossaries.find((glossary) => glossary?.repoName === link.repoName)
    ?? null
  );
}

function glossaryTargetLanguageKey(glossary) {
  if (!glossary || typeof glossary !== "object") {
    return "";
  }

  return String(glossary.targetLanguage?.code ?? glossary.targetLanguage?.name ?? "").trim().toLowerCase();
}

export function reconcileExpandedDeletedFiles() {
  const nextExpandedDeletedFiles = new Set(state.expandedDeletedFiles);

  for (const project of [...state.projects, ...state.deletedProjects]) {
    const chapters = Array.isArray(project?.chapters) ? project.chapters : [];
    const deletedCount = chapters.filter((chapter) => chapter?.status === "deleted").length;
    const activeCount = chapters.length - deletedCount;

    if (deletedCount === 0) {
      nextExpandedDeletedFiles.delete(project.id);
      continue;
    }

    if (activeCount === 0) {
      nextExpandedDeletedFiles.add(project.id);
    }
  }

  state.expandedDeletedFiles = nextExpandedDeletedFiles;
}

export function applyChapterPendingMutation(snapshot, mutation) {
  const normalizedSnapshot = sortProjectSnapshot(snapshot);
  const updateProject = (project) => {
    if (!project || project.id !== mutation.projectId || !Array.isArray(project.chapters)) {
      return project;
    }

    let changed = false;

    if (mutation.type === "permanentDelete") {
      const chapters = project.chapters.filter((chapter) => {
        const matches = chapter?.id === mutation.chapterId;
        if (matches) {
          changed = true;
        }
        return !matches;
      });
      return changed ? { ...project, chapters } : project;
    }

    const chapters = project.chapters.map((chapter) => {
      if (!chapter || chapter.id !== mutation.chapterId) {
        return chapter;
      }

      changed = true;
      if (mutation.type === "rename") {
        return {
          ...chapter,
          name: mutation.title,
        };
      }

      if (mutation.type === "softDelete") {
        return {
          ...chapter,
          status: "deleted",
        };
      }

      if (mutation.type === "restore") {
        return {
          ...chapter,
          status: "active",
        };
      }

      if (mutation.type === "setGlossaryLinks") {
        return {
          ...chapter,
          linkedGlossary: normalizeChapterGlossaryLink(mutation.glossary),
        };
      }

      return chapter;
    });

    return changed ? { ...project, chapters } : project;
  };

  return sortProjectSnapshot({
    items: normalizedSnapshot.items.map(updateProject),
    deletedItems: normalizedSnapshot.deletedItems.map(updateProject),
  });
}

function openChapterModal(render, chapterId, options) {
  const resolved = resolveChapterContext(render, chapterId, options.missingMessage);
  if (!resolved) {
    return;
  }

  if (!ensureChapterMutationAllowed(render, {
    selectedTeam: resolved.selectedTeam,
    actionLabel: options.actionLabel,
    requireDelete: options.requireDelete === true,
  })) {
    return;
  }

  options.applyState(resolved.context);
  render();
}

function updateChapterModalField(modalState, field, value) {
  modalState[field] = value;
  if (modalState.error) {
    modalState.error = "";
  }
}

function cancelChapterModal(render, reset) {
  reset();
  render();
}

export function openChapterRename(render, chapterId) {
  openChapterModal(render, chapterId, {
    missingMessage: "Could not find the selected file.",
    actionLabel: "rename files",
    applyState: (context) => {
      state.chapterRename = {
        isOpen: true,
        projectId: context.project.id,
        chapterId,
        chapterName: context.chapter.name,
        status: "idle",
        error: "",
      };
    },
  });
}

export function updateChapterRenameName(chapterName) {
  updateChapterModalField(state.chapterRename, "chapterName", chapterName);
}

export function openChapterPermanentDeletion(render, chapterId) {
  openChapterModal(render, chapterId, {
    missingMessage: "Could not find the selected deleted file.",
    actionLabel: "permanently delete files",
    applyState: (context) => {
      state.chapterPermanentDeletion = {
        isOpen: true,
        projectId: context.project.id,
        chapterId,
        chapterName: context.chapter.name,
        confirmationText: "",
        status: "idle",
        error: "",
      };
    },
  });
}

export function updateChapterPermanentDeletionConfirmation(value) {
  updateChapterModalField(state.chapterPermanentDeletion, "confirmationText", value);
}

export function cancelChapterRename(render) {
  cancelChapterModal(render, resetChapterRename);
}

export function cancelChapterPermanentDeletion(render) {
  cancelChapterModal(render, resetChapterPermanentDeletion);
}

export function toggleDeletedFiles(render, projectId) {
  const project =
    state.projects.find((item) => item.id === projectId)
    ?? state.deletedProjects.find((item) => item.id === projectId);
  const deletedCount = Array.isArray(project?.chapters)
    ? project.chapters.filter((chapter) => chapter?.status === "deleted").length
    : 0;

  if (deletedCount === 0) {
    state.expandedDeletedFiles.delete(projectId);
    render();
    return;
  }

  if (state.expandedDeletedFiles.has(projectId)) {
    state.expandedDeletedFiles.delete(projectId);
  } else {
    state.expandedDeletedFiles.add(projectId);
  }
  render();
}

export async function submitChapterRename(render) {
  const resolved = await resolveChapterMutationContext(render, state.chapterRename.chapterId, {
    actionLabel: "rename files",
  });
  const nextTitle = state.chapterRename.chapterName.trim();

  if (!resolved) {
    state.chapterRename.error = "Could not find the selected file.";
    render();
    return;
  }

  const { selectedTeam, context } = resolved;

  if (!nextTitle) {
    state.chapterRename.error = "Enter a file name.";
    render();
    return;
  }

  const mutation = {
    id: crypto.randomUUID(),
    type: "rename",
    projectId: context.project.id,
    chapterId: context.chapter.id,
    title: nextTitle,
  };
  resetChapterRename();
  startOptimisticChapterMutation({
    render,
    selectedTeam,
    context,
    mutation,
    applyOptimistic: () => {
      updateChapterInState(context.chapter.id, (chapter) => ({
        ...chapter,
        name: nextTitle,
      }));
      if (state.editorChapter?.chapterId === context.chapter.id) {
        state.editorChapter = {
          ...state.editorChapter,
          fileTitle: nextTitle,
        };
      }
    },
    optimisticDebugText: "Optimistic file rename applied",
    remoteDebugText: "Saving file...",
    beforeReconcile: async () => {
      setProjectUiDebug(render, "Background sync started");
    },
    rollback: async (error) => {
      state.chapterRename = {
        isOpen: true,
        projectId: context.project.id,
        chapterId: context.chapter.id,
        chapterName: nextTitle,
        status: "idle",
        error: error?.message ?? String(error),
      };
      if (state.editorChapter?.chapterId === context.chapter.id) {
        state.editorChapter = {
          ...state.editorChapter,
          fileTitle: context.chapter.name,
        };
      }
    },
    runRemote: async () => invoke("rename_gtms_chapter", {
      input: {
        installationId: selectedTeam.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: context.chapter.id,
        title: nextTitle,
      },
    }),
    showFailureNotice: false,
  });
}

async function persistChapterGlossaryLinks(render, chapterId, nextGlossary) {
  const resolved = await resolveChapterMutationContext(render, chapterId, {
    actionLabel: "change file glossary links",
  });
  if (!resolved) {
    return;
  }

  const { selectedTeam, context } = resolved;

  const currentGlossary = normalizeChapterGlossaryLink(context.chapter.linkedGlossary);
  if (JSON.stringify(nextGlossary) === JSON.stringify(currentGlossary)) {
    return;
  }

  const mutation = {
    id: crypto.randomUUID(),
    type: "setGlossaryLinks",
    projectId: context.project.id,
    chapterId,
    glossary: nextGlossary,
  };

  startOptimisticChapterMutation({
    render,
    selectedTeam,
    context,
    mutation,
    applyOptimistic: () => {
      updateChapterInState(chapterId, (chapter) => ({
        ...chapter,
        linkedGlossary: nextGlossary,
      }));
    },
    runRemote: async () => invoke("update_gtms_chapter_glossary_links", {
      input: {
        installationId: selectedTeam.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId,
        glossary: chapterGlossaryLinkInput(nextGlossary),
      },
    }),
    beforeReconcile: async (payload) => {
      updateChapterInState(chapterId, (chapter) => ({
        ...chapter,
        linkedGlossary: normalizeChapterGlossaryLink(payload?.glossary),
      }));
      persistProjectsForTeam(selectedTeam);
    },
  });
}

export async function updateChapterGlossaryLinks(render, chapterId, glossaryId) {
  const context = findChapterContext(chapterId);
  if (!context?.chapter) {
    setProjectDiscoveryError(render, "Could not find the selected file.");
    return;
  }

  const nextLink = chapterGlossaryLinkFromGlossaryId(glossaryId);
  if (glossaryId && !nextLink) {
    showNoticeBadge("Could not find the selected glossary.", render);
    return;
  }

  await persistChapterGlossaryLinks(render, chapterId, nextLink);
}

async function submitSimpleChapterMutation(render, chapterId, options) {
  const resolved = await resolveChapterMutationContext(render, chapterId, {
    missingMessage: options.missingMessage,
    actionLabel: options.actionLabel,
    requireDelete: options.requireDelete === true,
  });
  if (!resolved) {
    return;
  }

  const { selectedTeam, context } = resolved;
  const mutation = options.buildMutation(context);
  startOptimisticChapterMutation({
    render,
    selectedTeam,
    context,
    mutation,
    applyOptimistic: () => options.applyOptimistic(mutation),
    optimisticDebugText: options.optimisticDebugText,
    remoteDebugText: options.remoteDebugText ?? "Background sync started",
    runRemote: async () => invoke(options.command, {
      input: {
        installationId: selectedTeam.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId,
      },
    }),
  });
}

export async function deleteChapter(render, chapterId) {
  await submitSimpleChapterMutation(render, chapterId, {
    actionLabel: "delete files",
    buildMutation: (context) => ({
      id: crypto.randomUUID(),
      type: "softDelete",
      projectId: context.project.id,
      chapterId,
    }),
    applyOptimistic: () => {
      setProjectUiDebug(render, "Delete clicked");
      updateChapterInState(chapterId, (chapter) => ({
        ...chapter,
        status: "deleted",
      }));
      reconcileExpandedDeletedFiles();
    },
    optimisticDebugText: "Optimistic delete applied",
    command: "soft_delete_gtms_chapter",
  });
}

export async function restoreChapter(render, chapterId) {
  await submitSimpleChapterMutation(render, chapterId, {
    missingMessage: "Could not find the selected deleted file.",
    actionLabel: "restore files",
    buildMutation: (context) => ({
      id: crypto.randomUUID(),
      type: "restore",
      projectId: context.project.id,
      chapterId,
    }),
    applyOptimistic: () => {
      setProjectUiDebug(render, "Restore clicked");
      updateChapterInState(chapterId, (chapter) => ({
        ...chapter,
        status: "active",
      }));
      reconcileExpandedDeletedFiles();
    },
    optimisticDebugText: "Optimistic restore applied",
    command: "restore_gtms_chapter",
  });
}

export async function permanentlyDeleteChapter(render, chapterId) {
  await submitSimpleChapterMutation(render, chapterId, {
    missingMessage: "Could not find the selected deleted file.",
    actionLabel: "permanently delete files",
    requireDelete: true,
    buildMutation: (context) => ({
      id: crypto.randomUUID(),
      type: "permanentDelete",
      projectId: context.project.id,
      chapterId,
    }),
    applyOptimistic: (mutation) => {
      setProjectUiDebug(render, "Permanent delete clicked");
      const nextSnapshot = applyChapterPendingMutation(
        { items: state.projects, deletedItems: state.deletedProjects },
        mutation,
      );
      applyProjectSnapshotToState(nextSnapshot, { reconcileExpandedDeletedFiles });
    },
    optimisticDebugText: "Optimistic permanent delete applied",
    command: "permanently_delete_gtms_chapter",
  });
}

export async function confirmChapterPermanentDeletion(render) {
  const selectedTeam = selectedProjectsTeam();
  const context = findChapterContext(state.chapterPermanentDeletion.chapterId);

  if (!Number.isFinite(selectedTeam?.installationId) || !context?.project || !context?.chapter) {
    state.chapterPermanentDeletion.status = "idle";
    state.chapterPermanentDeletion.error = "Could not find the selected deleted file.";
    render();
    return;
  }

  if (state.offline?.isEnabled === true) {
    state.chapterPermanentDeletion.status = "idle";
    state.chapterPermanentDeletion.error = "You cannot permanently delete files while offline.";
    render();
    return;
  }

  if (!canPermanentlyDeleteProjectFiles(selectedTeam)) {
    state.chapterPermanentDeletion.status = "idle";
    state.chapterPermanentDeletion.error =
      "You do not have permission to permanently delete files in this team.";
    render();
    return;
  }

  if (
    normalizedConfirmationValue(state.chapterPermanentDeletion.confirmationText)
    !== normalizedConfirmationValue(state.chapterPermanentDeletion.chapterName)
  ) {
    state.chapterPermanentDeletion.error = "File name confirmation does not match.";
    render();
    return;
  }

  state.chapterPermanentDeletion.status = "loading";
  state.chapterPermanentDeletion.error = "";
  render();
  await waitForNextPaint();
  const chapterId = state.chapterPermanentDeletion.chapterId;
  resetChapterPermanentDeletion();
  render();
  await permanentlyDeleteChapter(render, chapterId);
}
