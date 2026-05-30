import { invoke } from "./runtime.js";
import { requireBrokerSession } from "./auth-flow.js";
import { state, createRepoOldLayoutDiscardState } from "./state.js";
import { showNoticeBadge, showScopedSyncBadge, clearScopedSyncBadge } from "./status-feedback.js";
import { enqueueRepoWrite, projectRepoScope } from "./repo-write-queue.js";
import { loadTeamQaLists } from "./qa-list-discovery-flow.js";

function selectedTeam() {
  return state.teams.find((team) => team.id === state.selectedTeamId) ?? null;
}

function findQaList(qaListId) {
  return state.qaLists.find((qaList) => qaList?.id === qaListId) ?? null;
}

function qaListSyncDescriptor(qaList) {
  return {
    qaListId: qaList.id,
    repoName: qaList.repoName,
    fullName: qaList.fullName,
    repoId: Number.isFinite(qaList.repoId) ? qaList.repoId : null,
    defaultBranchName: qaList.defaultBranchName || "main",
    defaultBranchHeadOid: qaList.defaultBranchHeadOid || null,
    lifecycleState: qaList.lifecycleState || "",
    recordState: qaList.recordState || "",
    remoteState: qaList.remoteState || "",
    status: qaList.status || "",
  };
}

export function openQaListOldLayoutDiscard(render, qaListId) {
  const team = selectedTeam();
  const qaList = findQaList(qaListId);
  if (!team?.id || !qaList) {
    showNoticeBadge("Could not find the selected QA list.", render, 2600);
    return;
  }

  state.qaListOldLayoutDiscard = {
    isOpen: true,
    teamId: team.id,
    resourceId: qaList.id,
    resourceName: qaList.title || qaList.repoName || "QA list",
    status: "idle",
    error: "",
  };
  render?.();
}

export function closeQaListOldLayoutDiscard(render) {
  if (state.qaListOldLayoutDiscard?.status === "loading") {
    return;
  }
  state.qaListOldLayoutDiscard = createRepoOldLayoutDiscardState();
  render?.();
}

export async function confirmQaListOldLayoutDiscard(render) {
  const modal = state.qaListOldLayoutDiscard ?? {};
  if (modal.isOpen !== true || modal.status === "loading") {
    return;
  }

  const team = selectedTeam();
  const qaList = findQaList(modal.resourceId);
  if (!Number.isFinite(team?.installationId) || team.id !== modal.teamId || !qaList) {
    state.qaListOldLayoutDiscard = {
      ...modal,
      status: "idle",
      error: "Could not find the selected QA list.",
    };
    render?.();
    return;
  }

  if (state.offline?.isEnabled === true || state.pageSync?.status === "syncing") {
    state.qaListOldLayoutDiscard = {
      ...modal,
      status: "idle",
      error: "Wait until the app is online and the current refresh is finished before discarding local changes.",
    };
    render?.();
    return;
  }

  const descriptor = qaListSyncDescriptor(qaList);
  if (!descriptor.repoName || !descriptor.fullName) {
    state.qaListOldLayoutDiscard = {
      ...modal,
      status: "idle",
      error: "Could not prepare this QA list for sync recovery.",
    };
    render?.();
    return;
  }

  state.qaListOldLayoutDiscard = { ...modal, status: "loading", error: "" };
  render?.();

  try {
    showScopedSyncBadge("qa", "Discarding old-format local changes...", render);
    const response = await enqueueRepoWrite({
      scope: projectRepoScope({ team, repoName: descriptor.repoName }),
      kind: "qaListOldLayoutDiscard",
      sourceScreen: "qa",
      errorTarget: {
        kind: "qaListOldLayoutDiscard",
        qaListId: qaList.id,
      },
      run: () => invoke("discard_old_layout_gtms_qa_list_repos", {
        input: {
          installationId: team.installationId,
          qaLists: [descriptor],
        },
        sessionToken: requireBrokerSession(),
      }),
    });
    const resolvedCount = Array.isArray(response?.resolvedRepoNames)
      ? response.resolvedRepoNames.length
      : 1;
    state.qaListOldLayoutDiscard = createRepoOldLayoutDiscardState();
    showScopedSyncBadge("qa", "Refreshing QA list...", render);
    await loadTeamQaLists(render, team.id, { preserveVisibleData: true });
    clearScopedSyncBadge("qa", render);
    showNoticeBadge(
      resolvedCount > 0
        ? "Discarded old local changes and synced the migrated QA list from the server."
        : "This QA list no longer needed old-format recovery.",
      render,
      3600,
    );
  } catch (error) {
    clearScopedSyncBadge("qa", render);
    state.qaListOldLayoutDiscard = {
      ...modal,
      status: "idle",
      error: error?.message ?? String(error),
    };
    render?.();
  }
}
