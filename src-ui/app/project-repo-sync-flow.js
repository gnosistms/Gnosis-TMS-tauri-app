import { invoke } from "./runtime.js";
import { state } from "./state.js";
import {
  clearScopedSyncBadge,
  showNoticeBadge,
  showScopedSyncBadge,
} from "./status-feedback.js";
import { requireBrokerSession } from "./auth-flow.js";

const PROJECT_REPO_SYNC_POLL_DELAY_MS = 1400;

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function buildProjectRepoSyncInput(team, projects) {
  return {
    installationId: team.installationId,
    projects: projects
      .filter((project) =>
        typeof project?.id === "string"
        && project.id.trim()
        && typeof project?.name === "string"
        && project.name.trim()
        && typeof project?.fullName === "string"
        && project.fullName.trim()
        && project?.remoteState !== "missing"
        && project?.remoteState !== "deleted"
        && project?.recordState !== "tombstone"
      )
      .map((project) => ({
        projectId: project.id,
        repoName: project.name,
        fullName: project.fullName,
        repoId: Number.isFinite(project.repoId) ? project.repoId : null,
        defaultBranchName: project.defaultBranchName ?? null,
        defaultBranchHeadOid: project.defaultBranchHeadOid ?? null,
      })),
  };
}

function applyProjectRepoSyncSnapshots(snapshots) {
  state.projectRepoSyncByProjectId = Object.fromEntries(
    (snapshots || []).map((snapshot) => [snapshot.projectId, snapshot]),
  );
}

function summarizeSnapshots(snapshots = []) {
  const summary = {
    syncing: 0,
    cloning: 0,
    issues: 0,
    dirty: 0,
    notCloned: 0,
    syncErrors: 0,
  };

  for (const snapshot of snapshots) {
    if (snapshot?.status === "syncing") {
      summary.syncing += 1;
      if (String(snapshot?.message || "").toLowerCase().includes("cloning")) {
        summary.cloning += 1;
      }
      continue;
    }

    if (snapshot?.status === "dirtyLocal") {
      summary.issues += 1;
      summary.dirty += 1;
      continue;
    }

    if (snapshot?.status === "notCloned") {
      summary.issues += 1;
      summary.notCloned += 1;
      continue;
    }

    if (snapshot?.status === "syncError" || snapshot?.status === "missingRemoteHead") {
      summary.issues += 1;
      summary.syncErrors += 1;
    }
  }

  return summary;
}

function syncingBadgeText(snapshots) {
  const summary = summarizeSnapshots(snapshots);
  const syncingOnly = Math.max(0, summary.syncing - summary.cloning);

  if (summary.cloning > 0 && syncingOnly > 0) {
    return `Cloning ${summary.cloning} repos and syncing ${syncingOnly} repos...`;
  }

  if (summary.cloning > 0) {
    return `Cloning ${summary.cloning} repo${summary.cloning === 1 ? "" : "s"}...`;
  }

  if (summary.syncing > 0) {
    return `Syncing ${summary.syncing} repo${summary.syncing === 1 ? "" : "s"}...`;
  }

  return "Checking local repos...";
}

function issueNoticeText(snapshots) {
  const summary = summarizeSnapshots(snapshots);
  if (summary.issues === 0) {
    return "";
  }

  if (summary.dirty > 0 && summary.syncErrors === 0 && summary.notCloned === 0) {
    return `${summary.dirty} repo${summary.dirty === 1 ? " has" : "s have"} local changes and could not be auto-synced`;
  }

  return `${summary.issues} project repo${summary.issues === 1 ? " needs" : "s need"} attention`;
}

function hasSyncingRepos(snapshots) {
  return (snapshots || []).some((snapshot) => snapshot?.status === "syncing");
}

export async function reconcileProjectRepoSyncStates(render, team, projects, options = {}) {
  const shouldAbort = typeof options.shouldAbort === "function" ? options.shouldAbort : null;

  if (shouldAbort?.()) {
    return [];
  }

  if (
    state.offline?.isEnabled === true ||
    !Number.isFinite(team?.installationId) ||
    !Array.isArray(projects) ||
    projects.length === 0
  ) {
    state.projectRepoSyncByProjectId = {};
    clearScopedSyncBadge("projects", render);
    render();
    return;
  }

  const input = buildProjectRepoSyncInput(team, projects);
  if (input.projects.length === 0) {
    state.projectRepoSyncByProjectId = {};
    clearScopedSyncBadge("projects", render);
    render();
    return;
  }
  showScopedSyncBadge("projects", "Checking local repos...", render);

  const initialSnapshots = await invoke("reconcile_project_repo_sync_states", {
    input,
    sessionToken: requireBrokerSession(),
  });
  if (shouldAbort?.()) {
    return Array.isArray(initialSnapshots) ? initialSnapshots : [];
  }
  applyProjectRepoSyncSnapshots(initialSnapshots);
  showScopedSyncBadge("projects", syncingBadgeText(initialSnapshots), render);
  render();

  let snapshots = initialSnapshots;
  while (hasSyncingRepos(snapshots)) {
    await delay(PROJECT_REPO_SYNC_POLL_DELAY_MS);
    if (shouldAbort?.() || state.selectedTeamId !== team.id) {
      return Array.isArray(snapshots) ? snapshots : [];
    }
    snapshots = await invoke("list_project_repo_sync_states", { input });
    if (shouldAbort?.()) {
      return Array.isArray(snapshots) ? snapshots : [];
    }
    applyProjectRepoSyncSnapshots(snapshots);
    showScopedSyncBadge("projects", syncingBadgeText(snapshots), render);
    render();
  }

  if (shouldAbort?.()) {
    return Array.isArray(snapshots) ? snapshots : [];
  }
  clearScopedSyncBadge("projects", render);
  const issueText = issueNoticeText(snapshots);
  if (issueText) {
    showNoticeBadge(issueText, render, 2400);
  } else {
    render();
  }

  return Array.isArray(snapshots) ? snapshots : [];
}
