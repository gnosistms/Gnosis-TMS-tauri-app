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
import {
  areResourcePageWritesDisabled,
  areResourcePageWriteSubmissionsDisabled,
} from "./resource-page-controller.js";
import { normalizedConfirmationValue } from "./resource-entity-modal.js";
import {
  applyProjectSnapshotToState,
  sortProjectSnapshot,
} from "./project-top-level-state.js";
import {
  refreshProjectFilesFromDisk as runRefreshProjectFilesFromDisk,
} from "./project-discovery-flow.js";
import {
  findChapterContext,
  findChapterContextById,
  selectedProjectsTeam,
} from "./project-context.js";
import {
  applyProjectWriteIntentsToSnapshot,
  anyProjectWriteIsActive,
  chapterGlossaryIntentKey,
  chapterLifecycleIntentKey,
  chapterTitleIntentKey,
  clearConfirmedProjectWriteIntents,
  projectRepoSyncIntentKey,
  projectRepoWriteScope,
  requestProjectWriteIntent,
} from "./project-write-coordinator.js";

export {
  findChapterContext,
  findChapterContextById,
  selectedProjectsTeam,
};

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

function chapterWriteBlockedMessage() {
  return "Wait for the current projects refresh or write to finish.";
}

function chapterLifecycleWriteBlockedMessage() {
  return "Wait for the current project write to finish.";
}

function ensureChapterMutationAllowed(
  render,
  {
    selectedTeam = selectedProjectsTeam(),
    actionLabel = "modify files",
    requireDelete = false,
    allowDuringRefresh = false,
  } = {},
) {
  const writesDisabled = allowDuringRefresh
    ? areResourcePageWriteSubmissionsDisabled(state.projectsPage)
    : areResourcePageWritesDisabled(state.projectsPage);
  if (writesDisabled) {
    setProjectDiscoveryError(
      render,
      allowDuringRefresh ? chapterLifecycleWriteBlockedMessage() : chapterWriteBlockedMessage(),
    );
    return false;
  }

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
    preserveProjectLifecyclePatches: (snapshot) => {
      clearConfirmedProjectWriteIntents(snapshot);
      return applyProjectWriteIntentsToSnapshot(
        preserveChapterLifecyclePatchesInProjectSnapshot(
          snapshot,
          { items: state.projects, deletedItems: state.deletedProjects },
        ),
      );
    },
    persistProjectsForTeam,
    reconcileExpandedDeletedFiles,
  });
}

function findProjectForRepoSync(projectId) {
  return (
    state.projects.find((project) => project?.id === projectId)
    ?? state.deletedProjects.find((project) => project?.id === projectId)
    ?? null
  );
}

function scheduleProjectRepoSyncAfterLocalWrite(render, selectedTeam, project) {
  if (
    state.offline?.isEnabled === true
    || !Number.isFinite(selectedTeam?.installationId)
    || typeof project?.id !== "string"
    || !project.id.trim()
  ) {
    return;
  }

  const projectId = project.id;
  const teamId = selectedTeam.id;
  requestProjectWriteIntent({
    key: projectRepoSyncIntentKey(projectId),
    scope: projectRepoWriteScope(selectedTeam, projectId),
    teamId,
    projectId,
    type: "projectRepoSync",
    value: {
      requestedAt: Date.now(),
    },
  }, {
    clearOnSuccess: true,
    run: async () => {
      if (state.selectedTeamId !== teamId) {
        return;
      }
      const latestProject = findProjectForRepoSync(projectId) ?? project;
      await reconcileProjectRepoSyncStates(render, selectedTeam, [latestProject], {
        shouldAbort: () => state.selectedTeamId !== teamId,
      });
      if (state.selectedTeamId !== teamId) {
        return;
      }
      await refreshProjectFilesFromDisk(render, selectedTeam, [latestProject]);
    },
    onError: (error) => {
      showNoticeBadge(
        `Could not sync project repo: ${error?.message ?? String(error)}`,
        render,
        3600,
      );
    },
  });
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
    allowDuringRefresh: options.allowDuringRefresh === true,
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

function normalizeProjectSnapshotInput(snapshot) {
  const projectSnapshot = snapshot?.snapshot && typeof snapshot.snapshot === "object"
    ? snapshot.snapshot
    : snapshot;
  return {
    items: Array.isArray(projectSnapshot?.items) ? projectSnapshot.items : [],
    deletedItems: Array.isArray(projectSnapshot?.deletedItems) ? projectSnapshot.deletedItems : [],
  };
}

function chapterLifecycleIntent(chapter) {
  if (typeof chapter?.pendingMutation === "string" && chapter.pendingMutation.trim()) {
    return chapter.pendingMutation.trim();
  }
  if (typeof chapter?.localLifecycleIntent === "string" && chapter.localLifecycleIntent.trim()) {
    return chapter.localLifecycleIntent.trim();
  }
  return "";
}

function chapterSnapshotValue(snapshot, projectId, chapterId, key) {
  const current = normalizeProjectSnapshotInput(snapshot);
  for (const project of [...current.items, ...current.deletedItems]) {
    if (project?.id !== projectId || !Array.isArray(project.chapters)) {
      continue;
    }
    const chapter = project.chapters.find((item) => item?.id === chapterId);
    if (chapter) {
      return chapter[key];
    }
  }
  return undefined;
}

function patchChapterInSnapshot(snapshot, projectId, chapterId, patch, fallbackChapter = null) {
  const current = normalizeProjectSnapshotInput(snapshot);
  let projectFound = false;
  let chapterFound = false;
  const patchProject = (project) => {
    if (project?.id !== projectId || !Array.isArray(project.chapters)) {
      return project;
    }

    projectFound = true;
    const chapters = project.chapters.map((chapter) => {
      if (chapter?.id !== chapterId) {
        return chapter;
      }
      chapterFound = true;
      return {
        ...chapter,
        ...patch,
      };
    });

    return {
      ...project,
      chapters: chapterFound || !fallbackChapter
        ? chapters
        : [...chapters, { ...fallbackChapter, ...patch }],
    };
  };

  const items = current.items.map(patchProject);
  const deletedItems = current.deletedItems.map(patchProject);
  if (!projectFound || chapterFound || !fallbackChapter) {
    return { items, deletedItems };
  }

  return { items, deletedItems };
}

export function preserveChapterLifecyclePatchesInProjectSnapshot(nextSnapshot, previousSnapshot) {
  if (!nextSnapshot || typeof nextSnapshot !== "object") {
    return nextSnapshot;
  }

  const previousProjects = [
    ...normalizeProjectSnapshotInput(previousSnapshot).items,
    ...normalizeProjectSnapshotInput(previousSnapshot).deletedItems,
  ];
  const pendingChapters = [];
  for (const project of previousProjects) {
    if (!project?.id || !Array.isArray(project.chapters)) {
      continue;
    }
    for (const chapter of project.chapters) {
      const intent = chapterLifecycleIntent(chapter);
      if (typeof chapter?.id === "string" && intent) {
        pendingChapters.push({ projectId: project.id, chapter, intent });
      }
    }
  }
  if (pendingChapters.length === 0) {
    return normalizeProjectSnapshotInput(nextSnapshot);
  }

  let nextData = normalizeProjectSnapshotInput(nextSnapshot);
  for (const pendingChapter of pendingChapters) {
    const { projectId, chapter, intent } = pendingChapter;
    const isPending = typeof chapter?.pendingMutation === "string" && chapter.pendingMutation.trim();

    if (intent === "rename") {
      if (!isPending && chapterSnapshotValue(nextData, projectId, chapter.id, "name") === chapter.name) {
        continue;
      }
      nextData = patchChapterInSnapshot(nextData, projectId, chapter.id, {
        name: chapter.name,
        pendingMutation: isPending ? "rename" : null,
        localLifecycleIntent: "rename",
      }, chapter);
      continue;
    }

    if (intent === "softDelete") {
      if (!isPending && chapterSnapshotValue(nextData, projectId, chapter.id, "status") === "deleted") {
        continue;
      }
      nextData = patchChapterInSnapshot(nextData, projectId, chapter.id, {
        status: "deleted",
        pendingMutation: isPending ? "softDelete" : null,
        localLifecycleIntent: "softDelete",
      }, chapter);
      continue;
    }

    if (intent === "restore") {
      if (!isPending && chapterSnapshotValue(nextData, projectId, chapter.id, "status") === "active") {
        continue;
      }
      nextData = patchChapterInSnapshot(nextData, projectId, chapter.id, {
        status: "active",
        pendingMutation: isPending ? "restore" : null,
        localLifecycleIntent: "restore",
      }, chapter);
    }
  }

  return nextData;
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
  markSettledLocalIntent,
  rollback,
  runRemote,
  showFailureNotice = true,
}) {
  const snapshot = cloneProjectCollections();
  const refreshWasActive = state.projectsPage?.isRefreshing === true;

  state.projectSyncVersion += 1;
  state.projectsPage.writeState = "submitting";
  applyOptimistic?.();
  if (!refreshWasActive) {
    beginProjectsPageSync();
  }
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
      markSettledLocalIntent?.(payload);
      persistProjectsForTeam(selectedTeam);
      completeChapterMutation(selectedTeam, mutation.id);
      await beforeReconcile?.(payload);
      await reconcileProjectRepoSyncStates(render, selectedTeam, [context.project]);
      await refreshProjectFilesFromDisk(render, selectedTeam, [context.project]);
      clearProjectUiDebug(render);
      state.projectsPage.writeState = "idle";
      if (!refreshWasActive) {
        await completeProjectsPageSync(render);
      }
      render();
    } catch (error) {
      completeChapterMutation(selectedTeam, mutation.id);
      restoreProjectCollections(snapshot);
      await rollback?.(error);
      persistProjectsForTeam(selectedTeam);
      clearProjectUiDebug(render);
      state.projectsPage.writeState = "idle";
      if (!refreshWasActive) {
        failProjectsPageSync();
      }
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
          pendingMutation: "rename",
          localLifecycleIntent: null,
        };
      }

      if (mutation.type === "softDelete") {
        return {
          ...chapter,
          status: "deleted",
          pendingMutation: "softDelete",
          localLifecycleIntent: null,
        };
      }

      if (mutation.type === "restore") {
        return {
          ...chapter,
          status: "active",
          pendingMutation: "restore",
          localLifecycleIntent: null,
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
    allowDuringRefresh: options.allowDuringRefresh === true,
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
    allowDuringRefresh: true,
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
    allowDuringRefresh: true,
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

  resetChapterRename();
  requestProjectWriteIntent({
    key: chapterTitleIntentKey(context.project.id, context.chapter.id),
    scope: projectRepoWriteScope(selectedTeam, context.project.id),
    teamId: selectedTeam.id,
    projectId: context.project.id,
    chapterId: context.chapter.id,
    type: "chapterTitle",
    value: {
      title: nextTitle,
    },
    previousValue: {
      title: context.chapter.name,
    },
  }, {
    applyOptimistic: (intent) => {
      updateChapterInState(context.chapter.id, (chapter) => ({
        ...chapter,
        name: intent.value.title,
        pendingMutation: "rename",
      }));
      if (state.editorChapter?.chapterId === context.chapter.id) {
        state.editorChapter = {
          ...state.editorChapter,
          fileTitle: intent.value.title,
        };
      }
      persistProjectsForTeam(selectedTeam);
      render();
    },
    run: async (intent) => invoke("rename_gtms_chapter", {
      input: {
        installationId: selectedTeam.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: context.chapter.id,
        title: intent.value.title,
      },
    }),
    onSuccess: (intent) => {
      updateChapterInState(context.chapter.id, (chapter) => ({
        ...chapter,
        name: intent.value.title,
        pendingMutation: null,
        localLifecycleIntent: "rename",
      }));
      if (state.editorChapter?.chapterId === context.chapter.id) {
        state.editorChapter = {
          ...state.editorChapter,
          fileTitle: intent.value.title,
        };
      }
      persistProjectsForTeam(selectedTeam);
      scheduleProjectRepoSyncAfterLocalWrite(render, selectedTeam, context.project);
    },
    onError: (error) => {
      state.chapterRename = {
        isOpen: true,
        projectId: context.project.id,
        chapterId: context.chapter.id,
        chapterName: nextTitle,
        status: "idle",
        error: error?.message ?? String(error),
      };
      render();
    },
  });
}

async function persistChapterGlossaryLinks(render, chapterId, nextGlossary) {
  const resolved = await resolveChapterMutationContext(render, chapterId, {
    actionLabel: "change file glossary links",
    allowDuringRefresh: true,
  });
  if (!resolved) {
    return;
  }

  const { selectedTeam, context } = resolved;

  const currentGlossary = normalizeChapterGlossaryLink(context.chapter.linkedGlossary);
  if (JSON.stringify(nextGlossary) === JSON.stringify(currentGlossary)) {
    return;
  }

  requestProjectWriteIntent({
    key: chapterGlossaryIntentKey(context.project.id, chapterId),
    scope: projectRepoWriteScope(selectedTeam, context.project.id),
    teamId: selectedTeam.id,
    projectId: context.project.id,
    chapterId,
    type: "chapterGlossary",
    value: {
      glossary: nextGlossary,
    },
    previousValue: {
      glossary: currentGlossary,
    },
  }, {
    applyOptimistic: (intent) => {
      updateChapterInState(chapterId, (chapter) => ({
        ...chapter,
        linkedGlossary: intent.value.glossary,
        pendingGlossaryMutation: true,
      }));
      persistProjectsForTeam(selectedTeam);
      render();
    },
    run: async (intent) => invoke("update_gtms_chapter_glossary_links", {
      input: {
        installationId: selectedTeam.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId,
        glossary: chapterGlossaryLinkInput(intent.value.glossary),
      },
    }),
    onSuccess: (intent) => {
      updateChapterInState(chapterId, (chapter) => ({
        ...chapter,
        linkedGlossary: intent.value.glossary,
        pendingGlossaryMutation: false,
      }));
      persistProjectsForTeam(selectedTeam);
      scheduleProjectRepoSyncAfterLocalWrite(render, selectedTeam, context.project);
    },
    onError: (error, intent) => {
      updateChapterInState(chapterId, (chapter) => ({
        ...chapter,
        pendingGlossaryMutation: false,
        glossaryMutationError: error?.message ?? String(error),
      }));
      setProjectDiscoveryError(render, intent.error || error?.message || String(error));
      persistProjectsForTeam(selectedTeam);
      render();
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
    allowDuringRefresh: options.allowDuringRefresh === true,
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
    markSettledLocalIntent: options.markSettledLocalIntent
      ? () => options.markSettledLocalIntent(mutation)
      : undefined,
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

async function submitCoordinatedChapterLifecycleMutation(render, chapterId, options) {
  const resolved = await resolveChapterMutationContext(render, chapterId, {
    missingMessage: options.missingMessage,
    actionLabel: options.actionLabel,
    allowDuringRefresh: true,
  });
  if (!resolved) {
    return;
  }

  const { selectedTeam, context } = resolved;
  const nextStatus = options.status === "deleted" ? "deleted" : "active";
  const pendingMutation = nextStatus === "deleted" ? "softDelete" : "restore";

  requestProjectWriteIntent({
    key: chapterLifecycleIntentKey(context.project.id, chapterId),
    scope: projectRepoWriteScope(selectedTeam, context.project.id),
    teamId: selectedTeam.id,
    projectId: context.project.id,
    chapterId,
    type: "chapterLifecycle",
    value: {
      status: nextStatus,
    },
    previousValue: {
      status: context.chapter.status === "deleted" ? "deleted" : "active",
    },
  }, {
    applyOptimistic: (intent) => {
      setProjectUiDebug(render, options.debugText);
      updateChapterInState(chapterId, (chapter) => ({
        ...chapter,
        status: intent.value.status,
        pendingMutation,
      }));
      reconcileExpandedDeletedFiles();
      persistProjectsForTeam(selectedTeam);
      render();
    },
    run: async () => invoke(options.command, {
      input: {
        installationId: selectedTeam.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId,
      },
    }),
    onSuccess: (intent) => {
      updateChapterInState(chapterId, (chapter) => ({
        ...chapter,
        status: intent.value.status,
        pendingMutation: null,
        localLifecycleIntent: pendingMutation,
      }));
      reconcileExpandedDeletedFiles();
      persistProjectsForTeam(selectedTeam);
      scheduleProjectRepoSyncAfterLocalWrite(render, selectedTeam, context.project);
    },
    onError: (error) => {
      setProjectDiscoveryError(render, error?.message ?? String(error));
    },
  });
}

export async function deleteChapter(render, chapterId) {
  await submitCoordinatedChapterLifecycleMutation(render, chapterId, {
    actionLabel: "delete files",
    status: "deleted",
    debugText: "Delete clicked",
    command: "soft_delete_gtms_chapter",
  });
}

export async function restoreChapter(render, chapterId) {
  await submitCoordinatedChapterLifecycleMutation(render, chapterId, {
    missingMessage: "Could not find the selected deleted file.",
    actionLabel: "restore files",
    status: "active",
    debugText: "Restore clicked",
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

  if (areResourcePageWritesDisabled(state.projectsPage) || anyProjectWriteIsActive()) {
    state.chapterPermanentDeletion.status = "idle";
    state.chapterPermanentDeletion.error = chapterWriteBlockedMessage();
    render();
    return;
  }

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
