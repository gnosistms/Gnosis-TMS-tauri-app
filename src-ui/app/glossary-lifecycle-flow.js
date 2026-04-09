import { invoke, waitForNextPaint } from "./runtime.js";
import {
  resetGlossaryPermanentDeletion,
  resetGlossaryRename,
  state,
} from "./state.js";
import { loadTeamGlossaries } from "./glossary-discovery-flow.js";
import {
  canManageGlossaries,
  canPermanentlyDeleteGlossaries,
  selectedTeam,
} from "./glossary-shared.js";
import { showNoticeBadge } from "./status-feedback.js";
import { permanentlyDeleteRemoteGlossaryRepoForTeam } from "./glossary-repo-flow.js";

function glossaryById(glossaryId) {
  return state.glossaries.find((glossary) => glossary.id === glossaryId) ?? null;
}

function lifecycleActionBlockedMessage(team, { actionLabel, requireOwner = false } = {}) {
  if (!Number.isFinite(team?.installationId)) {
    return "This glossary action requires a GitHub App-connected team.";
  }
  if (state.offline?.isEnabled === true) {
    return `You cannot ${actionLabel} while offline.`;
  }
  if (requireOwner ? !canPermanentlyDeleteGlossaries(team) : !canManageGlossaries(team)) {
    return `You do not have permission to ${actionLabel} in this team.`;
  }
  return "";
}

export function toggleDeletedGlossaries(render) {
  state.showDeletedGlossaries = !state.showDeletedGlossaries;
  render();
}

export function openGlossaryRename(render, glossaryId) {
  const glossary = glossaryById(glossaryId);
  const team = selectedTeam();
  const blockedMessage = lifecycleActionBlockedMessage(team, { actionLabel: "rename glossaries" });

  if (!glossary || glossary.lifecycleState === "deleted") {
    showNoticeBadge("Could not find the selected glossary.", render);
    return;
  }
  if (blockedMessage) {
    showNoticeBadge(blockedMessage, render);
    return;
  }

  state.glossaryRename = {
    isOpen: true,
    status: "idle",
    error: "",
    glossaryId,
    glossaryName: glossary.title,
  };
  render();
}

export function updateGlossaryRenameName(value) {
  state.glossaryRename.glossaryName = value;
  if (state.glossaryRename.error) {
    state.glossaryRename.error = "";
  }
}

export function cancelGlossaryRename(render) {
  resetGlossaryRename();
  render();
}

export async function submitGlossaryRename(render) {
  const team = selectedTeam();
  const glossary = glossaryById(state.glossaryRename.glossaryId);
  const nextTitle = String(state.glossaryRename.glossaryName ?? "").trim();
  const blockedMessage = lifecycleActionBlockedMessage(team, { actionLabel: "rename glossaries" });

  if (!glossary) {
    state.glossaryRename.error = "Could not find the selected glossary.";
    render();
    return;
  }
  if (blockedMessage) {
    state.glossaryRename.error = blockedMessage;
    render();
    return;
  }
  if (!nextTitle) {
    state.glossaryRename.error = "Enter a glossary name.";
    render();
    return;
  }

  state.glossaryRename.status = "loading";
  state.glossaryRename.error = "";
  render();
  await waitForNextPaint();

  try {
    await invoke("rename_gtms_glossary", {
      input: {
        installationId: team.installationId,
        repoName: glossary.repoName,
        title: nextTitle,
      },
    });
    resetGlossaryRename();
    await loadTeamGlossaries(render, team.id, { preserveVisibleData: true });
  } catch (error) {
    state.glossaryRename.status = "idle";
    state.glossaryRename.error = error?.message ?? String(error);
    render();
  }
}

export async function deleteGlossary(render, glossaryId) {
  const team = selectedTeam();
  const glossary = glossaryById(glossaryId);
  const blockedMessage = lifecycleActionBlockedMessage(team, { actionLabel: "delete glossaries" });

  if (!glossary || glossary.lifecycleState === "deleted") {
    showNoticeBadge("Could not find the selected glossary.", render);
    return;
  }
  if (blockedMessage) {
    showNoticeBadge(blockedMessage, render);
    return;
  }

  try {
    await invoke("soft_delete_gtms_glossary", {
      input: {
        installationId: team.installationId,
        repoName: glossary.repoName,
      },
    });
    if (state.selectedGlossaryId === glossaryId) {
      state.selectedGlossaryId = null;
    }
    await loadTeamGlossaries(render, team.id, { preserveVisibleData: true });
  } catch (error) {
    showNoticeBadge(error?.message ?? String(error), render);
  }
}

export async function restoreGlossary(render, glossaryId) {
  const team = selectedTeam();
  const glossary = glossaryById(glossaryId);
  const blockedMessage = lifecycleActionBlockedMessage(team, { actionLabel: "restore glossaries" });

  if (!glossary || glossary.lifecycleState !== "deleted") {
    showNoticeBadge("Could not find the selected deleted glossary.", render);
    return;
  }
  if (blockedMessage) {
    showNoticeBadge(blockedMessage, render);
    return;
  }

  try {
    await invoke("restore_gtms_glossary", {
      input: {
        installationId: team.installationId,
        repoName: glossary.repoName,
      },
    });
    await loadTeamGlossaries(render, team.id, { preserveVisibleData: true });
  } catch (error) {
    showNoticeBadge(error?.message ?? String(error), render);
  }
}

export function openGlossaryPermanentDeletion(render, glossaryId) {
  const glossary = glossaryById(glossaryId);
  const team = selectedTeam();
  const blockedMessage = lifecycleActionBlockedMessage(team, {
    actionLabel: "permanently delete glossaries",
    requireOwner: true,
  });

  if (!glossary || glossary.lifecycleState !== "deleted") {
    showNoticeBadge("Could not find the selected deleted glossary.", render);
    return;
  }
  if (blockedMessage) {
    showNoticeBadge(blockedMessage, render);
    return;
  }

  state.glossaryPermanentDeletion = {
    isOpen: true,
    status: "idle",
    error: "",
    glossaryId,
    glossaryName: glossary.title,
    confirmationText: "",
  };
  render();
}

export function updateGlossaryPermanentDeletionConfirmation(value) {
  state.glossaryPermanentDeletion.confirmationText = value;
  if (state.glossaryPermanentDeletion.error) {
    state.glossaryPermanentDeletion.error = "";
  }
}

export function cancelGlossaryPermanentDeletion(render) {
  resetGlossaryPermanentDeletion();
  render();
}

export async function confirmGlossaryPermanentDeletion(render) {
  const team = selectedTeam();
  const glossary = glossaryById(state.glossaryPermanentDeletion.glossaryId);
  const confirmationText = String(state.glossaryPermanentDeletion.confirmationText ?? "");
  const blockedMessage = lifecycleActionBlockedMessage(team, {
    actionLabel: "permanently delete glossaries",
    requireOwner: true,
  });

  if (!glossary) {
    state.glossaryPermanentDeletion.error = "Could not find the selected glossary.";
    render();
    return;
  }
  if (blockedMessage) {
    state.glossaryPermanentDeletion.error = blockedMessage;
    render();
    return;
  }
  if (confirmationText !== state.glossaryPermanentDeletion.glossaryName) {
    state.glossaryPermanentDeletion.error = "Enter the glossary name exactly to delete it.";
    render();
    return;
  }

  state.glossaryPermanentDeletion.status = "loading";
  state.glossaryPermanentDeletion.error = "";
  render();
  await waitForNextPaint();

  try {
    await permanentlyDeleteRemoteGlossaryRepoForTeam(team, glossary.repoName);
    await invoke("purge_local_gtms_glossary_repo", {
      input: {
        installationId: team.installationId,
        repoName: glossary.repoName,
      },
    });
    if (state.selectedGlossaryId === glossary.id) {
      state.selectedGlossaryId = null;
    }
    resetGlossaryPermanentDeletion();
    await loadTeamGlossaries(render, team.id, { preserveVisibleData: true });
  } catch (error) {
    state.glossaryPermanentDeletion.status = "idle";
    state.glossaryPermanentDeletion.error = error?.message ?? String(error);
    render();
  }
}
