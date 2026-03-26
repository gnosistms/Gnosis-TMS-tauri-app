import { handleBrokerAuthExpired, requireBrokerSession } from "../auth-flow.js";
import { invoke, waitForNextPaint } from "../runtime.js";
import {
  resetTeamLeave,
  resetTeamPermanentDeletion,
  resetTeamRename,
  state,
} from "../state.js";
import {
  removeStoredTeamRecord,
  updateStoredGithubAppTeam,
  updateStoredTeamRecord,
} from "../team-storage.js";
import { applyStoredTeamRecords, resolveNextSelectedTeamId } from "./shared.js";

export function openTeamRename(render, teamId) {
  const team = state.teams.find((item) => item.id === teamId);
  if (!team) {
    return;
  }

  state.teamRename = {
    isOpen: true,
    teamId,
    teamName: team.name || team.githubOrg,
    status: "idle",
    error: "",
  };
  render();
}

export function updateTeamRenameName(teamName) {
  state.teamRename.teamName = teamName;
  if (state.teamRename.error) {
    state.teamRename.error = "";
  }
}

export function cancelTeamRename(render) {
  resetTeamRename();
  render();
}

export async function submitTeamRename(render) {
  const team = state.teams.find((item) => item.id === state.teamRename.teamId);
  if (!team?.installationId) {
    state.teamRename.error = "Team renaming currently requires a GitHub App-connected team.";
    render();
    return;
  }

  const nextName = state.teamRename.teamName.trim();
  if (!nextName) {
    state.teamRename.error = "Enter a team name.";
    render();
    return;
  }

  try {
    state.teamRename.status = "loading";
    state.teamRename.error = "";
    render();
    await waitForNextPaint();
    const organization = await invoke("update_organization_name_for_installation", {
      installationId: team.installationId,
      orgLogin: team.githubOrg,
      name: nextName,
      sessionToken: requireBrokerSession(),
    });

    const resolvedName = organization.name || organization.login;
    state.teams = state.teams.map((item) =>
      item.id === team.id ? { ...item, name: resolvedName } : item,
    );
    updateStoredGithubAppTeam(team.id, { name: resolvedName });
    resetTeamRename();
    render();
  } catch (error) {
    if (await handleBrokerAuthExpired(render, error)) {
      return;
    }
    state.teamRename.status = "idle";
    state.teamRename.error = error?.message ?? String(error);
    render();
  }
}

export function deleteTeam(render, teamId) {
  const team = state.teams.find((item) => item.id === teamId);
  if (!team) {
    return;
  }

  if (!team.canDelete) {
    openTeamLeave(render, teamId);
    return;
  }

  const nextStoredTeams = updateStoredTeamRecord(teamId, {
    isDeleted: true,
    deletedAt: new Date().toISOString(),
    syncState: "deleted",
    statusLabel: "Removed from active teams",
  });

  applyStoredTeamRecords(nextStoredTeams);
  state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, state.teams);
  if (state.teams.length === 0 && state.deletedTeams.length > 0) {
    state.showDeletedTeams = true;
  }
  render();
}

export function restoreTeam(render, teamId) {
  const team = state.deletedTeams.find((item) => item.id === teamId);
  if (!team) {
    return;
  }

  const nextStoredTeams = updateStoredTeamRecord(teamId, {
    isDeleted: false,
    deletedAt: null,
    syncState: "active",
    statusLabel: "",
  });

  applyStoredTeamRecords(nextStoredTeams);
  state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, state.teams);
  render();
}

export function openTeamPermanentDeletion(render, teamId) {
  const team = state.deletedTeams.find((item) => item.id === teamId);
  if (!team) {
    return;
  }

  state.teamPermanentDeletion = {
    isOpen: true,
    teamId,
    teamName: team.name || team.githubOrg,
    confirmationText: "",
    status: "idle",
    error: "",
  };
  render();
}

export function updateTeamPermanentDeletionConfirmation(value) {
  state.teamPermanentDeletion.confirmationText = value;
  if (state.teamPermanentDeletion.error) {
    state.teamPermanentDeletion.error = "";
  }
}

export function cancelTeamPermanentDeletion(render) {
  resetTeamPermanentDeletion();
  render();
}

export async function confirmTeamPermanentDeletion(render) {
  const deletion = state.teamPermanentDeletion;
  const team = state.deletedTeams.find((item) => item.id === deletion.teamId);
  if (!team) {
    resetTeamPermanentDeletion();
    render();
    return;
  }

  if (deletion.confirmationText !== deletion.teamName) {
    state.teamPermanentDeletion.error = "Team name confirmation does not match.";
    render();
    return;
  }

  try {
    state.teamPermanentDeletion.status = "loading";
    state.teamPermanentDeletion.error = "";
    render();
    await waitForNextPaint();
    if (!team.installationId) {
      throw new Error("Team deletion requires a GitHub App-connected team.");
    }
    await invoke("delete_organization_for_installation", {
      installationId: team.installationId,
      orgLogin: team.githubOrg,
      sessionToken: requireBrokerSession(),
    });

    const nextStoredTeams = removeStoredTeamRecord(team.id);
    applyStoredTeamRecords(nextStoredTeams);
    state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, state.teams);
    resetTeamPermanentDeletion();
    render();
  } catch (error) {
    if (await handleBrokerAuthExpired(render, error)) {
      return;
    }
    state.teamPermanentDeletion.status = "idle";
    state.teamPermanentDeletion.error = error?.message ?? String(error);
    render();
  }
}

export function openTeamLeave(render, teamId) {
  const team = state.teams.find((item) => item.id === teamId);
  if (!team) {
    return;
  }

  state.teamLeave = {
    isOpen: true,
    teamId,
    teamName: team.name || team.githubOrg,
    status: "idle",
    error: "",
  };
  render();
}

export function cancelTeamLeave(render) {
  resetTeamLeave();
  render();
}

export async function confirmTeamLeave(render) {
  const leave = state.teamLeave;
  const team = state.teams.find((item) => item.id === leave.teamId);
  if (!team?.installationId) {
    resetTeamLeave();
    render();
    return;
  }

  try {
    state.teamLeave.status = "loading";
    state.teamLeave.error = "";
    render();
    await waitForNextPaint();
    await invoke("leave_organization_for_installation", {
      installationId: team.installationId,
      orgLogin: team.githubOrg,
      sessionToken: requireBrokerSession(),
    });
    const nextStoredTeams = removeStoredTeamRecord(team.id);
    applyStoredTeamRecords(nextStoredTeams);
    state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, state.teams);
    resetTeamLeave();
    render();
  } catch (error) {
    if (await handleBrokerAuthExpired(render, error)) {
      return;
    }
    state.teamLeave.status = "idle";
    state.teamLeave.error = error?.message ?? String(error);
    render();
  }
}
