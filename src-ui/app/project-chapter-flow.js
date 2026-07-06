import { invoke, waitForNextPaint } from "./runtime.js";
import { anchorProjectsSessionToItem } from "./projects-scroll-session.js";
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
  resetProjectClearDeletedFiles,
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
import { canManageProjects, canPermanentlyDeleteProjectFiles } from "./resource-capabilities.js";
import { getProjectWritePolicy } from "./resource-write-policy.js";
import { addLocalHardDeleteTombstone } from "./local-hard-delete-store.js";
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
  applyProjectsQuerySnapshotToState,
  createProjectsQuerySnapshot,
} from "./project-query.js";
import {
  projectKeys,
  queryClient,
} from "./query-client.js";
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
  chapterGlossaryIntentKey,
  chapterWorkflowStatusIntentKey,
  chapterLifecycleIntentKey,
  chapterTitleIntentKey,
  clearConfirmedProjectWriteIntents,
  projectRepoSyncIntentKey,
  projectRepoWriteScope,
  requestProjectWriteIntent,
} from "./project-write-coordinator.js";
import { enqueueRepoWrite } from "./repo-write-queue.js";
import { resourceHasPendingLifecycleMutation } from "./project-page-write-state.js";
import {
  chapterGlossaryLinkFromGlossaryId,
  chapterGlossaryLinkInput,
} from "./project-glossary-flow.js";
import { normalizeChapterWorkflowStatus } from "./chapter-workflow-status.js";

export {
  findChapterContext,
  findChapterContextById,
  selectedProjectsTeam,
};

export function setProjectUiDebug(render, text) {
  showProjectsStatus(render, text);
}

export function clearProjectUiDebug(render) {
  clearProjectsStatus(render);
}

export function showProjectsStatus(render, text) {
  if (typeof text !== "string" || !text.trim()) {
    return;
  }
  showScopedSyncBadge("projects", text, render);
}

export function clearProjectsStatus(render) {
  clearScopedSyncBadge("projects", render);
}

export function showProjectsNotice(render, text, durationMs) {
  showNoticeBadge(text, render, durationMs);
}

const GLOSSARY_REPO_SYNC_DEBOUNCE_MS = 2500;
// Dirty projects awaiting a deferred repo sync, keyed per project. The timer
// is shared per team (installation): every metadata write on any project
// restarts one quiet period, so a click burst across projects produces zero
// mid-burst syncs and a single sync wave once the user pauses.
const deferredProjectRepoSyncs = new Map();
const deferredProjectRepoSyncTimers = new Map();

function deferredProjectRepoSyncTeamKey(selectedTeam) {
  return Number.isFinite(selectedTeam?.installationId)
    ? String(selectedTeam.installationId)
    : "unknown";
}

function deferredProjectRepoSyncKey(selectedTeam, project) {
  const projectId =
    typeof project?.id === "string" && project.id.trim()
      ? project.id.trim()
      : "unknown";
  return `${deferredProjectRepoSyncTeamKey(selectedTeam)}:${projectId}`;
}

function clearDeferredProjectRepoSync(selectedTeam, project) {
  deferredProjectRepoSyncs.delete(deferredProjectRepoSyncKey(selectedTeam, project));
}

export function resetDeferredProjectRepoSyncsForTests() {
  deferredProjectRepoSyncs.clear();
  for (const timerId of deferredProjectRepoSyncTimers.values()) {
    window.clearTimeout(timerId);
  }
  deferredProjectRepoSyncTimers.clear();
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

function projectHasPendingDeletedChapterMutation(project) {
  return (Array.isArray(project?.chapters) ? project.chapters : [])
    .some((chapter) => chapter?.status === "deleted" && resourceHasPendingLifecycleMutation(chapter));
}

function ensureChapterMutationAllowed(
  render,
  {
    selectedTeam = selectedProjectsTeam(),
    actionLabel = "modify files",
    requireDelete = false,
    allowDuringRefresh = false,
    localOnly = false,
  } = {},
) {
  // Local-only mutations (e.g. local hard-delete) don't touch the remote, so — like
  // explicitly refresh-safe lifecycle actions — they only need to wait for in-flight
  // write submissions, not a background refresh.
  const allowDuringRefreshEffective = allowDuringRefresh || localOnly;
  const writesDisabled = allowDuringRefreshEffective
    ? areResourcePageWriteSubmissionsDisabled(state.projectsPage)
    : areResourcePageWritesDisabled(state.projectsPage);
  if (writesDisabled) {
    setProjectDiscoveryError(
      render,
      allowDuringRefreshEffective ? chapterLifecycleWriteBlockedMessage() : chapterWriteBlockedMessage(),
    );
    return false;
  }

  if (!localOnly && state.offline?.isEnabled === true) {
    setProjectDiscoveryError(render, `You cannot ${actionLabel} while offline.`);
    return false;
  }

  if (localOnly) {
    if (!selectedTeam) {
      setProjectDiscoveryError(render, "Could not determine the selected team.");
      return false;
    }
    return true;
  }

  if (!Number.isFinite(selectedTeam?.installationId)) {
    setProjectDiscoveryError(render, "Could not determine the selected team.");
    return false;
  }

  if (requireDelete ? !canPermanentlyDeleteProjectFiles(selectedTeam) : !canManageProjects(selectedTeam)) {
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
    status:
      chapter.status === "deleted" || chapter.status === "softDeleted"
        ? "deleted"
        : "active",
    languages: Array.isArray(chapter.languages) ? chapter.languages : [],
    wordCounts:
      chapter.wordCounts && typeof chapter.wordCounts === "object"
        ? chapter.wordCounts
        : {},
    selectedSourceLanguageCode:
      typeof chapter.selectedSourceLanguageCode === "string" && chapter.selectedSourceLanguageCode.trim()
        ? chapter.selectedSourceLanguageCode
        : null,
    selectedTargetLanguageCode:
      typeof chapter.selectedTargetLanguageCode === "string" && chapter.selectedTargetLanguageCode.trim()
        ? chapter.selectedTargetLanguageCode
        : null,
    workflowStatus: normalizeChapterWorkflowStatus(chapter.workflowStatus),
    linkedGlossary: normalizeChapterGlossaryLink(chapter.linkedGlossary),
    hasImportedEditorConflicts: chapter.hasImportedEditorConflicts === true,
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

  await enqueueRepoWrite({
    scope: projectRepoWriteScope(selectedTeam, projectId, projectName),
    kind: "projectLocalRepoPurge",
    sourceScreen: "projects",
    errorTarget: {
      projectId,
      kind: "projectLocalRepoPurge",
    },
    run: () => invoke("purge_local_gtms_project_repo", {
      input: {
        installationId: selectedTeam.installationId,
        projectId,
        repoName: projectName,
      },
    }),
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
  const publishProjectLoadSnapshot = ({
    snapshot,
    pendingChapterMutations,
    repoSyncByProjectId,
    persist = false,
  }) => {
    if (!selectedTeam?.id) {
      return;
    }
    const currentQueryData = queryClient.getQueryData(projectKeys.byTeam(selectedTeam.id));
    const nextQueryData = createProjectsQuerySnapshot({
      items: snapshot.items,
      deletedItems: snapshot.deletedItems,
      repoSyncByProjectId,
      glossaries: Array.isArray(currentQueryData?.glossaries)
        ? currentQueryData.glossaries
        : state.glossaries,
      pendingChapterMutations,
      discovery: state.projectDiscovery,
    });
    queryClient.setQueryData(projectKeys.byTeam(selectedTeam.id), nextQueryData);
    applyProjectsQuerySnapshotToState(nextQueryData, {
      teamId: selectedTeam.id,
      isFetching: state.projectsPage?.isRefreshing === true,
      reconcileExpandedDeletedFiles,
    });
    if (persist) {
      persistProjectsForTeam(selectedTeam);
    }
    render?.();
  };
  const refreshedSnapshot = await runRefreshProjectFilesFromDisk(render, selectedTeam, projects, {
    applyChapterPendingMutation,
    baseSnapshot: {
      items: state.projects,
      deletedItems: state.deletedProjects,
    },
    normalizeListedChapter,
    pendingChapterMutations: state.pendingChapterMutations,
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
    publishProjectLoadSnapshot,
    reconcileExpandedDeletedFiles,
    repoSyncByProjectId: state.projectRepoSyncByProjectId,
  });
  return refreshedSnapshot;
}

function findProjectForRepoSync(projectId) {
  return (
    state.projects.find((project) => project?.id === projectId)
    ?? state.deletedProjects.find((project) => project?.id === projectId)
    ?? null
  );
}

function projectDeletedChapters(project) {
  return Array.isArray(project?.chapters)
    ? project.chapters.filter((chapter) => chapter?.status === "deleted")
    : [];
}

export function updateProjectQueryCache(selectedTeam) {
  if (!selectedTeam?.id) {
    return;
  }

  const currentQueryData = queryClient.getQueryData(projectKeys.byTeam(selectedTeam.id));
  queryClient.setQueryData(
    projectKeys.byTeam(selectedTeam.id),
    createProjectsQuerySnapshot({
      items: state.projects,
      deletedItems: state.deletedProjects,
      repoSyncByProjectId: state.projectRepoSyncByProjectId,
      glossaries: Array.isArray(currentQueryData?.glossaries)
        ? currentQueryData.glossaries
        : state.glossaries,
      pendingChapterMutations: state.pendingChapterMutations,
      discovery: state.projectDiscovery,
    }),
  );
}

function removeChaptersFromProjectState(projectId, chapterIds) {
  const ids = new Set(
    (Array.isArray(chapterIds) ? chapterIds : [])
      .map((chapterId) => String(chapterId ?? "").trim())
      .filter(Boolean),
  );
  if (ids.size === 0) {
    return;
  }

  const removeFromProject = (project) => {
    if (project?.id !== projectId || !Array.isArray(project.chapters)) {
      return project;
    }

    return {
      ...project,
      chapters: project.chapters.filter((chapter) => !ids.has(chapter?.id)),
    };
  };

  state.projects = state.projects.map(removeFromProject);
  state.deletedProjects = state.deletedProjects.map(removeFromProject);
  if (state.selectedChapterId && ids.has(state.selectedChapterId)) {
    state.selectedChapterId = null;
  }
}

export function applyProjectClearDeletedFilesResult(selectedTeam, projectId, chapterIds) {
  removeChaptersFromProjectState(projectId, chapterIds);
  reconcileExpandedDeletedFiles();
  persistProjectsForTeam(selectedTeam);
  updateProjectQueryCache(selectedTeam);
}

function scheduleProjectRepoSyncAfterLocalWrite(render, selectedTeam, project, options = {}) {
  clearDeferredProjectRepoSync(selectedTeam, project);

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
    scope: projectRepoWriteScope(selectedTeam, project),
    teamId,
    projectId,
    type: "projectRepoSync",
    value: {
      requestedAt: Date.now(),
    },
  }, {
    clearOnSuccess: true,
    // This intent only coordinates a sync; the actual repo work is serialized by the
    // reconcile operations it enqueues. Running it inside the repo write queue would
    // deadlock, because reconcileProjectRepoSyncStates enqueues on this same scope and
    // would wait behind this intent.
    useRepoWriteQueue: false,
    run: async () => {
      if (state.selectedTeamId !== teamId) {
        return;
      }
      const latestProject = findProjectForRepoSync(projectId) ?? project;
      showProjectsStatus(render, options.syncText ?? "Syncing project repo...");
      await reconcileProjectRepoSyncStates(render, selectedTeam, [latestProject], {
        shouldAbort: () => state.selectedTeamId !== teamId,
        clearStatusOnComplete: false,
      });
      if (state.selectedTeamId !== teamId) {
        return;
      }
      showProjectsStatus(render, options.refreshText ?? "Refreshing file list...");
      await refreshProjectFilesFromDisk(render, selectedTeam, [latestProject]);
      clearProjectsStatus(render);
      if (options.successNotice) {
        showProjectsNotice(render, options.successNotice);
      }
    },
    onError: (error) => {
      clearProjectsStatus(render);
      showNoticeBadge(
        `Could not sync project repo: ${error?.message ?? String(error)}`,
        render,
        3600,
      );
    },
  });
}

function scheduleDeferredProjectRepoSyncAfterLocalWrite(
  render,
  selectedTeam,
  project,
  options = {},
) {
  const teamKey = deferredProjectRepoSyncTeamKey(selectedTeam);
  const key = deferredProjectRepoSyncKey(selectedTeam, project);

  const delayMs =
    Number.isFinite(options.delayMs) && options.delayMs >= 0
      ? options.delayMs
      : GLOSSARY_REPO_SYNC_DEBOUNCE_MS;
  const syncOptions = { ...options };
  delete syncOptions.delayMs;

  deferredProjectRepoSyncs.set(key, {
    teamKey,
    render,
    selectedTeam,
    project,
    options: syncOptions,
  });

  // Restart the team's quiet period on every write, whichever project it
  // touched.
  const existingTimerId = deferredProjectRepoSyncTimers.get(teamKey);
  if (existingTimerId) {
    window.clearTimeout(existingTimerId);
  }
  const timerId = window.setTimeout(() => {
    if (deferredProjectRepoSyncTimers.get(teamKey) !== timerId) {
      return;
    }
    deferredProjectRepoSyncTimers.delete(teamKey);

    for (const [entryKey, entry] of [...deferredProjectRepoSyncs.entries()]) {
      if (entry.teamKey !== teamKey) {
        continue;
      }
      deferredProjectRepoSyncs.delete(entryKey);
      scheduleProjectRepoSyncAfterLocalWrite(
        entry.render,
        entry.selectedTeam,
        entry.project,
        entry.options,
      );
    }
  }, delayMs);
  deferredProjectRepoSyncTimers.set(teamKey, timerId);
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
    localOnly: options.localOnly === true,
  })) {
    return null;
  }

  const policy = getProjectWritePolicy({
    team: resolved.selectedTeam,
    project: resolved.context.project,
    chapter: resolved.context.chapter,
    actionKind:
      options.actionKind
      ?? (options.actionLabel === "restore files" ? "restoreChapter" : "sharedWrite"),
  });
  if (!policy.allowed) {
    setProjectDiscoveryError(render, policy.message);
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

function patchChapterInSnapshot(snapshot, projectId, chapterId, patch) {
  const current = normalizeProjectSnapshotInput(snapshot);
  let chapterFound = false;
  const patchProject = (project) => {
    if (project?.id !== projectId || !Array.isArray(project.chapters)) {
      return project;
    }

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
      chapters,
    };
  };

  const items = current.items.map(patchProject);
  const deletedItems = current.deletedItems.map(patchProject);
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
      });
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
      });
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
      });
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
  refreshText,
  successNotice,
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
    showProjectsStatus(render, optimisticDebugText);
  }

  void waitForNextPaint().then(async () => {
    try {
      if (remoteDebugText) {
        showProjectsStatus(render, remoteDebugText);
      }
      const payload = await runRemote();
      markSettledLocalIntent?.(payload);
      persistProjectsForTeam(selectedTeam);
      completeChapterMutation(selectedTeam, mutation.id);
      await beforeReconcile?.(payload);
      await reconcileProjectRepoSyncStates(render, selectedTeam, [context.project], {
        clearStatusOnComplete: false,
      });
      showProjectsStatus(render, refreshText ?? "Refreshing file list...");
      await refreshProjectFilesFromDisk(render, selectedTeam, [context.project]);
      clearProjectsStatus(render);
      state.projectsPage.writeState = "idle";
      if (!refreshWasActive) {
        await completeProjectsPageSync(render);
      }
      if (successNotice) {
        showProjectsNotice(render, successNotice);
      }
      render();
    } catch (error) {
      completeChapterMutation(selectedTeam, mutation.id);
      restoreProjectCollections(snapshot);
      await rollback?.(error);
      persistProjectsForTeam(selectedTeam);
      clearProjectsStatus(render);
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

      if (mutation.type === "setWorkflowStatus") {
        return {
          ...chapter,
          workflowStatus: normalizeChapterWorkflowStatus(mutation.workflowStatus),
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
    localOnly: options.localOnly === true,
  })) {
    return;
  }

  const policy = getProjectWritePolicy({
    team: resolved.selectedTeam,
    project: resolved.context.project,
    chapter: resolved.context.chapter,
    actionKind: options.actionKind ?? "sharedWrite",
  });
  if (!policy.allowed) {
    setProjectDiscoveryError(render, policy.message);
    return;
  }

  if (
    options.blockPendingLifecycle === true
    && resourceHasPendingLifecycleMutation(resolved.context.chapter)
  ) {
    setProjectDiscoveryError(render, chapterLifecycleWriteBlockedMessage());
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
    actionKind: "localHardDelete",
    localOnly: true,
    blockPendingLifecycle: true,
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

export async function openProjectClearDeletedFiles(render, projectId) {
  const selectedTeam = selectedProjectsTeam();
  const project = findProjectForRepoSync(projectId);

  if (!project) {
    setProjectDiscoveryError(render, "Could not find the selected project.");
    return;
  }

  // Local hard-delete is local-only; allow it during a background refresh (like Restore).
  if (areResourcePageWriteSubmissionsDisabled(state.projectsPage)) {
    setProjectDiscoveryError(render, chapterLifecycleWriteBlockedMessage());
    return;
  }

  if (projectHasPendingDeletedChapterMutation(project)) {
    setProjectDiscoveryError(render, chapterLifecycleWriteBlockedMessage());
    return;
  }

  const policy = getProjectWritePolicy({
    team: selectedTeam,
    project,
    actionKind: "localHardDelete",
  });
  if (!canPermanentlyDeleteProjectFiles(selectedTeam) || !policy.allowed) {
    setProjectDiscoveryError(
      render,
      policy.message || "You do not have permission to permanently delete files in this team.",
    );
    return;
  }

  if (await ensureProjectNotTombstoned(render, selectedTeam, project)) {
    return;
  }

  if (projectDeletedChapters(project).length === 0) {
    showProjectsNotice(render, "This project has no deleted files to clear.", 2200);
    reconcileExpandedDeletedFiles();
    render();
    return;
  }

  state.projectClearDeletedFiles = {
    isOpen: true,
    projectId: project.id,
    projectName: project.title ?? project.name,
    confirmationText: "",
    status: "idle",
    error: "",
  };
  render();
}

export function updateProjectClearDeletedFilesConfirmation(value) {
  updateChapterModalField(state.projectClearDeletedFiles, "confirmationText", value);
}

export function cancelProjectClearDeletedFiles(render) {
  cancelChapterModal(render, resetProjectClearDeletedFiles);
}

export async function confirmProjectClearDeletedFiles(render) {
  const selectedTeam = selectedProjectsTeam();
  const modal = state.projectClearDeletedFiles;
  const project = findProjectForRepoSync(modal.projectId);

  // Local hard-delete is local-only; allow it during a background refresh (like Restore).
  if (areResourcePageWriteSubmissionsDisabled(state.projectsPage)) {
    modal.status = "idle";
    modal.error = chapterLifecycleWriteBlockedMessage();
    render();
    return;
  }

  if (projectHasPendingDeletedChapterMutation(project)) {
    modal.status = "idle";
    modal.error = chapterLifecycleWriteBlockedMessage();
    render();
    return;
  }

  if (!selectedTeam || !project) {
    modal.status = "idle";
    modal.error = "Could not find the selected project.";
    render();
    return;
  }

  const policy = getProjectWritePolicy({
    team: selectedTeam,
    project,
    actionKind: "localHardDelete",
  });
  if (!canPermanentlyDeleteProjectFiles(selectedTeam) || !policy.allowed) {
    modal.status = "idle";
    modal.error = policy.message || "You do not have permission to permanently delete files in this team.";
    render();
    return;
  }

  if (
    normalizedConfirmationValue(modal.confirmationText)
    !== normalizedConfirmationValue(modal.projectName)
  ) {
    modal.status = "idle";
    modal.error = "Project name confirmation does not match.";
    render();
    return;
  }

  if (await ensureProjectNotTombstoned(render, selectedTeam, project)) {
    resetProjectClearDeletedFiles();
    render();
    return;
  }

  if (projectDeletedChapters(project).length === 0) {
    modal.status = "idle";
    modal.error = "This project has no deleted files to clear.";
    render();
    return;
  }

  try {
    modal.status = "loading";
    modal.error = "";
    showProjectsStatus(render, "Deleting files locally...");
    render();
    const deletedChapters = projectDeletedChapters(project);
    for (const chapter of deletedChapters) {
      addLocalHardDeleteTombstone(selectedTeam, "chapter", chapter);
    }
    const chapterIds = deletedChapters.map((chapter) => chapter.id).filter(Boolean);
    applyProjectClearDeletedFilesResult(selectedTeam, project.id, chapterIds);
    resetProjectClearDeletedFiles();
    showProjectsNotice(render, "Deleted files removed locally.");
  } catch (error) {
    modal.status = "idle";
    modal.error = error?.message ?? String(error);
  } finally {
    clearProjectsStatus(render);
    render();
  }
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

  // Pin the toggled separator at its current viewport offset so the deleted
  // rows unfold/fold beneath it instead of the list jumping.
  anchorProjectsSessionToItem(`dt:${projectId}`, state.selectedTeamId);
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
    scope: projectRepoWriteScope(selectedTeam, context.project),
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
      showProjectsStatus(render, "Renaming file...");
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
      scheduleProjectRepoSyncAfterLocalWrite(render, selectedTeam, context.project, {
        syncText: "Syncing project repo...",
        refreshText: "Refreshing file list...",
        successNotice: "File renamed.",
      });
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

// Chapter metadata fields (workflow status, glossary link) share one write
// pipeline. Every guard before the optimistic apply is synchronous so the UI
// updates in the same task as the select's change event — an async gap there
// lets an unrelated render repaint the select from stale state, which reads
// as the selection "reverting". The (async) tombstone verification runs
// inside the queued intent instead, where a failure flows through the normal
// onError rollback.
function chapterWorkflowStatusFieldSpec(nextWorkflowStatus) {
  return {
    actionLabel: "change file status",
    intentType: "chapterWorkflowStatus",
    intentKey: chapterWorkflowStatusIntentKey,
    nextValue: nextWorkflowStatus,
    readValue: (chapter) => normalizeChapterWorkflowStatus(chapter.workflowStatus),
    valuesEqual: (left, right) => left === right,
    wrapValue: (workflowStatus) => ({ workflowStatus }),
    unwrapValue: (value) => normalizeChapterWorkflowStatus(value?.workflowStatus),
    patchChapter: (workflowStatus) => ({ workflowStatus }),
    commandInput: (workflowStatus) => ({ workflowStatus }),
    command: "update_gtms_chapter_workflow_status",
    pendingFlag: "pendingWorkflowStatusMutation",
    errorField: "workflowStatusMutationError",
    pendingStatusText: "Updating file status...",
    confirmedStatusText: "Status updated. Syncing shortly...",
    successNotice: "Status updated.",
  };
}

function chapterGlossaryFieldSpec(nextGlossary) {
  return {
    actionLabel: "change file glossary links",
    intentType: "chapterGlossary",
    intentKey: chapterGlossaryIntentKey,
    nextValue: nextGlossary,
    readValue: (chapter) => normalizeChapterGlossaryLink(chapter.linkedGlossary),
    valuesEqual: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    wrapValue: (glossary) => ({ glossary }),
    unwrapValue: (value) => normalizeChapterGlossaryLink(value?.glossary),
    patchChapter: (glossary) => ({ linkedGlossary: glossary }),
    commandInput: (glossary) => ({ glossary: chapterGlossaryLinkInput(glossary) }),
    command: "update_gtms_chapter_glossary_links",
    pendingFlag: "pendingGlossaryMutation",
    errorField: "glossaryMutationError",
    pendingStatusText: "Updating file glossary...",
    confirmedStatusText: "Glossary updated. Syncing shortly...",
    successNotice: "Glossary updated.",
  };
}

function persistChapterMetadataField(render, chapterId, spec) {
  const resolved = resolveChapterContext(render, chapterId, "Could not find the selected file.");
  if (!resolved) {
    return;
  }

  const { selectedTeam, context } = resolved;
  if (!ensureChapterMutationAllowed(render, {
    selectedTeam,
    actionLabel: spec.actionLabel,
    allowDuringRefresh: true,
  })) {
    return;
  }

  const policy = getProjectWritePolicy({
    team: selectedTeam,
    project: context.project,
    chapter: context.chapter,
    actionKind: "sharedWrite",
  });
  if (!policy.allowed) {
    setProjectDiscoveryError(render, policy.message);
    return;
  }

  const currentValue = spec.readValue(context.chapter);
  if (spec.valuesEqual(spec.nextValue, currentValue)) {
    return;
  }

  requestProjectWriteIntent({
    key: spec.intentKey(context.project.id, chapterId),
    scope: projectRepoWriteScope(selectedTeam, context.project),
    teamId: selectedTeam.id,
    projectId: context.project.id,
    chapterId,
    type: spec.intentType,
    value: spec.wrapValue(spec.nextValue),
    previousValue: spec.wrapValue(currentValue),
  }, {
    applyOptimistic: (intent) => {
      showProjectsStatus(render, spec.pendingStatusText);
      updateChapterInState(chapterId, (chapter) => ({
        ...chapter,
        ...spec.patchChapter(spec.unwrapValue(intent.value)),
        [spec.pendingFlag]: true,
      }));
      persistProjectsForTeam(selectedTeam);
      render();
    },
    run: async (intent) => {
      // Deferred from the pre-apply guards so the optimistic update is
      // synchronous with the click; still inside the serialized queue. A
      // failed *lookup* (broker unreachable, metadata repo not synced) must
      // not block the write — the write itself fails safely if the project
      // is really gone.
      const projectTombstoned = await ensureProjectNotTombstoned(
        render,
        selectedTeam,
        context.project,
      ).catch(() => false);
      if (projectTombstoned) {
        throw new Error("This project was permanently deleted and can no longer be edited.");
      }
      return invoke(spec.command, {
        input: {
          installationId: selectedTeam.installationId,
          projectId: context.project.id,
          repoName: context.project.name,
          chapterId,
          ...spec.commandInput(spec.unwrapValue(intent.value)),
        },
      });
    },
    onSuccess: (intent) => {
      updateChapterInState(chapterId, (chapter) => ({
        ...chapter,
        ...spec.patchChapter(spec.unwrapValue(intent.value)),
        [spec.pendingFlag]: false,
      }));
      persistProjectsForTeam(selectedTeam);
      showProjectsStatus(render, spec.confirmedStatusText);
      scheduleDeferredProjectRepoSyncAfterLocalWrite(render, selectedTeam, context.project, {
        syncText: "Syncing project repo...",
        refreshText: "Refreshing file list...",
        successNotice: spec.successNotice,
      });
    },
    onError: (error, intent) => {
      clearProjectsStatus(render);
      updateChapterInState(chapterId, (chapter) => ({
        ...chapter,
        ...spec.patchChapter(spec.unwrapValue(intent.previousValue)),
        [spec.pendingFlag]: false,
        [spec.errorField]: error?.message ?? String(error),
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

  persistChapterMetadataField(render, chapterId, chapterGlossaryFieldSpec(nextLink));
}

export async function updateChapterWorkflowStatus(render, chapterId, workflowStatus) {
  persistChapterMetadataField(
    render,
    chapterId,
    chapterWorkflowStatusFieldSpec(normalizeChapterWorkflowStatus(workflowStatus)),
  );
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
    remoteDebugText: options.remoteDebugText ?? "Syncing project repo...",
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
    scope: projectRepoWriteScope(selectedTeam, context.project),
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
      showProjectsStatus(render, options.statusText);
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
      scheduleProjectRepoSyncAfterLocalWrite(render, selectedTeam, context.project, {
        syncText: "Syncing project repo...",
        refreshText: "Refreshing file list...",
        successNotice: options.successNotice,
      });
    },
    onError: (error) => {
      clearProjectsStatus(render);
      setProjectDiscoveryError(render, error?.message ?? String(error));
    },
  });
}

export async function deleteChapter(render, chapterId) {
  await submitCoordinatedChapterLifecycleMutation(render, chapterId, {
    actionLabel: "delete files",
    status: "deleted",
    statusText: "Deleting file...",
    successNotice: "File deleted.",
    command: "soft_delete_gtms_chapter",
  });
}

export async function restoreChapter(render, chapterId) {
  await submitCoordinatedChapterLifecycleMutation(render, chapterId, {
    missingMessage: "Could not find the selected deleted file.",
    actionLabel: "restore files",
    status: "active",
    statusText: "Restoring file...",
    successNotice: "File restored.",
    command: "restore_gtms_chapter",
  });
}

export async function permanentlyDeleteChapter(render, chapterId) {
  const resolved = await resolveChapterMutationContext(render, chapterId, {
    missingMessage: "Could not find the selected deleted file.",
    actionLabel: "permanently delete files",
    actionKind: "localHardDelete",
    localOnly: true,
    requireDelete: true,
  });
  if (!resolved) {
    return;
  }

  const { selectedTeam, context } = resolved;
  if (resourceHasPendingLifecycleMutation(context.chapter)) {
    setProjectDiscoveryError(render, chapterLifecycleWriteBlockedMessage());
    return;
  }
  addLocalHardDeleteTombstone(selectedTeam, "chapter", context.chapter);
  const nextSnapshot = applyChapterPendingMutation(
    { items: state.projects, deletedItems: state.deletedProjects },
    {
      id: crypto.randomUUID(),
      type: "permanentDelete",
      projectId: context.project.id,
      chapterId,
    },
  );
  applyProjectSnapshotToState(nextSnapshot, { reconcileExpandedDeletedFiles });
  persistProjectsForTeam(selectedTeam);
  updateProjectQueryCache(selectedTeam);
  showProjectsNotice(render, "File removed locally.");
  render();
}

export async function confirmChapterPermanentDeletion(render) {
  const selectedTeam = selectedProjectsTeam();
  const context = findChapterContext(state.chapterPermanentDeletion.chapterId);

  // Local hard-delete is local-only; allow it during a background refresh (like Restore).
  if (areResourcePageWriteSubmissionsDisabled(state.projectsPage)) {
    state.chapterPermanentDeletion.status = "idle";
    state.chapterPermanentDeletion.error = chapterLifecycleWriteBlockedMessage();
    render();
    return;
  }

  if (resourceHasPendingLifecycleMutation(context?.chapter)) {
    state.chapterPermanentDeletion.status = "idle";
    state.chapterPermanentDeletion.error = chapterLifecycleWriteBlockedMessage();
    render();
    return;
  }

  if (!selectedTeam || !context?.project || !context?.chapter) {
    state.chapterPermanentDeletion.status = "idle";
    state.chapterPermanentDeletion.error = "Could not find the selected deleted file.";
    render();
    return;
  }

  const policy = getProjectWritePolicy({
    team: selectedTeam,
    project: context.project,
    chapter: context.chapter,
    actionKind: "localHardDelete",
  });
  if (!canPermanentlyDeleteProjectFiles(selectedTeam) || !policy.allowed) {
    state.chapterPermanentDeletion.status = "idle";
    state.chapterPermanentDeletion.error =
      policy.message || "You do not have permission to permanently delete files in this team.";
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
