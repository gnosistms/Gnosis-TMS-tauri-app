const REQUIRED_INSTALLATION_PERMISSIONS = [
  { label: "members", keys: ["members"], level: "write" },
  { label: "administration", keys: ["administration"], level: "write" },
  {
    label: "custom_properties",
    keys: ["custom_properties", "repository_custom_properties"],
    level: "write",
  },
  { label: "contents", keys: ["contents"], level: "write" },
  { label: "metadata", keys: ["metadata"], level: "read" },
];

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

  return REQUIRED_INSTALLATION_PERMISSIONS
    .filter(({ keys, level }) => {
      const grantedLevel = keys.reduce((bestLevel, key) => {
        const nextLevel = grantedPermissions[key];
        return (PERMISSION_LEVELS[nextLevel] ?? 0) > (PERMISSION_LEVELS[bestLevel] ?? 0)
          ? nextLevel
          : bestLevel;
      }, "");
      return (PERMISSION_LEVELS[grantedLevel] ?? 0) < (PERMISSION_LEVELS[level] ?? 0);
    })
    .map(({ label, level }) => `${label}:${level}`);
}

export function deriveInstallationApprovalState(permissions) {
  const missingAppPermissions = listMissingInstallationPermissions(permissions);
  return {
    grantedAppPermissions: normalizeInstallationPermissions(permissions),
    missingAppPermissions,
    needsAppApproval: missingAppPermissions.length > 0,
  };
}
