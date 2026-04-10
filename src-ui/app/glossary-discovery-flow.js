import { waitForNextPaint } from "./runtime.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { createGlossaryDiscoveryState, state } from "./state.js";
import { clearNoticeBadge, showNoticeBadge } from "./status-feedback.js";
import { selectedTeam } from "./glossary-shared.js";
import {
  listLocalGlossarySummariesForTeam,
  loadRepoBackedGlossariesForTeam,
} from "./glossary-repo-flow.js";
import {
  applyGlossarySnapshotToState,
  glossarySnapshotFromList,
  persistGlossariesForTeam,
} from "./glossary-top-level-state.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";

export function primeGlossariesLoadingState(teamId = state.selectedTeamId, options = {}) {
  const team = selectedTeam(teamId);
  state.selectedTeamId = teamId ?? state.selectedTeamId;
  const preserveVisibleData = options.preserveVisibleData === true;
  state.glossaryRepoSyncByRepoName = {};
  state.glossariesPage.isRefreshing = false;
  state.glossariesPage.writeState = "idle";

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
  const syncVersionAtStart = state.glossarySyncVersion;
  const preserveVisibleData = options.preserveVisibleData === true;
  const team = selectedTeam(teamId);
  state.selectedTeamId = teamId ?? state.selectedTeamId;
  state.glossaryRepoSyncByRepoName = {};
  state.glossariesPage.isRefreshing = true;
  render?.();

  if (!Number.isFinite(team?.installationId)) {
    state.glossaries = [];
    state.selectedGlossaryId = null;
    state.glossaryDiscovery = {
      ...createGlossaryDiscoveryState(),
      status: "ready",
      recoveryMessage: "",
    };
    state.glossariesPage.isRefreshing = false;
    render();
    return;
  }

  if (!preserveVisibleData) {
    if (state.glossaries.length === 0) {
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
  showNoticeBadge("Loading glossaries...", render, null);
  render();
  await waitForNextPaint();

  try {
    if (!preserveVisibleData) {
      const localGlossaries = await listLocalGlossarySummariesForTeam(team);
      if (syncVersionAtStart !== state.glossarySyncVersion) {
        await completePageSync(render);
        clearNoticeBadge();
        state.glossariesPage.isRefreshing = false;
        render();
        return;
      }
      if (localGlossaries.length > 0 && state.selectedTeamId === team.id) {
        applyGlossarySnapshotToState(glossarySnapshotFromList(localGlossaries), { teamId: team.id });
        state.glossaryDiscovery = {
          ...createGlossaryDiscoveryState(),
          status: "ready",
          recoveryMessage: "",
        };
        persistGlossariesForTeam(team);
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
    if (syncVersionAtStart !== state.glossarySyncVersion) {
      await completePageSync(render);
      clearNoticeBadge();
      state.glossariesPage.isRefreshing = false;
      render();
      return;
    }
    showNoticeBadge("Refreshing glossary list...", render, null);
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

    applyGlossarySnapshotToState(glossarySnapshotFromList(nextGlossaries), { teamId: team.id });
    persistGlossariesForTeam(team);

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
    if (!syncIssueText && !brokerWarning) {
      clearNoticeBadge();
    }
    state.glossariesPage.isRefreshing = false;
    render();
  } catch (error) {
    if (syncVersionAtStart !== state.glossarySyncVersion) {
      failPageSync();
      clearNoticeBadge();
      state.glossariesPage.isRefreshing = false;
      render();
      return;
    }
    if (
      await handleSyncFailure(classifySyncError(error), {
        render,
        teamId: team?.id ?? null,
        currentResource: true,
      })
    ) {
      failPageSync();
      state.glossariesPage.isRefreshing = false;
      return;
    }

    failPageSync();
    clearNoticeBadge();
    state.glossariesPage.isRefreshing = false;
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
