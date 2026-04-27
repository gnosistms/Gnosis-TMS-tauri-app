import { invoke } from "./runtime.js";
import { state } from "./state.js";
import {
  clearScopedSyncBadge,
  showNoticeBadge,
  showScopedSyncBadge,
} from "./status-feedback.js";
import { requireBrokerSession } from "./auth-flow.js";
import {
  buildProjectRepoSyncInput,
  PROJECT_REPO_SYNC_STATUS_IMPORTED_EDITOR_CONFLICTS,
  PROJECT_REPO_SYNC_STATUS_UNRESOLVED_CONFLICT,
  PROJECT_REPO_SYNC_STATUS_UPDATE_REQUIRED,
} from "./project-repo-sync-shared.js";
import { requireAppUpdate } from "./updater-flow.js";

const PROJECT_REPO_SYNC_POLL_DELAY_MS = 1400;

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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

    if (
      snapshot?.status === "syncError"
      || snapshot?.status === "missingRemoteHead"
      || snapshot?.status === PROJECT_REPO_SYNC_STATUS_UNRESOLVED_CONFLICT
      || snapshot?.status === PROJECT_REPO_SYNC_STATUS_IMPORTED_EDITOR_CONFLICTS
      || snapshot?.status === PROJECT_REPO_SYNC_STATUS_UPDATE_REQUIRED
    ) {
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

function openRequiredAppUpdatePromptFromProjectSnapshots(snapshots, render) {
  const requiredSnapshot = (Array.isArray(snapshots) ? snapshots : []).find(
    (snapshot) => snapshot?.status === PROJECT_REPO_SYNC_STATUS_UPDATE_REQUIRED,
  );
  if (!requiredSnapshot) {
    return false;
  }

  return requireAppUpdate(
    {
      requiredVersion: requiredSnapshot.requiredAppVersion ?? null,
      currentVersion: requiredSnapshot.currentAppVersion ?? null,
      message: requiredSnapshot.message ?? "",
    },
    render,
  );
}

export async function reconcileProjectRepoSyncStates(render, team, projects, options = {}) {
  const shouldAbort = typeof options.shouldAbort === "function" ? options.shouldAbort : null;
  const clearStatusOnComplete = options.clearStatusOnComplete !== false;

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
    if (clearStatusOnComplete) {
      clearScopedSyncBadge("projects", render);
    }
    render();
    return;
  }

  const input = buildProjectRepoSyncInput(team, projects);
  if (input.projects.length === 0) {
    state.projectRepoSyncByProjectId = {};
    if (clearStatusOnComplete) {
      clearScopedSyncBadge("projects", render);
    }
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
  openRequiredAppUpdatePromptFromProjectSnapshots(initialSnapshots, render);
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
    openRequiredAppUpdatePromptFromProjectSnapshots(snapshots, render);
    showScopedSyncBadge("projects", syncingBadgeText(snapshots), render);
    render();
  }

  if (shouldAbort?.()) {
    return Array.isArray(snapshots) ? snapshots : [];
  }
  if (clearStatusOnComplete) {
    clearScopedSyncBadge("projects", render);
  }
  openRequiredAppUpdatePromptFromProjectSnapshots(snapshots, render);
  const issueText = issueNoticeText(snapshots);
  if (issueText) {
    showNoticeBadge(issueText, render, 2400);
  } else {
    render();
  }

  return Array.isArray(snapshots) ? snapshots : [];
}
