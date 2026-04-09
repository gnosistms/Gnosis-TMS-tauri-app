import { invoke, waitForNextPaint } from "./runtime.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { createGlossaryDiscoveryState, state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { normalizeGlossarySummary, selectedTeam, sortGlossaries } from "./glossary-shared.js";
import { loadStoredGlossariesForTeam, saveStoredGlossariesForTeam } from "./glossary-cache.js";
import {
  listLocalGlossarySummariesForTeam,
  loadRepoBackedGlossariesForTeam,
} from "./glossary-repo-flow.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";

function applyGlossaryList(glossaries, teamId = state.selectedTeamId) {
  if (state.selectedTeamId !== teamId) {
    return;
  }

  state.glossaries = sortGlossaries(
    (Array.isArray(glossaries) ? glossaries : [])
      .map(normalizeGlossarySummary)
      .filter(Boolean),
  );

  const activeGlossaries = state.glossaries.filter((glossary) => glossary.lifecycleState !== "deleted");
  if (!activeGlossaries.some((glossary) => glossary.id === state.selectedGlossaryId)) {
    state.selectedGlossaryId = activeGlossaries[0]?.id ?? null;
  }
}

export function primeGlossariesLoadingState(teamId = state.selectedTeamId) {
  const team = selectedTeam(teamId);
  state.selectedTeamId = teamId ?? state.selectedTeamId;

  if (!Number.isFinite(team?.installationId)) {
    state.glossaries = [];
    state.selectedGlossaryId = null;
    state.glossaryDiscovery = {
      ...createGlossaryDiscoveryState(),
      status: "ready",
    };
    return;
  }

  const cachedGlossaries = loadStoredGlossariesForTeam(team);
  if (cachedGlossaries.exists) {
    applyGlossaryList(cachedGlossaries.glossaries, teamId);
    state.glossaryDiscovery = {
      ...createGlossaryDiscoveryState(),
      status: "ready",
    };
    return;
  }

  state.glossaries = [];
  state.selectedGlossaryId = null;
  state.glossaryDiscovery = {
    ...createGlossaryDiscoveryState(),
    status: "loading",
  };
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
    state.glossaryDiscovery = {
      ...createGlossaryDiscoveryState(),
      status: "ready",
    };
    render();
    return;
  }

  const cachedGlossaries = loadStoredGlossariesForTeam(team);

  if (!preserveVisibleData) {
    if (cachedGlossaries.exists) {
      applyGlossaryList(cachedGlossaries.glossaries, team.id);
      state.glossaryDiscovery = {
        ...createGlossaryDiscoveryState(),
        status: "ready",
      };
    } else if (state.glossaries.length === 0) {
      state.glossaries = [];
      state.selectedGlossaryId = null;
      state.glossaryDiscovery = {
        ...createGlossaryDiscoveryState(),
        status: "loading",
      };
    }
  }

  beginPageSync();
  render();
  await waitForNextPaint();

  try {
    if (!preserveVisibleData && !cachedGlossaries.exists) {
      const localGlossaries = await listLocalGlossarySummariesForTeam(team);
      if (localGlossaries.length > 0 && state.selectedTeamId === team.id) {
        applyGlossaryList(localGlossaries, team.id);
        state.glossaryDiscovery = {
          ...createGlossaryDiscoveryState(),
          status: "ready",
        };
        saveStoredGlossariesForTeam(team, state.glossaries);
        render();
        await waitForNextPaint();
      }
    }

    const { glossaries, syncIssue, brokerWarning } = await loadRepoBackedGlossariesForTeam(team, {
      offlineMode: state.offline?.isEnabled === true,
    });
    applyGlossaryList(glossaries, team.id);
    saveStoredGlossariesForTeam(team, state.glossaries);

    state.glossaryDiscovery = {
      ...createGlossaryDiscoveryState(),
      status: "ready",
      brokerWarning: typeof brokerWarning === "string" ? brokerWarning : "",
    };
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
        ...createGlossaryDiscoveryState(),
        status: "error",
        error: error?.message ?? String(error),
      };
    }
    showNoticeBadge(error?.message ?? String(error), render);
    render();
  }
}
