function createProjectRecordMaps(projects = []) {
  const byId = new Map();
  const byRepoId = new Map();
  const byNodeId = new Map();
  const byRepoName = new Map();
  const byFullName = new Map();

  for (const project of Array.isArray(projects) ? projects : []) {
    if (typeof project?.id === "string" && project.id.trim()) {
      byId.set(project.id, project);
    }
    if (Number.isFinite(project?.repoId)) {
      byRepoId.set(project.repoId, project);
    }
    if (typeof project?.nodeId === "string" && project.nodeId.trim()) {
      byNodeId.set(project.nodeId, project);
    }
    if (typeof project?.name === "string" && project.name.trim()) {
      byRepoName.set(project.name, project);
    }
    if (typeof project?.fullName === "string" && project.fullName.trim()) {
      byFullName.set(project.fullName, project);
    }
  }

  return { byId, byRepoId, byNodeId, byRepoName, byFullName };
}

function createRepairIssueMaps(repairIssues = []) {
  const byResourceId = new Map();
  const byRepoName = new Map();

  for (const issue of Array.isArray(repairIssues) ? repairIssues : []) {
    if (issue?.kind !== "project") {
      continue;
    }
    if (typeof issue.resourceId === "string" && issue.resourceId.trim()) {
      byResourceId.set(issue.resourceId, issue);
    }
    if (typeof issue.repoName === "string" && issue.repoName.trim()) {
      byRepoName.set(issue.repoName, issue);
    }
    if (typeof issue.expectedRepoName === "string" && issue.expectedRepoName.trim()) {
      byRepoName.set(issue.expectedRepoName, issue);
    }
  }

  return { byResourceId, byRepoName };
}

function matchingRepairIssue(resource, repairIssueMaps) {
  if (!resource || !repairIssueMaps) {
    return null;
  }

  if (repairIssueMaps.byResourceId.has(resource.id)) {
    return repairIssueMaps.byResourceId.get(resource.id);
  }
  if (repairIssueMaps.byRepoName.has(resource.name)) {
    return repairIssueMaps.byRepoName.get(resource.name);
  }
  return null;
}

function findMatchingProjectRecord(record, projectMaps) {
  const byId = projectMaps.byId.get(record.id);
  if (byId) {
    return byId;
  }

  if (Number.isFinite(record.githubRepoId) && projectMaps.byRepoId.has(record.githubRepoId)) {
    return projectMaps.byRepoId.get(record.githubRepoId);
  }

  if (typeof record.githubNodeId === "string" && record.githubNodeId.trim() && projectMaps.byNodeId.has(record.githubNodeId)) {
    return projectMaps.byNodeId.get(record.githubNodeId);
  }

  if (projectMaps.byFullName.has(record.fullName)) {
    return projectMaps.byFullName.get(record.fullName);
  }

  const repoNames = [record.repoName, ...(Array.isArray(record.previousRepoNames) ? record.previousRepoNames : [])];
  for (const repoName of repoNames) {
    const match = projectMaps.byRepoName.get(repoName);
    if (match) {
      return match;
    }
  }

  return null;
}

function mapMetadataProjectToVisibleProject(record, remoteProject, existingProject, options = {}) {
  const remoteLoaded = options.remoteLoaded === true;
  const repairIssue = matchingRepairIssue(
    {
      id: record.id,
      name: record.repoName,
    },
    options.repairIssueMaps,
  );
  const remoteState =
    record.recordState === "tombstone"
      ? (record.remoteState ?? "deleted")
      : (
          remoteLoaded
          && (record.remoteState ?? "linked") === "linked"
          && !remoteProject
        )
        ? "missing"
        : (record.remoteState ?? "linked");
  const resolutionState =
    record.recordState === "tombstone"
      ? "deleted"
      : remoteState === "missing"
          ? "missing"
          : repairIssue
            ? "repair"
            : "";
  const fullName =
    remoteProject?.fullName
    ?? record.fullName
    ?? existingProject?.fullName
    ?? "";

  return {
    id: record.id,
    repoId: remoteProject?.repoId ?? record.githubRepoId ?? existingProject?.repoId ?? null,
    nodeId: remoteProject?.nodeId ?? record.githubNodeId ?? existingProject?.nodeId ?? null,
    name: record.repoName,
    title: record.title,
    status: record.lifecycleState === "deleted" ? "deleted" : "active",
    fullName,
    htmlUrl:
      remoteProject?.htmlUrl
      ?? existingProject?.htmlUrl
      ?? (fullName ? `https://github.com/${fullName}` : null),
    private: remoteProject?.private ?? existingProject?.private ?? true,
    description: remoteProject?.description ?? existingProject?.description ?? null,
    defaultBranchName:
      remoteProject?.defaultBranchName
      ?? record.defaultBranch
      ?? existingProject?.defaultBranchName
      ?? null,
    defaultBranchHeadOid:
      remoteProject?.defaultBranchHeadOid
      ?? existingProject?.defaultBranchHeadOid
      ?? null,
    chapters:
      record.recordState === "tombstone"
        ? []
        : Array.isArray(existingProject?.chapters)
          ? existingProject.chapters
          : [],
    remoteState,
    recordState: record.recordState ?? "live",
    deletedAt: record.deletedAt ?? null,
    resolutionState,
    repairIssueType: repairIssue?.issueType ?? "",
    repairIssueMessage: repairIssue?.message ?? "",
    };
}

export function mergeMetadataDiscoveryProjects({
  metadataRecords,
  remoteProjects,
  localProjects,
  metadataLoaded = false,
  remoteLoaded = false,
  repairIssues = [],
}) {
  const remoteMaps = createProjectRecordMaps(remoteProjects);
  const localMaps = createProjectRecordMaps(localProjects);
  const repairIssueMaps = createRepairIssueMaps(repairIssues);
  const mergedProjects = [];
  const includedProjectIds = new Set();
  const includedRepoNames = new Set();

  for (const record of Array.isArray(metadataRecords) ? metadataRecords : []) {
    if (record?.recordState !== "live" && record?.recordState !== "tombstone") {
      continue;
    }
    if (record?.recordState === "tombstone") {
      if (typeof record?.id === "string" && record.id.trim()) {
        includedProjectIds.add(record.id);
      }
      if (typeof record?.repoName === "string" && record.repoName.trim()) {
        includedRepoNames.add(record.repoName);
      }
      continue;
    }

    const remoteProject = findMatchingProjectRecord(record, remoteMaps);
    const localProject = findMatchingProjectRecord(record, localMaps);
    const mergedProject = mapMetadataProjectToVisibleProject(record, remoteProject, localProject, {
      remoteLoaded,
      repairIssueMaps,
    });
    mergedProjects.push(mergedProject);
    includedProjectIds.add(mergedProject.id);
    includedRepoNames.add(mergedProject.name);
  }

  if (!metadataLoaded) {
    for (const remoteProject of Array.isArray(remoteProjects) ? remoteProjects : []) {
      if (includedProjectIds.has(remoteProject.id) || includedRepoNames.has(remoteProject.name)) {
        continue;
      }
      const localProject =
        localMaps.byId.get(remoteProject.id)
        ?? localMaps.byRepoName.get(remoteProject.name)
        ?? null;
      mergedProjects.push({
        ...remoteProject,
        chapters: Array.isArray(localProject?.chapters) ? localProject.chapters : [],
        remoteState: "linked",
        recordState: "live",
        resolutionState: "",
      });
      includedProjectIds.add(remoteProject.id);
      includedRepoNames.add(remoteProject.name);
    }
  }

  for (const localProject of Array.isArray(localProjects) ? localProjects : []) {
    if (includedProjectIds.has(localProject.id) || includedRepoNames.has(localProject.name)) {
      continue;
    }
    if (localProject?.recordState === "tombstone") {
      continue;
    }
    mergedProjects.push({
      ...localProject,
      resolutionState:
        matchingRepairIssue(localProject, repairIssueMaps)
          ? "repair"
          : metadataLoaded
            && localProject.recordState !== "tombstone"
              ? "unregisteredLocal"
              : localProject.resolutionState ?? "",
      repairIssueType: matchingRepairIssue(localProject, repairIssueMaps)?.issueType ?? "",
      repairIssueMessage: matchingRepairIssue(localProject, repairIssueMaps)?.message ?? "",
    });
  }

  return mergedProjects;
}
