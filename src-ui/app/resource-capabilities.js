export function isReadOnlyViewerTeam(team) {
  const membershipRole = String(team?.membershipRole ?? team?.role ?? "").trim().toLowerCase();
  return (
    membershipRole === "viewer"
    || membershipRole === "read_only"
    || membershipRole === "read-only"
    || membershipRole === "readonly"
  );
}

export function canMutateProjectFiles(team) {
  return team?.canManageProjects === true && !isReadOnlyViewerTeam(team);
}

export function canDownloadProjectFiles(team) {
  return Boolean(team);
}

export function canCreateRepoResources(team) {
  return team?.canDelete === true && !isReadOnlyViewerTeam(team);
}

export function canPermanentlyDeleteRepoResources(team) {
  return team?.canDelete === true && !isReadOnlyViewerTeam(team);
}

export function canManageTeamAiSettings(team) {
  return team?.canDelete === true && !isReadOnlyViewerTeam(team);
}

export function shouldShowNewProjectButton(team) {
  return canCreateRepoResources(team);
}

export function shouldShowGlossaryCreationControls(team) {
  return canCreateRepoResources(team);
}

export function shouldShowQaListCreationControls(team) {
  return canCreateRepoResources(team);
}

export function shouldShowDeletedProjectPermanentDelete(team) {
  return canPermanentlyDeleteRepoResources(team);
}

export function shouldShowDeletedGlossaryPermanentDelete(team) {
  return canPermanentlyDeleteRepoResources(team);
}

export function shouldShowDeletedQaListPermanentDelete(team) {
  return canPermanentlyDeleteRepoResources(team);
}

export function canPermanentlyDeleteProjectFiles(team) {
  return canMutateProjectFiles(team);
}
