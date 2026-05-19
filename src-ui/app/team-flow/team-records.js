import { deriveInstallationApprovalState, normalizeInstallationPermissions } from "../github-app-permissions.js";
import { isReadOnlyViewerTeam } from "../resource-capabilities.js";

function buildTeamRecordCore(baseRecord, installation, storedTeam = null) {
  const grantedAppPermissions = normalizeInstallationPermissions(
    installation.permissions ?? storedTeam?.grantedAppPermissions,
  );
  const approvalState = deriveInstallationApprovalState(grantedAppPermissions);
  const membershipRole = installation.membershipRole ?? baseRecord.membershipRole ?? storedTeam?.membershipRole ?? "member";
  const roleRecord = { membershipRole };
  const readOnlyViewer = isReadOnlyViewerTeam(roleRecord);

  return {
    ...baseRecord,
    membershipRole,
    canDelete: !readOnlyViewer && installation.canDelete === true,
    canManageMembers: !readOnlyViewer && installation.canManageMembers === true,
    canManageProjects: !readOnlyViewer && installation.canManageProjects === true,
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
