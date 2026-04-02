const REQUIRED_INSTALLATION_PERMISSIONS = {
  members: "write",
  administration: "write",
  custom_properties: "write",
  contents: "write",
  metadata: "read",
};

const PERMISSION_LEVELS = {
  read: 1,
  write: 2,
  admin: 3,
};

function normalizePermissionLevel(level) {
  return typeof level === "string" && level.trim() ? level.trim().toLowerCase() : "";
}

export function normalizeInstallationPermissions(permissions) {
  if (!permissions || typeof permissions !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(permissions)
      .map(([permission, level]) => [
        typeof permission === "string" ? permission.trim() : "",
        normalizePermissionLevel(level),
      ])
      .filter(([permission, level]) => permission && level),
  );
}

export function listMissingInstallationPermissions(permissions) {
  const grantedPermissions = normalizeInstallationPermissions(permissions);

  return Object.entries(REQUIRED_INSTALLATION_PERMISSIONS)
    .filter(([permission, requiredLevel]) => {
      const grantedLevel = grantedPermissions[permission];
      return (PERMISSION_LEVELS[grantedLevel] ?? 0) < (PERMISSION_LEVELS[requiredLevel] ?? 0);
    })
    .map(([permission, requiredLevel]) => `${permission}:${requiredLevel}`);
}

export function deriveInstallationApprovalState(permissions) {
  const missingAppPermissions = listMissingInstallationPermissions(permissions);
  return {
    grantedAppPermissions: normalizeInstallationPermissions(permissions),
    missingAppPermissions,
    needsAppApproval: missingAppPermissions.length > 0,
  };
}
