import { invoke, waitForNextPaint } from "./runtime.js";
import { requireBrokerSession } from "./auth-flow.js";
import {
  beginProjectsPageSync,
  completeProjectsPageSync,
  failProjectsPageSync,
} from "./projects-page-sync.js";
import {
  loadStoredChapterPendingMutations,
  loadStoredProjectPendingMutations,
  saveStoredChapterPendingMutations,
  loadStoredProjectsForTeam,
  saveStoredProjectPendingMutations,
  saveStoredProjectsForTeam,
} from "./project-cache.js";
import {
  applyPendingMutations,
  removeItem,
  removePendingMutation,
  replaceItem,
  upsertPendingMutation,
} from "./optimistic-collection.js";
import {
  normalizeGlossarySummary,
  sortGlossaries,
} from "./glossary-shared.js";
import {
  resetChapterGlossaryConflict,
  resetChapterPermanentDeletion,
  resetChapterRename,
  resetProjectCreation,
  resetProjectPermanentDeletion,
  resetProjectRename,
  state,
} from "./state.js";
import { reconcileProjectRepoSyncStates } from "./project-repo-sync-flow.js";
import { clearScopedSyncBadge, showNoticeBadge, showScopedSyncBadge } from "./status-feedback.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";

function setProjectUiDebug(render, text) {
  showScopedSyncBadge("projects", text, render);
}

function clearProjectUiDebug(render) {
  clearScopedSyncBadge("projects", render);
}

function persistProjectsForTeam(selectedTeam) {
  saveStoredProjectsForTeam(selectedTeam, {
    projects: state.projects,
    deletedProjects: state.deletedProjects,
  });
}

function persistChapterPendingMutationsForTeam(selectedTeam) {
  saveStoredChapterPendingMutations(selectedTeam, state.pendingChapterMutations);
}

function normalizeListedChapter(chapter) {
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
    linkedGlossary1: normalizeChapterGlossaryLink(chapter.linkedGlossary1),
    linkedGlossary2: normalizeChapterGlossaryLink(chapter.linkedGlossary2),
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

function mergeProjectsWithLocalFiles(snapshot, listings = [], targets = []) {
  const listingByProjectId = new Map();
  const listingByRepoName = new Map();
  const targetProjectIds = new Set();
  const targetRepoNames = new Set();

  for (const target of Array.isArray(targets) ? targets : []) {
    if (typeof target?.id === "string" && target.id.trim()) {
      targetProjectIds.add(target.id);
    }
    if (typeof target?.name === "string" && target.name.trim()) {
      targetRepoNames.add(target.name);
    }
  }

  for (const listing of Array.isArray(listings) ? listings : []) {
    if (!listing || typeof listing !== "object") {
      continue;
    }

    const normalizedChapters = Array.isArray(listing.chapters)
      ? listing.chapters.map(normalizeListedChapter).filter(Boolean)
      : [];

    if (typeof listing.projectId === "string" && listing.projectId.trim()) {
      listingByProjectId.set(listing.projectId, normalizedChapters);
    }
    if (typeof listing.repoName === "string" && listing.repoName.trim()) {
      listingByRepoName.set(listing.repoName, normalizedChapters);
    }
  }

  const applyToProject = (project) => {
    const isTargeted = targetProjectIds.has(project.id) || targetRepoNames.has(project.name);
    if (!isTargeted) {
      return project;
    }

    const chapters =
      listingByProjectId.get(project.id)
      ?? listingByRepoName.get(project.name)
      ?? [];
    return {
      ...project,
      chapters,
    };
  };

  return {
    items: snapshot.items.map(applyToProject),
    deletedItems: snapshot.deletedItems.map(applyToProject),
  };
}

async function loadLocalProjectFileListings(selectedTeam, projects) {
  if (!Number.isFinite(selectedTeam?.installationId) || !Array.isArray(projects) || projects.length === 0) {
    return [];
  }

  const listings = await invoke("list_local_gtms_project_files", {
    input: {
      installationId: selectedTeam.installationId,
      projects: projects.map((project) => ({
        projectId: project.id,
        repoName: project.name,
      })),
    },
  });

  return Array.isArray(listings) ? listings : [];
}

async function loadAvailableGlossariesForTeam(selectedTeam, teamIdAtStart = selectedTeam?.id) {
  if (!Number.isFinite(selectedTeam?.installationId)) {
    if (state.selectedTeamId === teamIdAtStart) {
      state.glossaries = [];
    }
    return [];
  }

  const glossaries = await invoke("list_local_gtms_glossaries", {
    input: { installationId: selectedTeam.installationId },
  });
  const normalizedGlossaries = sortGlossaries(
    (Array.isArray(glossaries) ? glossaries : [])
      .map(normalizeGlossarySummary)
      .filter(Boolean),
  );

  if (state.selectedTeamId === teamIdAtStart) {
    state.glossaries = normalizedGlossaries;
  }

  return normalizedGlossaries;
}

export async function refreshProjectFilesFromDisk(render, selectedTeam, projects) {
  const baseSnapshot = {
    items: state.projects,
    deletedItems: state.deletedProjects,
  };
  const targetProjects = Array.isArray(projects) ? projects : [];
  if (!Number.isFinite(selectedTeam?.installationId) || targetProjects.length === 0) {
    return baseSnapshot;
  }

  const listings = await loadLocalProjectFileListings(selectedTeam, targetProjects);
  const mergedSnapshot = mergeProjectsWithLocalFiles(baseSnapshot, listings, targetProjects);
  const nextProjectSnapshot = applyPendingMutations(
    mergedSnapshot,
    state.pendingProjectMutations,
    applyProjectPendingMutation,
  );
  const nextSnapshot = applyPendingMutations(
    nextProjectSnapshot,
    state.pendingChapterMutations,
    applyChapterPendingMutation,
  );
  applyProjectSnapshotToState(nextSnapshot);
  persistProjectsForTeam(selectedTeam);
  render();
  return mergedSnapshot;
}

function findChapterContext(chapterId) {
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

function reconcileExpandedDeletedFiles() {
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

function getProjectSortName(project) {
  if (typeof project?.title === "string" && project.title.trim()) {
    return project.title.trim();
  }

  if (typeof project?.name === "string" && project.name.trim()) {
    return project.name.trim();
  }

  return "";
}

function compareProjectsByName(left, right) {
  const nameComparison = getProjectSortName(left).localeCompare(getProjectSortName(right), undefined, {
    sensitivity: "base",
    numeric: true,
  });
  if (nameComparison !== 0) {
    return nameComparison;
  }

  return String(left?.id ?? "").localeCompare(String(right?.id ?? ""), undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function sortProjectsByName(projects = []) {
  return [...projects].sort(compareProjectsByName);
}

function sortProjectSnapshot(snapshot) {
  return {
    items: sortProjectsByName(snapshot.items),
    deletedItems: sortProjectsByName(snapshot.deletedItems),
  };
}

function applyProjectSnapshotToState(snapshot) {
  const sortedSnapshot = sortProjectSnapshot(snapshot);
  state.projects = sortedSnapshot.items;
  state.deletedProjects = sortedSnapshot.deletedItems;
  if (sortedSnapshot.deletedItems.length === 0) {
    state.showDeletedProjects = false;
  }
  reconcileExpandedDeletedFiles();
}

function normalizeProjectSnapshot(snapshot, pendingMutations = []) {
  const latestMutationByProjectId = new Map();
  for (const mutation of pendingMutations) {
    latestMutationByProjectId.set(mutation.projectId, mutation.type);
  }

  const activeById = new Map(snapshot.items.map((item) => [item.id, item]));
  const deletedById = new Map(snapshot.deletedItems.map((item) => [item.id, item]));

  for (const [projectId, deletedItem] of deletedById.entries()) {
    if (!activeById.has(projectId)) {
      continue;
    }

    const latestMutation = latestMutationByProjectId.get(projectId);
    if (latestMutation === "restore" || latestMutation === "rename") {
      deletedById.delete(projectId);
      continue;
    }

    if (latestMutation === "softDelete") {
      activeById.delete(projectId);
      continue;
    }

    activeById.delete(projectId);
  }

  return sortProjectSnapshot({
    items: [...activeById.values()],
    deletedItems: [...deletedById.values()],
  });
}

function applyProjectPendingMutation(snapshot, mutation) {
  const normalizedSnapshot = normalizeProjectSnapshot(snapshot);
  const findProject = () =>
    normalizedSnapshot.items.find((item) => item.id === mutation.projectId) ??
    normalizedSnapshot.deletedItems.find((item) => item.id === mutation.projectId);
  const currentProject = findProject();

  if (!currentProject) {
    return normalizedSnapshot;
  }

  if (mutation.type === "softDelete") {
    const deletedProject = {
      ...currentProject,
      status: "deleted",
    };
    return normalizeProjectSnapshot({
      items: removeItem(normalizedSnapshot.items, mutation.projectId),
      deletedItems: [deletedProject, ...removeItem(normalizedSnapshot.deletedItems, mutation.projectId)],
    });
  }

  if (mutation.type === "restore") {
    const restoredProject = {
      ...currentProject,
      status: "active",
    };
    return normalizeProjectSnapshot({
      items: replaceItem(removeItem(normalizedSnapshot.items, mutation.projectId), restoredProject),
      deletedItems: removeItem(normalizedSnapshot.deletedItems, mutation.projectId),
    });
  }

  if (mutation.type === "rename") {
    const renamedProject = {
      ...currentProject,
      title: mutation.title,
    };
    const isDeleted = normalizedSnapshot.deletedItems.some((item) => item.id === mutation.projectId);
    return normalizeProjectSnapshot(
      isDeleted
        ? {
            items: normalizedSnapshot.items,
            deletedItems: replaceItem(normalizedSnapshot.deletedItems, renamedProject),
          }
        : {
            items: replaceItem(normalizedSnapshot.items, renamedProject),
            deletedItems: normalizedSnapshot.deletedItems,
          },
    );
  }

  return normalizedSnapshot;
}

function applyChapterPendingMutation(snapshot, mutation) {
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
          linkedGlossary1: normalizeChapterGlossaryLink(mutation.glossary1),
          linkedGlossary2: normalizeChapterGlossaryLink(mutation.glossary2),
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

const inflightProjectMutationIds = new Set();

export async function loadTeamProjects(render, teamId = state.selectedTeamId) {
  const selectedTeam = state.teams.find((team) => team.id === teamId);
  const syncVersionAtStart = state.projectSyncVersion;

  if (!selectedTeam?.installationId) {
    state.pendingProjectMutations = [];
    state.pendingChapterMutations = [];
    state.projectRepoSyncByProjectId = {};
    applyProjectSnapshotToState({ items: [], deletedItems: [] });
    state.projectDiscovery = { status: "ready", error: "" };
    render();
    return;
  }

  const cachedProjects = loadStoredProjectsForTeam(selectedTeam);
  state.pendingProjectMutations = loadStoredProjectPendingMutations(selectedTeam);
  state.pendingChapterMutations = loadStoredChapterPendingMutations(selectedTeam);
  const optimisticProjectSnapshot = applyPendingMutations(
    {
      items: cachedProjects.projects,
      deletedItems: cachedProjects.deletedProjects,
    },
    state.pendingProjectMutations,
    applyProjectPendingMutation,
  );
  const optimisticSnapshot = applyPendingMutations(
    optimisticProjectSnapshot,
    state.pendingChapterMutations,
    applyChapterPendingMutation,
  );
  const glossaryLoadPromise = loadAvailableGlossariesForTeam(selectedTeam, teamId).catch(() => state.glossaries);

  if (state.offline.isEnabled) {
    await glossaryLoadPromise;
    state.projectRepoSyncByProjectId = {};
    applyProjectSnapshotToState(optimisticSnapshot);
    state.projectDiscovery = { status: "ready", error: "" };
    render();
    return;
  }

  if (cachedProjects.exists) {
    applyProjectSnapshotToState(optimisticSnapshot);
    state.projectDiscovery = { status: "ready", error: "" };
  } else {
    applyProjectSnapshotToState({ items: [], deletedItems: [] });
    state.projectDiscovery = { status: "loading", error: "" };
  }
  setProjectUiDebug(render, "Refreshing projects...");
  beginProjectsPageSync();
  render();

  try {
    const [projects] = await Promise.all([
      invoke("list_gnosis_projects_for_installation", {
        installationId: selectedTeam.installationId,
        sessionToken: requireBrokerSession(),
      }),
      glossaryLoadPromise,
    ]);
    if (syncVersionAtStart !== state.projectSyncVersion) {
      await completeProjectsPageSync(render);
      render();
      return;
    }
    const existingProjectsById = new Map(
      [...state.projects, ...state.deletedProjects, ...optimisticSnapshot.items, ...optimisticSnapshot.deletedItems]
        .filter(Boolean)
        .map((project) => [project.id, project]),
    );
    const mappedProjects = projects.map((project) => ({
      ...project,
      chapters: Array.isArray(existingProjectsById.get(project.id)?.chapters)
        ? existingProjectsById.get(project.id).chapters
        : [],
    }));
    const nextProjectSnapshot = applyPendingMutations(
      {
        items: mappedProjects.filter((project) => project.status !== "deleted"),
        deletedItems: mappedProjects.filter((project) => project.status === "deleted"),
      },
      state.pendingProjectMutations,
      applyProjectPendingMutation,
    );
    const nextSnapshot = applyPendingMutations(
      nextProjectSnapshot,
      state.pendingChapterMutations,
      applyChapterPendingMutation,
    );
    applyProjectSnapshotToState(nextSnapshot);
    persistProjectsForTeam(selectedTeam);
    state.projectDiscovery = { status: "ready", error: "" };
    await reconcileProjectRepoSyncStates(render, selectedTeam, mappedProjects);
    await refreshProjectFilesFromDisk(render, selectedTeam, mappedProjects);
    clearProjectUiDebug(render);
    await completeProjectsPageSync(render);
    render();
    if (state.pendingProjectMutations.length > 0) {
      void processPendingProjectMutations(render, selectedTeam);
    }
  } catch (error) {
    if (
      await handleSyncFailure(classifySyncError(error), {
        render,
        teamId: selectedTeam?.id ?? null,
        currentResource: true,
      })
    ) {
      failProjectsPageSync();
      return;
    }

    if (syncVersionAtStart !== state.projectSyncVersion) {
      failProjectsPageSync();
      render();
      return;
    }

    if (!cachedProjects.exists) {
      applyProjectSnapshotToState({ items: [], deletedItems: [] });
      state.projectDiscovery = {
        status: "error",
        error: error?.message ?? String(error),
      };
    } else {
      state.projectDiscovery = { status: "ready", error: "" };
    }
    clearProjectUiDebug(render);
    failProjectsPageSync();
    render();
  }
}

export async function createProjectForSelectedTeam(render) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);

  if (!selectedTeam?.installationId) {
    state.projectDiscovery = {
      status: "error",
      error: "New projects currently require a GitHub App-connected team.",
    };
    render();
    return;
  }

  if (selectedTeam.canManageProjects !== true) {
    state.projectDiscovery = {
      status: "error",
      error: "You do not have permission to create projects in this team.",
    };
    render();
    return;
  }

  state.projectCreation = {
    isOpen: true,
    projectName: "",
    status: "idle",
    error: "",
  };
  render();
}

export function updateProjectCreationName(projectName) {
  state.projectCreation.projectName = projectName;
  if (state.projectCreation.error) {
    state.projectCreation.error = "";
  }
}

export function cancelProjectCreation(render) {
  resetProjectCreation();
  render();
}

export function openProjectRename(render, projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  if (!project) {
    state.projectDiscovery = {
      status: "error",
      error: "Could not find the selected project.",
    };
    render();
    return;
  }

  if (selectedTeam?.canManageProjects !== true) {
    state.projectDiscovery = {
      status: "error",
      error: "You do not have permission to rename projects in this team.",
    };
    render();
    return;
  }

  state.projectRename = {
    isOpen: true,
    projectId,
    projectName: project.title ?? project.name,
    status: "idle",
    error: "",
  };
  render();
}

export function updateProjectRenameName(projectName) {
  state.projectRename.projectName = projectName;
  if (state.projectRename.error) {
    state.projectRename.error = "";
  }
}

export function cancelProjectRename(render) {
  resetProjectRename();
  render();
}

export function openChapterRename(render, chapterId) {
  const context = findChapterContext(chapterId);
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  if (!context?.chapter) {
    state.projectDiscovery = {
      status: "error",
      error: "Could not find the selected file.",
    };
    render();
    return;
  }

  if (!selectedTeam) {
    state.projectDiscovery = {
      status: "error",
      error: "Could not determine the selected team.",
    };
    render();
    return;
  }

  state.chapterRename = {
    isOpen: true,
    projectId: context.project.id,
    chapterId,
    chapterName: context.chapter.name,
    status: "idle",
    error: "",
  };
  render();
}

export function updateChapterRenameName(chapterName) {
  state.chapterRename.chapterName = chapterName;
  if (state.chapterRename.error) {
    state.chapterRename.error = "";
  }
}

export function openChapterPermanentDeletion(render, chapterId) {
  const context = findChapterContext(chapterId);
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  if (!context?.chapter) {
    state.projectDiscovery = {
      status: "error",
      error: "Could not find the selected deleted file.",
    };
    render();
    return;
  }

  if (selectedTeam?.canDelete !== true) {
    state.projectDiscovery = {
      status: "error",
      error: "You do not have permission to permanently delete files in this team.",
    };
    render();
    return;
  }

  state.chapterPermanentDeletion = {
    isOpen: true,
    projectId: context.project.id,
    chapterId,
    chapterName: context.chapter.name,
    confirmationText: "",
    status: "idle",
    error: "",
  };
  render();
}

export function updateChapterPermanentDeletionConfirmation(value) {
  state.chapterPermanentDeletion.confirmationText = value;
  if (state.chapterPermanentDeletion.error) {
    state.chapterPermanentDeletion.error = "";
  }
}

export function cancelChapterRename(render) {
  resetChapterRename();
  render();
}

export function cancelChapterPermanentDeletion(render) {
  resetChapterPermanentDeletion();
  render();
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

export async function submitProjectCreation(render) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  if (!selectedTeam?.installationId) {
    state.projectCreation.error = "New projects currently require a GitHub App-connected team.";
    render();
    return;
  }

  if (selectedTeam.canManageProjects !== true) {
    state.projectCreation.error = "You do not have permission to create projects in this team.";
    render();
    return;
  }

  const projectTitle = state.projectCreation.projectName.trim();
  const repoName = slugifyRepositoryName(projectTitle);

  if (!repoName) {
    state.projectCreation.error =
      "Project names must contain at least one letter or number.";
    render();
    return;
  }

  try {
    state.projectCreation.status = "loading";
    state.projectCreation.error = "";
    render();
    await waitForNextPaint();
    await invoke("create_gnosis_project_repo", {
      input: {
        installationId: selectedTeam.installationId,
        orgLogin: selectedTeam.githubOrg,
        repoName,
        projectTitle,
      },
      sessionToken: requireBrokerSession(),
    });
    resetProjectCreation();
    await loadTeamProjects(render, selectedTeam.id);
  } catch (error) {
    if (await handleSyncFailure(classifySyncError(error), { render })) {
      return;
    }
    state.projectCreation.status = "idle";
    state.projectCreation.error = error?.message ?? String(error);
    render();
  }
}

export async function submitProjectRename(render) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  const project = state.projects.find((item) => item.id === state.projectRename.projectId);

  if (!selectedTeam?.installationId || !project) {
    state.projectRename.error = "Could not find the selected project.";
    render();
    return;
  }

  if (selectedTeam.canManageProjects !== true) {
    state.projectRename.error = "You do not have permission to rename projects in this team.";
    render();
    return;
  }

  const nextTitle = state.projectRename.projectName.trim();
  if (!nextTitle) {
    state.projectRename.error = "Enter a project name.";
    render();
    return;
  }

  try {
    state.projectRename.status = "loading";
    state.projectRename.error = "";
    render();
  const mutation = {
    id: crypto.randomUUID(),
    type: "rename",
    projectId: project.id,
    title: nextTitle,
      previousTitle: project.title ?? project.name,
    };
  state.projectSyncVersion += 1;
  const snapshot = applyProjectPendingMutation(
    { items: state.projects, deletedItems: state.deletedProjects },
    mutation,
  );
  applyProjectSnapshotToState(snapshot);
  beginProjectsPageSync();
  state.pendingProjectMutations = upsertPendingMutation(state.pendingProjectMutations, mutation);
  saveStoredProjectsForTeam(selectedTeam, {
    projects: state.projects,
      deletedProjects: state.deletedProjects,
    });
    saveStoredProjectPendingMutations(selectedTeam, state.pendingProjectMutations);
    resetProjectRename();
    render();
    void processPendingProjectMutations(render, selectedTeam);
  } catch (error) {
    if (await handleSyncFailure(classifySyncError(error), { render })) {
      return;
    }
    state.projectRename.status = "idle";
    state.projectRename.error = error?.message ?? String(error);
    render();
  }
}

export async function submitChapterRename(render) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  const context = findChapterContext(state.chapterRename.chapterId);
  const nextTitle = state.chapterRename.chapterName.trim();

  if (!Number.isFinite(selectedTeam?.installationId) || !context?.project || !context?.chapter) {
    state.chapterRename.error = "Could not find the selected file.";
    render();
    return;
  }

  if (!nextTitle) {
    state.chapterRename.error = "Enter a file name.";
    render();
    return;
  }

  const snapshot = cloneProjectCollections();
  const mutation = {
    id: crypto.randomUUID(),
    type: "rename",
    projectId: context.project.id,
    chapterId: context.chapter.id,
    title: nextTitle,
  };
  state.projectSyncVersion += 1;
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
  beginProjectsPageSync();
  persistProjectsForTeam(selectedTeam);
  state.pendingChapterMutations = upsertPendingMutation(state.pendingChapterMutations, mutation);
  persistChapterPendingMutationsForTeam(selectedTeam);
  resetChapterRename();
  render();
  setProjectUiDebug(render, "Optimistic file rename applied");
  void waitForNextPaint().then(async () => {
    try {
      setProjectUiDebug(render, "Saving file...");
      await invoke("rename_gtms_chapter", {
        input: {
          installationId: selectedTeam.installationId,
          repoName: context.project.name,
          chapterId: context.chapter.id,
          title: nextTitle,
        },
      });
      state.pendingChapterMutations = removePendingMutation(state.pendingChapterMutations, mutation.id);
      persistChapterPendingMutationsForTeam(selectedTeam);
      setProjectUiDebug(render, "Background sync started");
      await reconcileProjectRepoSyncStates(render, selectedTeam, [context.project]);
      await refreshProjectFilesFromDisk(render, selectedTeam, [context.project]);
      clearProjectUiDebug(render);
      await completeProjectsPageSync(render);
      render();
    } catch (error) {
      state.pendingChapterMutations = removePendingMutation(state.pendingChapterMutations, mutation.id);
      persistChapterPendingMutationsForTeam(selectedTeam);
      restoreProjectCollections(snapshot);
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
      persistProjectsForTeam(selectedTeam);
      clearProjectUiDebug(render);
      failProjectsPageSync();
      render();
    }
  });
}

async function persistChapterGlossaryLinks(render, chapterId, nextGlossary1, nextGlossary2) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  const context = findChapterContext(chapterId);

  if (
    !Number.isFinite(selectedTeam?.installationId)
    || !context?.project?.name
    || !context?.chapter
  ) {
    state.projectDiscovery = {
      status: "error",
      error: "Could not find the selected file.",
    };
    render();
    return;
  }

  const currentGlossary1 = normalizeChapterGlossaryLink(context.chapter.linkedGlossary1);
  const currentGlossary2 = normalizeChapterGlossaryLink(context.chapter.linkedGlossary2);

  if (
    JSON.stringify(nextGlossary1) === JSON.stringify(currentGlossary1)
    && JSON.stringify(nextGlossary2) === JSON.stringify(currentGlossary2)
  ) {
    return;
  }

  const snapshot = cloneProjectCollections();
  const mutation = {
    id: crypto.randomUUID(),
    type: "setGlossaryLinks",
    projectId: context.project.id,
    chapterId,
    glossary1: nextGlossary1,
    glossary2: nextGlossary2,
  };

  state.projectSyncVersion += 1;
  updateChapterInState(chapterId, (chapter) => ({
    ...chapter,
    linkedGlossary1: nextGlossary1,
    linkedGlossary2: nextGlossary2,
  }));
  beginProjectsPageSync();
  persistProjectsForTeam(selectedTeam);
  state.pendingChapterMutations = upsertPendingMutation(state.pendingChapterMutations, mutation);
  persistChapterPendingMutationsForTeam(selectedTeam);
  render();

  void waitForNextPaint().then(async () => {
    try {
      const payload = await invoke("update_gtms_chapter_glossary_links", {
        input: {
          installationId: selectedTeam.installationId,
          repoName: context.project.name,
          chapterId,
          glossary1: chapterGlossaryLinkInput(nextGlossary1),
          glossary2: chapterGlossaryLinkInput(nextGlossary2),
        },
      });

      state.pendingChapterMutations = removePendingMutation(state.pendingChapterMutations, mutation.id);
      persistChapterPendingMutationsForTeam(selectedTeam);
      updateChapterInState(chapterId, (chapter) => ({
        ...chapter,
        linkedGlossary1: normalizeChapterGlossaryLink(payload?.glossary1),
        linkedGlossary2: normalizeChapterGlossaryLink(payload?.glossary2),
      }));
      persistProjectsForTeam(selectedTeam);
      await reconcileProjectRepoSyncStates(render, selectedTeam, [context.project]);
      await refreshProjectFilesFromDisk(render, selectedTeam, [context.project]);
      await completeProjectsPageSync(render);
      render();
    } catch (error) {
      state.pendingChapterMutations = removePendingMutation(state.pendingChapterMutations, mutation.id);
      persistChapterPendingMutationsForTeam(selectedTeam);
      restoreProjectCollections(snapshot);
      persistProjectsForTeam(selectedTeam);
      showNoticeBadge(error?.message ?? String(error), render);
      failProjectsPageSync();
      render();
    }
  });
}

export async function updateChapterGlossaryLinks(render, chapterId, slot, glossaryId) {
  if (slot !== "glossary_1" && slot !== "glossary_2") {
    return;
  }

  const context = findChapterContext(chapterId);
  if (!context?.chapter) {
    state.projectDiscovery = {
      status: "error",
      error: "Could not find the selected file.",
    };
    render();
    return;
  }

  const nextLink = chapterGlossaryLinkFromGlossaryId(glossaryId);
  if (glossaryId && !nextLink) {
    showNoticeBadge("Could not find the selected glossary.", render);
    return;
  }

  const currentGlossary1 = normalizeChapterGlossaryLink(context.chapter.linkedGlossary1);
  const currentGlossary2 = normalizeChapterGlossaryLink(context.chapter.linkedGlossary2);
  const otherLink = slot === "glossary_1" ? currentGlossary2 : currentGlossary1;
  const nextSummary = glossarySummaryByLink(nextLink);
  const otherSummary = glossarySummaryByLink(otherLink);
  const nextTargetLanguageKey = glossaryTargetLanguageKey(nextSummary);
  const otherTargetLanguageKey = glossaryTargetLanguageKey(otherSummary);

  if (
    nextLink
    && otherLink
    && nextTargetLanguageKey
    && otherTargetLanguageKey
    && nextTargetLanguageKey === otherTargetLanguageKey
  ) {
    state.chapterGlossaryConflict = {
      isOpen: true,
      status: "idle",
      error: "",
      chapterId,
      glossary1: slot === "glossary_1" ? nextLink : null,
      glossary2: slot === "glossary_2" ? nextLink : null,
      message: `Your two glossaries have the same target language. To prevent errors, ${otherSummary?.title ?? "the other glossary"} will be de-selected.`,
    };
    render();
    return;
  }

  await persistChapterGlossaryLinks(
    render,
    chapterId,
    slot === "glossary_1" ? nextLink : currentGlossary1,
    slot === "glossary_2" ? nextLink : currentGlossary2,
  );
}

export async function acknowledgeChapterGlossaryConflict(render) {
  const conflict = state.chapterGlossaryConflict;
  if (!conflict?.isOpen || !conflict.chapterId) {
    return;
  }

  const chapterId = conflict.chapterId;
  const glossary1 = normalizeChapterGlossaryLink(conflict.glossary1);
  const glossary2 = normalizeChapterGlossaryLink(conflict.glossary2);
  resetChapterGlossaryConflict();
  render();
  await persistChapterGlossaryLinks(render, chapterId, glossary1, glossary2);
}

export async function deleteProject(render, projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);

  if (!project) {
    state.projectDiscovery = {
      status: "error",
      error: "Could not find the selected project.",
    };
    render();
    return;
  }

  if (!selectedTeam?.installationId || !project) {
    state.projectDiscovery = {
      status: "error",
      error: "Could not find the selected project.",
    };
    render();
    return;
  }

  if (selectedTeam.canManageProjects !== true) {
    state.projectDiscovery = {
      status: "error",
      error: "You do not have permission to delete projects in this team.",
    };
    render();
    return;
  }

  state.projectSyncVersion += 1;
  setProjectUiDebug(render, "Delete clicked");
  const mutation = {
    id: crypto.randomUUID(),
    type: "softDelete",
    projectId: project.id,
  };
  const snapshot = applyProjectPendingMutation(
    { items: state.projects, deletedItems: state.deletedProjects },
    mutation,
  );
  applyProjectSnapshotToState(snapshot);
  state.pendingProjectMutations = upsertPendingMutation(state.pendingProjectMutations, mutation);
  beginProjectsPageSync();
  if (state.projects.length === 0 && state.deletedProjects.length > 0) {
    state.showDeletedProjects = true;
  }
  saveStoredProjectsForTeam(selectedTeam, {
    projects: state.projects,
    deletedProjects: state.deletedProjects,
  });
  saveStoredProjectPendingMutations(selectedTeam, state.pendingProjectMutations);
  render();

  setProjectUiDebug(render, "Optimistic delete applied");
  void waitForNextPaint().then(() => {
    setProjectUiDebug(render, "First paint reached");
    setProjectUiDebug(render, "Background sync started");
    void processPendingProjectMutations(render, selectedTeam);
  });
}

export async function deleteChapter(render, chapterId) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  const context = findChapterContext(chapterId);

  if (!Number.isFinite(selectedTeam?.installationId) || !context?.project || !context?.chapter) {
    state.projectDiscovery = {
      status: "error",
      error: "Could not find the selected file.",
    };
    render();
    return;
  }

  const snapshot = cloneProjectCollections();
  const mutation = {
    id: crypto.randomUUID(),
    type: "softDelete",
    projectId: context.project.id,
    chapterId,
  };
  state.projectSyncVersion += 1;
  setProjectUiDebug(render, "Delete clicked");
  updateChapterInState(chapterId, (chapter) => ({
    ...chapter,
    status: "deleted",
  }));
  reconcileExpandedDeletedFiles();
  beginProjectsPageSync();
  persistProjectsForTeam(selectedTeam);
  state.pendingChapterMutations = upsertPendingMutation(state.pendingChapterMutations, mutation);
  persistChapterPendingMutationsForTeam(selectedTeam);
  render();
  setProjectUiDebug(render, "Optimistic delete applied");
  void waitForNextPaint().then(async () => {
    try {
      setProjectUiDebug(render, "Background sync started");
      await invoke("soft_delete_gtms_chapter", {
        input: {
          installationId: selectedTeam.installationId,
          repoName: context.project.name,
          chapterId,
        },
      });
      state.pendingChapterMutations = removePendingMutation(state.pendingChapterMutations, mutation.id);
      persistChapterPendingMutationsForTeam(selectedTeam);
      await reconcileProjectRepoSyncStates(render, selectedTeam, [context.project]);
      await refreshProjectFilesFromDisk(render, selectedTeam, [context.project]);
      clearProjectUiDebug(render);
      await completeProjectsPageSync(render);
      render();
    } catch (error) {
      state.pendingChapterMutations = removePendingMutation(state.pendingChapterMutations, mutation.id);
      persistChapterPendingMutationsForTeam(selectedTeam);
      restoreProjectCollections(snapshot);
      persistProjectsForTeam(selectedTeam);
      clearProjectUiDebug(render);
      failProjectsPageSync();
      showNoticeBadge(error?.message ?? String(error), render);
      render();
    }
  });
}

export async function restoreChapter(render, chapterId) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  const context = findChapterContext(chapterId);

  if (!Number.isFinite(selectedTeam?.installationId) || !context?.project || !context?.chapter) {
    state.projectDiscovery = {
      status: "error",
      error: "Could not find the selected deleted file.",
    };
    render();
    return;
  }

  const snapshot = cloneProjectCollections();
  const mutation = {
    id: crypto.randomUUID(),
    type: "restore",
    projectId: context.project.id,
    chapterId,
  };
  state.projectSyncVersion += 1;
  setProjectUiDebug(render, "Restore clicked");
  updateChapterInState(chapterId, (chapter) => ({
    ...chapter,
    status: "active",
  }));
  reconcileExpandedDeletedFiles();
  beginProjectsPageSync();
  persistProjectsForTeam(selectedTeam);
  state.pendingChapterMutations = upsertPendingMutation(state.pendingChapterMutations, mutation);
  persistChapterPendingMutationsForTeam(selectedTeam);
  render();
  setProjectUiDebug(render, "Optimistic restore applied");
  void waitForNextPaint().then(async () => {
    try {
      setProjectUiDebug(render, "Background sync started");
      await invoke("restore_gtms_chapter", {
        input: {
          installationId: selectedTeam.installationId,
          repoName: context.project.name,
          chapterId,
        },
      });
      state.pendingChapterMutations = removePendingMutation(state.pendingChapterMutations, mutation.id);
      persistChapterPendingMutationsForTeam(selectedTeam);
      await reconcileProjectRepoSyncStates(render, selectedTeam, [context.project]);
      await refreshProjectFilesFromDisk(render, selectedTeam, [context.project]);
      clearProjectUiDebug(render);
      await completeProjectsPageSync(render);
      render();
    } catch (error) {
      state.pendingChapterMutations = removePendingMutation(state.pendingChapterMutations, mutation.id);
      persistChapterPendingMutationsForTeam(selectedTeam);
      restoreProjectCollections(snapshot);
      persistProjectsForTeam(selectedTeam);
      clearProjectUiDebug(render);
      failProjectsPageSync();
      showNoticeBadge(error?.message ?? String(error), render);
      render();
    }
  });
}

export async function permanentlyDeleteChapter(render, chapterId) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  const context = findChapterContext(chapterId);

  if (!Number.isFinite(selectedTeam?.installationId) || !context?.project || !context?.chapter) {
    state.projectDiscovery = {
      status: "error",
      error: "Could not find the selected deleted file.",
    };
    render();
    return;
  }

  if (selectedTeam.canDelete !== true) {
    state.projectDiscovery = {
      status: "error",
      error: "You do not have permission to permanently delete files in this team.",
    };
    render();
    return;
  }

  const snapshot = cloneProjectCollections();
  const mutation = {
    id: crypto.randomUUID(),
    type: "permanentDelete",
    projectId: context.project.id,
    chapterId,
  };
  state.projectSyncVersion += 1;
  setProjectUiDebug(render, "Permanent delete clicked");
  const nextSnapshot = applyChapterPendingMutation(
    { items: state.projects, deletedItems: state.deletedProjects },
    mutation,
  );
  applyProjectSnapshotToState(nextSnapshot);
  beginProjectsPageSync();
  persistProjectsForTeam(selectedTeam);
  state.pendingChapterMutations = upsertPendingMutation(state.pendingChapterMutations, mutation);
  persistChapterPendingMutationsForTeam(selectedTeam);
  render();
  setProjectUiDebug(render, "Optimistic permanent delete applied");
  void waitForNextPaint().then(async () => {
    try {
      setProjectUiDebug(render, "Background sync started");
      await invoke("permanently_delete_gtms_chapter", {
        input: {
          installationId: selectedTeam.installationId,
          repoName: context.project.name,
          chapterId,
        },
      });
      state.pendingChapterMutations = removePendingMutation(state.pendingChapterMutations, mutation.id);
      persistChapterPendingMutationsForTeam(selectedTeam);
      await reconcileProjectRepoSyncStates(render, selectedTeam, [context.project]);
      await refreshProjectFilesFromDisk(render, selectedTeam, [context.project]);
      clearProjectUiDebug(render);
      await completeProjectsPageSync(render);
      render();
    } catch (error) {
      state.pendingChapterMutations = removePendingMutation(state.pendingChapterMutations, mutation.id);
      persistChapterPendingMutationsForTeam(selectedTeam);
      restoreProjectCollections(snapshot);
      persistProjectsForTeam(selectedTeam);
      clearProjectUiDebug(render);
      failProjectsPageSync();
      showNoticeBadge(error?.message ?? String(error), render);
      render();
    }
  });
}

export async function confirmChapterPermanentDeletion(render) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  const context = findChapterContext(state.chapterPermanentDeletion.chapterId);

  if (!Number.isFinite(selectedTeam?.installationId) || !context?.project || !context?.chapter) {
    state.chapterPermanentDeletion.status = "idle";
    state.chapterPermanentDeletion.error = "Could not find the selected deleted file.";
    render();
    return;
  }

  if (selectedTeam.canDelete !== true) {
    state.chapterPermanentDeletion.status = "idle";
    state.chapterPermanentDeletion.error =
      "You do not have permission to permanently delete files in this team.";
    render();
    return;
  }

  if (state.chapterPermanentDeletion.confirmationText !== state.chapterPermanentDeletion.chapterName) {
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

export function toggleDeletedProjects(render) {
  state.showDeletedProjects = !state.showDeletedProjects;
  render();
}

export async function restoreProject(render, projectId) {
  const project = state.deletedProjects.find((item) => item.id === projectId);
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);

  if (!project) {
    state.projectDiscovery = {
      status: "error",
      error: "Could not find the selected deleted project.",
    };
    render();
    return;
  }

  if (!selectedTeam?.installationId) {
    state.projectDiscovery = {
      status: "error",
      error: "Could not restore the selected project.",
    };
    render();
    return;
  }

  if (selectedTeam.canManageProjects !== true) {
    state.projectDiscovery = {
      status: "error",
      error: "You do not have permission to restore projects in this team.",
    };
    render();
    return;
  }

  state.projectSyncVersion += 1;
  setProjectUiDebug(render, "Restore clicked");
  const mutation = {
    id: crypto.randomUUID(),
    type: "restore",
    projectId: project.id,
  };
  const snapshot = applyProjectPendingMutation(
    { items: state.projects, deletedItems: state.deletedProjects },
    mutation,
  );
  applyProjectSnapshotToState(snapshot);
  state.pendingProjectMutations = upsertPendingMutation(state.pendingProjectMutations, mutation);
  beginProjectsPageSync();
  saveStoredProjectsForTeam(selectedTeam, {
    projects: state.projects,
    deletedProjects: state.deletedProjects,
  });
  saveStoredProjectPendingMutations(selectedTeam, state.pendingProjectMutations);
  render();

  setProjectUiDebug(render, "Optimistic restore applied");
  void waitForNextPaint().then(() => {
    setProjectUiDebug(render, "First paint reached");
    setProjectUiDebug(render, "Background sync started");
    void processPendingProjectMutations(render, selectedTeam);
  });
}

async function commitProjectMutation(selectedTeam, mutation) {
  const project =
    state.projects.find((item) => item.id === mutation.projectId) ??
    state.deletedProjects.find((item) => item.id === mutation.projectId);

  if (!selectedTeam?.installationId || !project) {
    return;
  }

  if (mutation.type === "rename") {
    await invoke("rename_gnosis_project_repo", {
      input: {
        installationId: selectedTeam.installationId,
        fullName: project.fullName,
        projectTitle: mutation.title,
      },
      sessionToken: requireBrokerSession(),
    });
    return;
  }

  if (mutation.type === "softDelete") {
    await invoke("mark_gnosis_project_repo_deleted", {
      input: {
        installationId: selectedTeam.installationId,
        orgLogin: selectedTeam.githubOrg,
        repoName: project.name,
      },
      sessionToken: requireBrokerSession(),
    });
    return;
  }

  if (mutation.type === "restore") {
    await invoke("restore_gnosis_project_repo", {
      input: {
        installationId: selectedTeam.installationId,
        orgLogin: selectedTeam.githubOrg,
        repoName: project.name,
      },
      sessionToken: requireBrokerSession(),
    });
  }
}

function rollbackVisibleProjectMutation(mutation) {
  const inverseMutation =
    mutation.type === "rename"
      ? {
          id: `${mutation.id}-rollback`,
          type: "rename",
          projectId: mutation.projectId,
          title: mutation.previousTitle,
        }
      : mutation.type === "softDelete"
        ? {
            id: `${mutation.id}-rollback`,
            type: "restore",
            projectId: mutation.projectId,
          }
        : mutation.type === "restore"
          ? {
              id: `${mutation.id}-rollback`,
              type: "softDelete",
              projectId: mutation.projectId,
            }
          : null;

  if (!inverseMutation) {
    return;
  }

  const snapshot = applyProjectPendingMutation(
    { items: state.projects, deletedItems: state.deletedProjects },
    inverseMutation,
  );
  applyProjectSnapshotToState(snapshot);
}

async function processPendingProjectMutations(render, selectedTeam) {
  const pendingMutations = [...state.pendingProjectMutations];

  for (const mutation of pendingMutations) {
    if (inflightProjectMutationIds.has(mutation.id)) {
      continue;
    }

    inflightProjectMutationIds.add(mutation.id);
    try {
      await waitForNextPaint();
      await commitProjectMutation(selectedTeam, mutation);
      state.pendingProjectMutations = removePendingMutation(
        state.pendingProjectMutations,
        mutation.id,
      );
      saveStoredProjectPendingMutations(selectedTeam, state.pendingProjectMutations);
      saveStoredProjectsForTeam(selectedTeam, {
        projects: state.projects,
        deletedProjects: state.deletedProjects,
      });
    } catch (error) {
      inflightProjectMutationIds.delete(mutation.id);
      state.pendingProjectMutations = removePendingMutation(
        state.pendingProjectMutations,
        mutation.id,
      );
      saveStoredProjectPendingMutations(selectedTeam, state.pendingProjectMutations);
      rollbackVisibleProjectMutation(mutation);
      saveStoredProjectsForTeam(selectedTeam, {
        projects: state.projects,
        deletedProjects: state.deletedProjects,
      });
      if (await handleSyncFailure(classifySyncError(error), { render })) {
        clearProjectUiDebug(render);
        failProjectsPageSync();
        return;
      }
      await loadTeamProjects(render, selectedTeam?.id);
      clearProjectUiDebug(render);
      await completeProjectsPageSync(render);
      render();
      return;
    }
    inflightProjectMutationIds.delete(mutation.id);
  }

  clearProjectUiDebug(render);
  await completeProjectsPageSync(render);
  render();
}

export function permanentlyDeleteProject(render, projectId) {
  const project = state.deletedProjects.find((item) => item.id === projectId);
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  if (!project) {
    state.projectDiscovery = {
      status: "error",
      error: "Could not find the selected deleted project.",
    };
    render();
    return;
  }

  if (selectedTeam?.canDelete !== true) {
    state.projectDiscovery = {
      status: "error",
      error: "You do not have permission to delete projects in this team.",
    };
    render();
    return;
  }

  state.projectPermanentDeletion = {
    isOpen: true,
    projectId,
    projectName: project.title ?? project.name,
    confirmationText: "",
    status: "idle",
    error: "",
  };
  render();
}

export function updateProjectPermanentDeletionConfirmation(value) {
  state.projectPermanentDeletion.confirmationText = value;
  if (state.projectPermanentDeletion.error) {
    state.projectPermanentDeletion.error = "";
  }
}

export function cancelProjectPermanentDeletion(render) {
  resetProjectPermanentDeletion();
  render();
}

export async function confirmProjectPermanentDeletion(render) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  const project = state.deletedProjects.find(
    (item) => item.id === state.projectPermanentDeletion.projectId,
  );

  if (!selectedTeam?.installationId || !project) {
    state.projectPermanentDeletion.status = "idle";
    state.projectPermanentDeletion.error = "Could not find the selected deleted project.";
    render();
    return;
  }

  if (selectedTeam.canManageProjects !== true) {
    state.projectPermanentDeletion.status = "idle";
    state.projectPermanentDeletion.error = "You do not have permission to delete projects in this team.";
    render();
    return;
  }

  if (state.projectPermanentDeletion.confirmationText !== state.projectPermanentDeletion.projectName) {
    state.projectPermanentDeletion.error = "Project name confirmation does not match.";
    render();
    return;
  }

  try {
    state.projectPermanentDeletion.status = "loading";
    state.projectPermanentDeletion.error = "";
    render();
    await waitForNextPaint();
    await invoke("permanently_delete_gnosis_project_repo", {
      input: {
        installationId: selectedTeam.installationId,
        orgLogin: selectedTeam.githubOrg,
        repoName: project.name,
      },
      sessionToken: requireBrokerSession(),
    });
    resetProjectPermanentDeletion();
    await loadTeamProjects(render, selectedTeam.id);
  } catch (error) {
    if (await handleSyncFailure(classifySyncError(error), { render })) {
      return;
    }
    state.projectPermanentDeletion.status = "idle";
    state.projectPermanentDeletion.error = error?.message ?? String(error);
    render();
  }
}

function slugifyRepositoryName(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}
