import { deriveInstallationApprovalState, normalizeInstallationPermissions } from "../github-app-permissions.js";

function buildTeamRecordCore(baseRecord, installation, storedTeam = null) {
  const grantedAppPermissions = normalizeInstallationPermissions(
    installation.permissions ?? storedTeam?.grantedAppPermissions,
  );
  const approvalState = deriveInstallationApprovalState(grantedAppPermissions);

  return {
    ...baseRecord,
    canDelete: installation.canDelete === true,
    canManageMembers: installation.canManageMembers === true,
    canManageProjects: installation.canManageProjects === true,
    canLeave: installation.canLeave !== false,
    needsAppApproval: approvalState.needsAppApproval,
    appApprovalUrl: installation.appApprovalUrl ?? storedTeam?.appApprovalUrl ?? null,
    appRequestUrl: installation.appRequestUrl ?? storedTeam?.appRequestUrl ?? null,
    grantedAppPermissions: approvalState.grantedAppPermissions,
    missingAppPermissions: approvalState.missingAppPermissions,
  };
}

export function buildTeamRecordFromInstallationData(installation, defaults = {}) {
  return buildTeamRecordCore(defaults, installation);
}

export function reconcileTeamRecordWithInstallation(storedTeam, installation, overrides = {}) {
  return buildTeamRecordCore(
    {
      ...storedTeam,
      ...overrides,
    },
    installation,
    storedTeam,
  );
}
