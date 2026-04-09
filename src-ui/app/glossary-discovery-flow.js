import { invoke, waitForNextPaint } from "./runtime.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import {
  normalizeGlossarySummary,
  selectedTeam,
  sortGlossaries,
} from "./glossary-shared.js";

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
    const glossaries = await invoke("list_local_gtms_glossaries", {
      input: { installationId: team.installationId },
    });
    state.glossaries = sortGlossaries(
      (Array.isArray(glossaries) ? glossaries : [])
        .map(normalizeGlossarySummary)
        .filter(Boolean),
    );

    if (!state.glossaries.some((glossary) => glossary.id === state.selectedGlossaryId)) {
      state.selectedGlossaryId = state.glossaries[0]?.id ?? null;
    }

    state.glossaryDiscovery = { status: "ready", error: "" };
    await completePageSync(render);
  } catch (error) {
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
