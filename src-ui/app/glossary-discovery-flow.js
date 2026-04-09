import { invoke, waitForNextPaint } from "./runtime.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { selectedTeam } from "./glossary-shared.js";
import {
  getGlossarySyncIssueMessage,
  loadRepoBackedGlossariesForTeam,
} from "./glossary-repo-flow.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";

export function primeGlossariesLoadingState(teamId = state.selectedTeamId) {
  const team = selectedTeam(teamId);
  state.selectedTeamId = teamId ?? state.selectedTeamId;

  if (!Number.isFinite(team?.installationId)) {
    state.glossaries = [];
    state.selectedGlossaryId = null;
    state.glossaryDiscovery = { status: "ready", error: "" };
    return;
  }

  state.glossaries = [];
  state.selectedGlossaryId = null;
  state.glossaryDiscovery = { status: "loading", error: "" };
}

export async function loadTeamGlossaries(
  render,
  teamId = state.selectedTeamId,
  options = {},
) {
  const preserveVisibleData = options.preserveVisibleData === true;
  const team = selectedTeam(teamId);
  state.selectedTeamId = teamId ?? state.selectedTeamId;

  if (!Number.isFinite(team?.installationId)) {
    state.glossaries = [];
    state.selectedGlossaryId = null;
    state.glossaryDiscovery = { status: "ready", error: "" };
    render();
    return;
  }

  if (!preserveVisibleData && state.glossaries.length === 0) {
    state.glossaryDiscovery = { status: "loading", error: "" };
  }

  beginPageSync();
  render();
  await waitForNextPaint();

  try {
    const { glossaries, syncSnapshots, brokerWarning } = await loadRepoBackedGlossariesForTeam(team, {
      offlineMode: state.offline?.isEnabled === true,
    });
    state.glossaries = glossaries;

    const activeGlossaries = state.glossaries.filter((glossary) => glossary.lifecycleState !== "deleted");
    if (!activeGlossaries.some((glossary) => glossary.id === state.selectedGlossaryId)) {
      state.selectedGlossaryId = activeGlossaries[0]?.id ?? null;
    }

    state.glossaryDiscovery = { status: "ready", error: "" };
    const syncIssue = getGlossarySyncIssueMessage(syncSnapshots);
    if (syncIssue) {
      showNoticeBadge(syncIssue, render);
    } else if (brokerWarning) {
      showNoticeBadge(brokerWarning, render);
    }
    await completePageSync(render);
  } catch (error) {
    if (
      await handleSyncFailure(classifySyncError(error), {
        render,
        teamId: team?.id ?? null,
        currentResource: true,
      })
    ) {
      failPageSync();
      return;
    }

    failPageSync();
    if (!preserveVisibleData || state.glossaryDiscovery?.status !== "ready") {
      state.glossaryDiscovery = {
        status: "error",
        error: error?.message ?? String(error),
      };
    }
    showNoticeBadge(error?.message ?? String(error), render);
    render();
  }
}
