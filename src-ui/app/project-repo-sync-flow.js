import { invoke } from "./runtime.js";
import { state } from "./state.js";

const PROJECT_REPO_SYNC_POLL_DELAY_MS = 1400;

let pollTimerId = null;
let pollGeneration = 0;

function clearProjectRepoSyncPoll() {
  if (pollTimerId !== null) {
    window.clearTimeout(pollTimerId);
    pollTimerId = null;
  }
}

function buildProjectRepoSyncInput(team, projects) {
  return {
    installationId: team.installationId,
    projects: projects.map((project) => ({
      projectId: project.id,
      repoName: project.name,
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

function hasSyncingRepos(snapshots) {
  return (snapshots || []).some((snapshot) => snapshot?.status === "syncing");
}

async function pollProjectRepoSyncStates(render, teamId, input, generation) {
  if (generation !== pollGeneration || state.selectedTeamId !== teamId) {
    return;
  }

  try {
    const snapshots = await invoke("list_project_repo_sync_states", { input });
    if (generation !== pollGeneration || state.selectedTeamId !== teamId) {
      return;
    }

    applyProjectRepoSyncSnapshots(snapshots);
    render();

    if (!hasSyncingRepos(snapshots)) {
      pollTimerId = null;
      return;
    }

    pollTimerId = window.setTimeout(() => {
      void pollProjectRepoSyncStates(render, teamId, input, generation);
    }, PROJECT_REPO_SYNC_POLL_DELAY_MS);
  } catch {
    pollTimerId = null;
  }
}

export async function reconcileProjectRepoSyncStates(render, team, projects) {
  clearProjectRepoSyncPoll();
  pollGeneration += 1;
  const generation = pollGeneration;

  if (
    state.offline?.isEnabled === true ||
    !Number.isFinite(team?.installationId) ||
    !Array.isArray(projects) ||
    projects.length === 0
  ) {
    state.projectRepoSyncByProjectId = {};
    render();
    return;
  }

  try {
    const input = buildProjectRepoSyncInput(team, projects);
    const snapshots = await invoke("reconcile_project_repo_sync_states", { input });
    if (generation !== pollGeneration || state.selectedTeamId !== team?.id) {
      return;
    }

    applyProjectRepoSyncSnapshots(snapshots);
    render();

    if (!hasSyncingRepos(snapshots)) {
      return;
    }

    pollTimerId = window.setTimeout(() => {
      void pollProjectRepoSyncStates(render, team.id, input, generation);
    }, PROJECT_REPO_SYNC_POLL_DELAY_MS);
  } catch {}
}
