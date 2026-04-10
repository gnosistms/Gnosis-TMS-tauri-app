export function canCreateRepoResources(team) {
  return team?.canDelete === true;
}

export function canPermanentlyDeleteRepoResources(team) {
  return team?.canDelete === true;
}

export function shouldShowNewProjectButton(team) {
  return canCreateRepoResources(team);
}

export function shouldShowGlossaryCreationControls(team) {
  return canCreateRepoResources(team);
}

export function shouldShowDeletedProjectPermanentDelete(team) {
  return canPermanentlyDeleteRepoResources(team);
}

export function shouldShowDeletedGlossaryPermanentDelete(team) {
  return canPermanentlyDeleteRepoResources(team);
}
