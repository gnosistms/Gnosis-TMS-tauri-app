import { deriveInstallationApprovalState, normalizeInstallationPermissions } from "../github-app-permissions.js";
import { deriveTeamCapabilities } from "../permissions.js";

function buildTeamRecordCore(baseRecord, installation, storedTeam = null) {
  const grantedAppPermissions = normalizeInstallationPermissions(
    installation.permissions ?? storedTeam?.grantedAppPermissions,
  );
  const approvalState = deriveInstallationApprovalState(grantedAppPermissions);
  const rawMembershipRole = installation.membershipRole ?? baseRecord.membershipRole ?? storedTeam?.membershipRole ?? "";
  const membershipRole = rawMembershipRole || "member";
  const capabilities = deriveTeamCapabilities({
    ...baseRecord,
    ...installation,
    membershipRole: rawMembershipRole,
  });

  return {
    ...baseRecord,
    ...capabilities,
    membershipRole,
    canDelete: capabilities.canManageTeam,
    canManageMembers: capabilities.canManageMembers,
    canManageProjects: capabilities.canManageProjects,
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
