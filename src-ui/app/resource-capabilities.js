import {
  canDownload,
  canLocalHardDelete,
  canManageGlossaryResources,
  canManageMembers,
  canManageProjects,
  canManageQaListResources,
  canManageTeam,
  canWriteChapters,
  canWriteGlossaries,
  canWriteQaLists,
  isReadOnlyViewerRole,
} from "./permissions.js";

export function isReadOnlyViewerTeam(team) {
  return isReadOnlyViewerRole(team?.membershipRole ?? team?.role);
}

export function canMutateProjectFiles(team) {
  return canManageProjects(team);
}

export function canEditProjectFileContent(team) {
  return canWriteChapters(team);
}

export function canDownloadProjectFiles(team) {
  return canDownload(team);
}

export function canCreateRepoResources(team) {
  return canManageProjects(team);
}

export function canPermanentlyDeleteRepoResources(team) {
  return canLocalHardDelete(team);
}

export function canManageTeamAiSettings(team) {
  return canManageTeam(team);
}

export function shouldShowNewProjectButton(team) {
  return canManageProjects(team);
}

export function shouldShowGlossaryCreationControls(team) {
  return canManageGlossaryResources(team);
}

export function shouldShowQaListCreationControls(team) {
  return canManageQaListResources(team);
}

export function shouldShowDeletedProjectPermanentDelete(team) {
  return canLocalHardDelete(team);
}

export function shouldShowDeletedGlossaryPermanentDelete(team) {
  return canLocalHardDelete(team);
}

export function shouldShowDeletedQaListPermanentDelete(team) {
  return canLocalHardDelete(team);
}

export function canPermanentlyDeleteProjectFiles(team) {
  return canLocalHardDelete(team);
}

export {
  canDownload,
  canLocalHardDelete,
  canManageGlossaryResources,
  canManageMembers,
  canManageProjects,
  canManageQaListResources,
  canManageTeam,
  canWriteChapters,
  canWriteGlossaries,
  canWriteQaLists,
};
