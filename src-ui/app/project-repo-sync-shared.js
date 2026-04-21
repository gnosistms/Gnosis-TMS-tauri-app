export const PROJECT_REPO_SYNC_STATUS_UNRESOLVED_CONFLICT = "unresolvedConflict";

export function mapProjectToProjectRepoSyncDescriptor(project) {
  if (
    !project
    || typeof project?.id !== "string"
    || !project.id.trim()
    || typeof project?.name !== "string"
    || !project.name.trim()
    || typeof project?.fullName !== "string"
    || !project.fullName.trim()
    || project?.remoteState === "missing"
    || project?.remoteState === "deleted"
    || project?.recordState === "tombstone"
  ) {
    return null;
  }

  return {
    projectId: project.id,
    repoName: project.name,
    fullName: project.fullName,
    repoId: Number.isFinite(project.repoId) ? project.repoId : null,
    defaultBranchName: project.defaultBranchName ?? null,
    defaultBranchHeadOid: project.defaultBranchHeadOid ?? null,
  };
}

export function buildProjectRepoSyncInput(team, projects) {
  return {
    installationId: team?.installationId,
    projects: (Array.isArray(projects) ? projects : [])
      .map((project) => mapProjectToProjectRepoSyncDescriptor(project))
      .filter(Boolean),
  };
}

export function projectRepoSyncNeedsFallbackConflictRecovery(snapshot) {
  return snapshot?.status === PROJECT_REPO_SYNC_STATUS_UNRESOLVED_CONFLICT;
}

export function listProjectRepoFallbackConflictEntries(
  projects = [],
  deletedProjects = [],
  snapshotsByProjectId = {},
) {
  const projectById = new Map(
    [...(Array.isArray(projects) ? projects : []), ...(Array.isArray(deletedProjects) ? deletedProjects : [])]
      .filter((project) => typeof project?.id === "string" && project.id.trim())
      .map((project) => [project.id, project]),
  );

  return Object.entries(snapshotsByProjectId ?? {})
    .map(([projectId, snapshot]) => {
      if (!projectRepoSyncNeedsFallbackConflictRecovery(snapshot)) {
        return null;
      }

      const project = projectById.get(projectId) ?? null;
      return {
        projectId,
        project,
        snapshot,
        title:
          typeof project?.title === "string" && project.title.trim()
            ? project.title.trim()
            : typeof project?.name === "string" && project.name.trim()
              ? project.name.trim()
              : typeof snapshot?.repoName === "string" && snapshot.repoName.trim()
                ? snapshot.repoName.trim()
                : "Project repo",
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.title.localeCompare(right.title, undefined, {
      sensitivity: "base",
      numeric: true,
    }));
}

export function buildProjectRepoFallbackConflictRecoveryInput(
  team,
  projects = [],
  deletedProjects = [],
  snapshotsByProjectId = {},
) {
  const conflictProjects = listProjectRepoFallbackConflictEntries(
    projects,
    deletedProjects,
    snapshotsByProjectId,
  ).map((entry) => entry.project).filter(Boolean);
  return buildProjectRepoSyncInput(team, conflictProjects);
}
