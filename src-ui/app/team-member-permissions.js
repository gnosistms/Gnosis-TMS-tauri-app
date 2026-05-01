export function isOwnerRole(user) {
  return String(user?.role ?? "").trim().toLowerCase() === "owner";
}

export function countOwners(users = []) {
  return users.filter(isOwnerRole).length;
}

export function canPromoteOwners(selectedTeam, options = {}) {
  return (
    selectedTeam?.canDelete === true &&
    Number.isFinite(selectedTeam?.installationId) &&
    options.offline !== true
  );
}

export function canCurrentOwnerLeaveTeam(selectedTeam, users = [], options = {}) {
  return (
    selectedTeam?.canDelete === true &&
    selectedTeam?.canLeave === true &&
    Number.isFinite(selectedTeam?.installationId) &&
    options.offline !== true &&
    countOwners(users) >= 2
  );
}

export function canCurrentUserLeaveTeam(selectedTeam, users = [], options = {}) {
  if (selectedTeam?.canDelete === true) {
    return canCurrentOwnerLeaveTeam(selectedTeam, users, options);
  }

  return selectedTeam?.canLeave === true && options.offline !== true;
}
