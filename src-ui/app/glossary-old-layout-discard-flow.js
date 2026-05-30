import { invoke } from "./runtime.js";
import { requireBrokerSession } from "./auth-flow.js";
import { state, createRepoOldLayoutDiscardState } from "./state.js";
import { showNoticeBadge, showScopedSyncBadge, clearScopedSyncBadge } from "./status-feedback.js";
import { enqueueRepoWrite, projectRepoScope } from "./repo-write-queue.js";
import { loadTeamGlossaries } from "./glossary-discovery-flow.js";

function selectedTeam() {
  return state.teams.find((team) => team.id === state.selectedTeamId) ?? null;
}

function findGlossary(glossaryId) {
  return state.glossaries.find((glossary) => glossary?.id === glossaryId) ?? null;
}

function glossarySyncDescriptor(glossary) {
  return {
    glossaryId: glossary.id,
    repoName: glossary.repoName,
    fullName: glossary.fullName,
    repoId: Number.isFinite(glossary.repoId) ? glossary.repoId : null,
    defaultBranchName: glossary.defaultBranchName || "main",
    defaultBranchHeadOid: glossary.defaultBranchHeadOid || null,
    lifecycleState: glossary.lifecycleState || "",
    recordState: glossary.recordState || "",
    remoteState: glossary.remoteState || "",
    status: glossary.status || "",
  };
}

export function openGlossaryOldLayoutDiscard(render, glossaryId) {
  const team = selectedTeam();
  const glossary = findGlossary(glossaryId);
  if (!team?.id || !glossary) {
    showNoticeBadge("Could not find the selected glossary.", render, 2600);
    return;
  }

  state.glossaryOldLayoutDiscard = {
    isOpen: true,
    teamId: team.id,
    resourceId: glossary.id,
    resourceName: glossary.title || glossary.repoName || "Glossary",
    status: "idle",
    error: "",
  };
  render?.();
}

export function closeGlossaryOldLayoutDiscard(render) {
  if (state.glossaryOldLayoutDiscard?.status === "loading") {
    return;
  }
  state.glossaryOldLayoutDiscard = createRepoOldLayoutDiscardState();
  render?.();
}

export async function confirmGlossaryOldLayoutDiscard(render) {
  const modal = state.glossaryOldLayoutDiscard ?? {};
  if (modal.isOpen !== true || modal.status === "loading") {
    return;
  }

  const team = selectedTeam();
  const glossary = findGlossary(modal.resourceId);
  if (!Number.isFinite(team?.installationId) || team.id !== modal.teamId || !glossary) {
    state.glossaryOldLayoutDiscard = {
      ...modal,
      status: "idle",
      error: "Could not find the selected glossary.",
    };
    render?.();
    return;
  }

  if (state.offline?.isEnabled === true || state.pageSync?.status === "syncing") {
    state.glossaryOldLayoutDiscard = {
      ...modal,
      status: "idle",
      error: "Wait until the app is online and the current refresh is finished before discarding local changes.",
    };
    render?.();
    return;
  }

  const descriptor = glossarySyncDescriptor(glossary);
  if (!descriptor.repoName || !descriptor.fullName) {
    state.glossaryOldLayoutDiscard = {
      ...modal,
      status: "idle",
      error: "Could not prepare this glossary for sync recovery.",
    };
    render?.();
    return;
  }

  state.glossaryOldLayoutDiscard = { ...modal, status: "loading", error: "" };
  render?.();

  try {
    showScopedSyncBadge("glossaries", "Discarding old-format local changes...", render);
    const response = await enqueueRepoWrite({
      scope: projectRepoScope({ team, repoName: descriptor.repoName }),
      kind: "glossaryOldLayoutDiscard",
      sourceScreen: "glossaries",
      errorTarget: {
        kind: "glossaryOldLayoutDiscard",
        glossaryId: glossary.id,
      },
      run: () => invoke("discard_old_layout_gtms_glossary_repos", {
        input: {
          installationId: team.installationId,
          glossaries: [descriptor],
        },
        sessionToken: requireBrokerSession(),
      }),
    });
    const resolvedCount = Array.isArray(response?.resolvedRepoNames)
      ? response.resolvedRepoNames.length
      : 1;
    state.glossaryOldLayoutDiscard = createRepoOldLayoutDiscardState();
    showScopedSyncBadge("glossaries", "Refreshing glossary list...", render);
    await loadTeamGlossaries(render, team.id, { preserveVisibleData: true });
    clearScopedSyncBadge("glossaries", render);
    showNoticeBadge(
      resolvedCount > 0
        ? "Discarded old local changes and synced the migrated glossary from the server."
        : "This glossary no longer needed old-format recovery.",
      render,
      3600,
    );
  } catch (error) {
    clearScopedSyncBadge("glossaries", render);
    state.glossaryOldLayoutDiscard = {
      ...modal,
      status: "idle",
      error: error?.message ?? String(error),
    };
    render?.();
  }
}
