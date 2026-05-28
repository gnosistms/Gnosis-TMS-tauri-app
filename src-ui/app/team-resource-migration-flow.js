import { requireBrokerSession } from "./auth-flow.js";
import {
  listRemoteGlossaryReposForTeam,
  syncGlossaryReposForTeam,
} from "./glossary-repo-flow.js";
import { reconcileProjectRepoSyncStates } from "./project-repo-sync-flow.js";
import {
  listRemoteQaListReposForTeam,
  syncQaListReposForTeam,
  teamSupportsQaListRepos,
} from "./qa-list-repo-flow.js";
import { invoke, waitForNextPaint } from "./runtime.js";
import {
  createTeamResourceMigrationModalState,
  state,
} from "./state.js";

export const TEAM_REPO_LAYOUT_MIGRATION_TARGET_VERSION = "0.8.10";

const activeTeamMigrationPromises = new Map();
let nextMigrationModalToken = 1;

function normalizedText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function repoNameOf(resource) {
  return normalizedText(resource?.repoName) || normalizedText(resource?.name);
}

function fullRepoNameOf(resource) {
  return normalizedText(resource?.fullName) || repoNameOf(resource);
}

function titleOf(resource, fallback = "") {
  return (
    normalizedText(resource?.title)
    || normalizedText(resource?.name)
    || normalizedText(resource?.repoName)
    || fallback
  );
}

function resourceIdOf(resource, idField) {
  return (
    normalizedText(resource?.[idField])
    || normalizedText(resource?.id)
    || normalizedText(resource?.resourceId)
    || null
  );
}

function isDeletedResourceCandidate(resource) {
  return [
    resource?.lifecycleState,
    resource?.recordState,
    resource?.remoteState,
  ].some((value) => {
    const normalized = normalizedText(value).toLowerCase();
    return normalized === "deleted"
      || normalized === "softdeleted"
      || normalized === "tombstone";
  });
}

function projectCandidate(project) {
  const repoName = repoNameOf(project);
  if (!repoName) {
    return null;
  }

  return {
    projectId: resourceIdOf(project, "projectId"),
    repoName,
    title: titleOf(project, repoName),
    lifecycleState: normalizedText(project?.lifecycleState),
    recordState: normalizedText(project?.recordState),
    remoteState: normalizedText(project?.remoteState),
  };
}

function resourceCandidate(resource, idField) {
  const repoName = repoNameOf(resource);
  if (!repoName) {
    return null;
  }

  return {
    resourceId: resourceIdOf(resource, idField),
    repoName,
    title: titleOf(resource, repoName),
    lifecycleState: normalizedText(resource?.lifecycleState),
    recordState: normalizedText(resource?.recordState),
    remoteState: normalizedText(resource?.remoteState),
  };
}

function findMatchingResource(resources, pending, idField) {
  const pendingRepoName = normalizedText(pending?.repoName).toLowerCase();
  const pendingResourceId = normalizedText(pending?.resourceId);
  return (Array.isArray(resources) ? resources : []).find((resource) => {
    if (pendingResourceId && resourceIdOf(resource, idField) === pendingResourceId) {
      return true;
    }
    return repoNameOf(resource).toLowerCase() === pendingRepoName;
  }) ?? null;
}

function pendingByType(pending, resourceType) {
  return (Array.isArray(pending) ? pending : []).filter((item) => item?.resourceType === resourceType);
}

function migrationResourceKey(resource) {
  const repoName = repoNameOf(resource).toLowerCase();
  const id = normalizedText(resource?.id)
    || normalizedText(resource?.projectId)
    || normalizedText(resource?.glossaryId)
    || normalizedText(resource?.qaListId)
    || normalizedText(resource?.resourceId);
  return `${id || ""}::${repoName}`;
}

function mergeResourceLists(...resourceLists) {
  const merged = [];
  const seen = new Set();
  for (const resource of resourceLists.flatMap((list) => Array.isArray(list) ? list : [])) {
    const key = migrationResourceKey(resource);
    if (key === "::" || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(resource);
  }
  return merged;
}

function pendingMigrationSignature(pending) {
  return (Array.isArray(pending) ? pending : [])
    .map((item) => [
      normalizedText(item?.resourceType),
      normalizedText(item?.resourceId),
      normalizedText(item?.repoName),
    ].join(":"))
    .sort()
    .join("|");
}

function migrationResourceCount(resources) {
  return [
    resources?.projects,
    resources?.glossaries,
    resources?.qaLists,
  ].reduce((count, list) => count + (Array.isArray(list) ? list.length : 0), 0);
}

function pendingMigrationDescription(pending) {
  const count = Array.isArray(pending) ? pending.length : 0;
  return `${count} resource${count === 1 ? "" : "s"}`;
}

function pendingItemRequiresDownload(item) {
  return normalizedText(item?.migrationReason) === "missingLocal";
}

function openMigrationModal(message, targetVersion = TEAM_REPO_LAYOUT_MIGRATION_TARGET_VERSION) {
  const token = nextMigrationModalToken;
  nextMigrationModalToken += 1;
  state.teamResourceMigrationModal = {
    isOpen: true,
    targetVersion,
    message,
    token,
  };
  return token;
}

function updateMigrationModal(token, message) {
  if (
    state.teamResourceMigrationModal?.isOpen !== true
    || state.teamResourceMigrationModal?.token !== token
  ) {
    return false;
  }

  state.teamResourceMigrationModal = {
    ...state.teamResourceMigrationModal,
    message,
  };
  return true;
}

function closeMigrationModal(token) {
  if (
    state.teamResourceMigrationModal?.isOpen === true
    && state.teamResourceMigrationModal?.token !== token
  ) {
    return;
  }
  state.teamResourceMigrationModal = createTeamResourceMigrationModalState();
}

async function listRemoteProjectsForTeam(team) {
  if (!Number.isFinite(team?.installationId) || !invoke) {
    return [];
  }

  return invoke("list_gnosis_projects_for_installation", {
    installationId: team.installationId,
    sessionToken: requireBrokerSession(),
  });
}

async function collectTeamMigrationResources(team, options = {}) {
  const remoteProjects = await listRemoteProjectsForTeam(team);
  const glossaries = await listRemoteGlossaryReposForTeam(team);
  const qaLists = teamSupportsQaListRepos(team)
    ? await listRemoteQaListReposForTeam(team)
    : [];

  return {
    projects: mergeResourceLists(options.projects, remoteProjects),
    glossaries: Array.isArray(glossaries) ? glossaries : [],
    qaLists: Array.isArray(qaLists) ? qaLists : [],
  };
}

async function listPendingTeamMigrations(team, resources) {
  if (!Number.isFinite(team?.installationId) || !invoke) {
    return {
      targetVersion: TEAM_REPO_LAYOUT_MIGRATION_TARGET_VERSION,
      migrations: [],
    };
  }

  const result = await invoke("list_pending_team_repo_layout_migrations", {
    input: {
      installationId: team.installationId,
      projects: resources.projects.map(projectCandidate).filter(Boolean),
      glossaries: resources.glossaries.map((glossary) =>
        resourceCandidate(glossary, "glossaryId")
      ).filter(Boolean),
      qaLists: resources.qaLists.map((qaList) =>
        resourceCandidate(qaList, "qaListId")
      ).filter(Boolean),
    },
  });

  if (Array.isArray(result)) {
    return {
      targetVersion: TEAM_REPO_LAYOUT_MIGRATION_TARGET_VERSION,
      migrations: result,
    };
  }

  return {
    targetVersion:
      normalizedText(result?.targetVersion) || TEAM_REPO_LAYOUT_MIGRATION_TARGET_VERSION,
    migrations: Array.isArray(result?.migrations) ? result.migrations : [],
  };
}

async function setModalMessage(token, render, message) {
  updateMigrationModal(token, message);
  render?.();
  await waitForNextPaint();
}

async function migratePendingProjects(render, team, resources, pending, token) {
  for (const item of pendingByType(pending, "project")) {
    const project = findMatchingResource(resources.projects, item, "projectId");
    if (!project) {
      continue;
    }
    const title = normalizedText(item.title) || titleOf(project, item.repoName || "project");
    const repoName = fullRepoNameOf(project);
    await setModalMessage(
      token,
      render,
      pendingItemRequiresDownload(item)
        ? `Downloading data from remote repo: ${repoName}`
        : `Migrating projects: ${title}`,
    );
    await setModalMessage(token, render, `Syncronizing with remote repo on GitHub: ${repoName}`);
    await reconcileProjectRepoSyncStates(render, team, [project], {
      clearStatusOnComplete: false,
      onSnapshots: () => {
        updateMigrationModal(token, `Syncronizing with remote repo on GitHub: ${repoName}`);
      },
    });
  }
}

async function migratePendingGlossaries(render, team, resources, pending, token) {
  for (const item of pendingByType(pending, "glossary")) {
    const glossary = findMatchingResource(resources.glossaries, item, "glossaryId");
    if (!glossary) {
      continue;
    }
    const title = normalizedText(item.title) || titleOf(glossary, item.repoName || "glossary");
    const repoName = fullRepoNameOf(glossary);
    await setModalMessage(
      token,
      render,
      pendingItemRequiresDownload(item)
        ? `Downloading data from remote repo: ${repoName}`
        : `Migrating glossaries: ${title}`,
    );
    await setModalMessage(token, render, `Syncronizing with remote repo on GitHub: ${repoName}`);
    await syncGlossaryReposForTeam(team, [glossary]);
  }
}

async function migratePendingQaLists(render, team, resources, pending, token) {
  for (const item of pendingByType(pending, "qaList")) {
    const qaList = findMatchingResource(resources.qaLists, item, "qaListId");
    if (!qaList) {
      continue;
    }
    const title = normalizedText(item.title) || titleOf(qaList, item.repoName || "QA list");
    const repoName = fullRepoNameOf(qaList);
    await setModalMessage(
      token,
      render,
      pendingItemRequiresDownload(item)
        ? `Downloading data from remote repo: ${repoName}`
        : `Migrating QA lists: ${title}`,
    );
    await setModalMessage(token, render, `Syncronizing with remote repo on GitHub: ${repoName}`);
    await syncQaListReposForTeam(team, [qaList]);
  }
}

async function runTeamResourceMigrationSyncInternal(render, team, options = {}) {
  if (
    state.offline?.isEnabled === true
    || !Number.isFinite(team?.installationId)
    || !invoke
  ) {
    return false;
  }

  let resources;
  let pendingScan;
  try {
    requireBrokerSession();
    resources = await collectTeamMigrationResources(team, options);
    pendingScan = await listPendingTeamMigrations(team, resources);
  } catch {
    return false;
  }

  const pending = Array.isArray(pendingScan?.migrations) ? pendingScan.migrations : [];
  if (!Array.isArray(pending) || pending.length === 0) {
    return false;
  }

  const token = openMigrationModal(
    "Preparing migration...",
    normalizedText(pendingScan?.targetVersion) || TEAM_REPO_LAYOUT_MIGRATION_TARGET_VERSION,
  );
  render?.();
  await waitForNextPaint();

  try {
    const attemptedPendingSignatures = new Set();
    let currentResources = resources;
    let currentPendingScan = pendingScan;

    const maxPasses = Math.max(1, migrationResourceCount(currentResources) + 2);
    for (let passIndex = 0; passIndex < maxPasses; passIndex += 1) {
      const currentPending = Array.isArray(currentPendingScan?.migrations)
        ? currentPendingScan.migrations
        : [];
      if (currentPending.length === 0) {
        return true;
      }

      const pendingSignature = pendingMigrationSignature(currentPending);
      if (attemptedPendingSignatures.has(pendingSignature)) {
        throw new Error(
          `Could not finish the 0.8.10 data migration. ${pendingMigrationDescription(currentPending)} still need migration or sync.`,
        );
      }
      attemptedPendingSignatures.add(pendingSignature);

      await migratePendingGlossaries(render, team, currentResources, currentPending, token);
      await migratePendingQaLists(render, team, currentResources, currentPending, token);
      await migratePendingProjects(render, team, currentResources, currentPending, token);

      currentResources = await collectTeamMigrationResources(team, options);
      currentPendingScan = await listPendingTeamMigrations(team, currentResources);
    }

    const remainingPending = Array.isArray(currentPendingScan?.migrations)
      ? currentPendingScan.migrations
      : [];
    if (remainingPending.length > 0) {
      throw new Error(
        `Could not finish the 0.8.10 data migration. ${pendingMigrationDescription(remainingPending)} still need migration or sync.`,
      );
    }

    return true;
  } finally {
    closeMigrationModal(token);
    render?.();
  }
}

export async function runTeamResourceMigrationSync(render, team, options = {}) {
  const teamKey = Number.isFinite(team?.installationId)
    ? `installation:${team.installationId}`
    : `team:${team?.id ?? "unknown"}`;
  const activePromise = activeTeamMigrationPromises.get(teamKey);
  if (activePromise) {
    return activePromise;
  }

  const promise = runTeamResourceMigrationSyncInternal(render, team, options)
    .finally(() => {
      activeTeamMigrationPromises.delete(teamKey);
    });
  activeTeamMigrationPromises.set(teamKey, promise);
  return promise;
}
