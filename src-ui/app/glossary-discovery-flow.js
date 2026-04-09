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

export function primeGlossariesLoadingState(teamId = state.selectedTeamId, options = {}) {
  const team = selectedTeam(teamId);
  state.selectedTeamId = teamId ?? state.selectedTeamId;
  const preserveVisibleData = options.preserveVisibleData === true;
  state.glossaryRepoSyncByRepoName = {};

  if (!Number.isFinite(team?.installationId)) {
    state.glossaries = [];
    state.selectedGlossaryId = null;
    state.glossaryRepoSyncByRepoName = {};
    state.glossaryDiscovery = {
      ...createGlossaryDiscoveryState(),
      status: "ready",
      recoveryMessage: "",
    };
    return;
  }

  if (preserveVisibleData && state.glossaries.length > 0) {
    state.glossaryDiscovery = {
      ...createGlossaryDiscoveryState(),
      status: "ready",
      recoveryMessage: "",
    };
    return;
  }

  const cachedGlossaries = loadStoredGlossariesForTeam(team);
  if (cachedGlossaries.exists) {
    applyGlossaryList(cachedGlossaries.glossaries, teamId);
    state.glossaryDiscovery = {
      ...createGlossaryDiscoveryState(),
      status: "ready",
      recoveryMessage: "",
    };
    return;
  }

  state.glossaries = [];
  state.selectedGlossaryId = null;
  state.glossaryDiscovery = {
    ...createGlossaryDiscoveryState(),
    status: "loading",
    recoveryMessage: "",
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
  state.glossaryRepoSyncByRepoName = {};

  if (!Number.isFinite(team?.installationId)) {
    state.glossaries = [];
    state.selectedGlossaryId = null;
    state.glossaryDiscovery = {
      ...createGlossaryDiscoveryState(),
      status: "ready",
      recoveryMessage: "",
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
        recoveryMessage: "",
      };
    } else if (state.glossaries.length === 0) {
      state.glossaries = [];
      state.selectedGlossaryId = null;
      state.glossaryDiscovery = {
        ...createGlossaryDiscoveryState(),
        status: "loading",
        recoveryMessage: "",
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
          recoveryMessage: "",
        };
        saveStoredGlossariesForTeam(team, state.glossaries);
        render();
        await waitForNextPaint();
      }
    }

    const {
      glossaries,
      syncIssue,
      brokerWarning,
      syncSnapshots = [],
      recoveryMessage = "",
    } = await loadRepoBackedGlossariesForTeam(team, {
      offlineMode: state.offline?.isEnabled === true,
      onRecoveryDetected: (message) => {
        if (state.selectedTeamId !== team.id) {
          return;
        }
        state.glossaryDiscovery = {
          ...createGlossaryDiscoveryState(),
          status: "loading",
          recoveryMessage: message,
        };
        render();
      },
    });
    state.glossaryRepoSyncByRepoName = Object.fromEntries(
      (Array.isArray(syncSnapshots) ? syncSnapshots : [])
        .map((snapshot) => [
          typeof snapshot?.repoName === "string" ? snapshot.repoName : "",
          snapshot,
        ])
        .filter(([repoName]) => repoName),
    );
    let nextGlossaries = glossaries;
    if (preserveVisibleData && nextGlossaries.length === 0) {
      const localGlossaries = await listLocalGlossarySummariesForTeam(team);
      if (localGlossaries.length > 0) {
        nextGlossaries = localGlossaries;
      }
    }

    applyGlossaryList(nextGlossaries, team.id);
    saveStoredGlossariesForTeam(team, state.glossaries);

    state.glossaryDiscovery = {
      ...createGlossaryDiscoveryState(),
      status: "ready",
      brokerWarning: typeof brokerWarning === "string" ? brokerWarning : "",
      recoveryMessage: typeof recoveryMessage === "string" ? recoveryMessage : "",
    };
    const syncIssueText =
      typeof syncIssue?.message === "string"
        ? syncIssue.message
        : typeof syncIssue === "string"
          ? syncIssue
          : "";
    if (syncIssueText) {
      showNoticeBadge(syncIssueText, render);
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
    state.glossaryRepoSyncByRepoName = {};
    const hasVisibleLocalData = state.glossaries.length > 0;
    if (!preserveVisibleData && !hasVisibleLocalData && state.glossaryDiscovery?.status !== "ready") {
      state.glossaryDiscovery = {
        ...createGlossaryDiscoveryState(),
        status: "error",
        error: error?.message ?? String(error),
        recoveryMessage: "",
      };
    } else {
      state.glossaryDiscovery = {
        ...createGlossaryDiscoveryState(),
        status: "ready",
        brokerWarning: state.glossaryDiscovery?.brokerWarning ?? "",
        recoveryMessage: state.glossaryDiscovery?.recoveryMessage ?? "",
      };
    }
    showNoticeBadge(error?.message ?? String(error), render);
    render();
  }
}
