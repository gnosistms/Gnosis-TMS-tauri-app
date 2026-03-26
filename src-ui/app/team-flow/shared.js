import { splitStoredTeamRecords } from "../team-storage.js";
import { state } from "../state.js";

export function resetOpenState() {
  return {
    step: "guide",
    error: "",
    githubAppInstallationId: null,
    githubAppInstallation: null,
  };
}

export function applyStoredTeamRecords(teamRecords) {
  const { activeTeams, deletedTeams } = splitStoredTeamRecords(teamRecords);
  state.teams = activeTeams;
  state.deletedTeams = deletedTeams;
  if (deletedTeams.length === 0) {
    state.showDeletedTeams = false;
  }
}

export function resolveNextSelectedTeamId(currentTeamId, teams) {
  if (currentTeamId && teams.some((team) => team.id === currentTeamId)) {
    return currentTeamId;
  }

  return teams[0]?.id ?? null;
}

export function buildTeamRecordFromInstallation(installation) {
  return {
    id: `github-app-installation-${installation.installationId}`,
    name: installation.accountLogin,
    githubOrg: installation.accountLogin,
    ownerLogin: installation.accountLogin,
    installationId: installation.installationId,
    membershipRole: installation.membershipRole ?? "member",
    canDelete: installation.canDelete === true,
    canManageProjects: installation.canManageProjects === true,
    canLeave: installation.canLeave !== false,
    isDeleted: false,
    deletedAt: null,
    syncState: "active",
    statusLabel: "",
    lastSeenAt: new Date().toISOString(),
  };
}

export function reconcileStoredTeam(storedTeam, installation) {
  return {
    ...storedTeam,
    name: installation.accountLogin || storedTeam.name || storedTeam.githubOrg,
    githubOrg: installation.accountLogin || storedTeam.githubOrg,
    ownerLogin: installation.accountLogin || storedTeam.ownerLogin || storedTeam.githubOrg,
    membershipRole: installation.membershipRole || storedTeam.membershipRole || "member",
    canDelete: installation.canDelete === true,
    canManageProjects: installation.canManageProjects === true,
    canLeave: installation.canLeave !== false,
    lastSeenAt: new Date().toISOString(),
    isDeleted: false,
    deletedAt: null,
    syncState: "active",
    statusLabel: "",
  };
}
