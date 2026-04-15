import { normalizeGlossarySummary, sortGlossaries } from "./glossary-shared.js";

function normalizeRemoteGlossaryRepo(repo) {
  if (!repo || typeof repo !== "object") {
    return null;
  }

  const name =
    typeof repo.name === "string" && repo.name.trim()
      ? repo.name.trim()
      : null;
  const fullName =
    typeof repo.fullName === "string" && repo.fullName.trim()
      ? repo.fullName.trim()
      : null;
  if (!name || !fullName) {
    return null;
  }

  return {
    repoId: Number.isFinite(repo.repoId) ? repo.repoId : null,
    nodeId:
      typeof repo.nodeId === "string" && repo.nodeId.trim()
        ? repo.nodeId.trim()
        : null,
    name,
    fullName,
    htmlUrl:
      typeof repo.htmlUrl === "string" && repo.htmlUrl.trim()
        ? repo.htmlUrl.trim()
        : "",
    private: repo.private !== false,
    description:
      typeof repo.description === "string" && repo.description.trim()
        ? repo.description.trim()
        : "",
    defaultBranchName:
      typeof repo.defaultBranchName === "string" && repo.defaultBranchName.trim()
        ? repo.defaultBranchName.trim()
        : "main",
    defaultBranchHeadOid:
      typeof repo.defaultBranchHeadOid === "string" && repo.defaultBranchHeadOid.trim()
        ? repo.defaultBranchHeadOid.trim()
        : null,
  };
}

function createRepairIssueMaps(repairIssues = []) {
  const byResourceId = new Map();
  const byRepoName = new Map();

  for (const issue of Array.isArray(repairIssues) ? repairIssues : []) {
    if (issue?.kind !== "glossary") {
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

function matchingRepairIssue(glossary, repairIssueMaps) {
  if (!glossary || !repairIssueMaps) {
    return null;
  }
  if (repairIssueMaps.byResourceId.has(glossary.id)) {
    return repairIssueMaps.byResourceId.get(glossary.id);
  }
  if (repairIssueMaps.byRepoName.has(glossary.repoName)) {
    return repairIssueMaps.byRepoName.get(glossary.repoName);
  }
  return null;
}

function supportsUnmatchedLocalGlossary(glossary, repairIssueMaps) {
  const repairIssue = matchingRepairIssue(glossary, repairIssueMaps);
  return repairIssue?.issueType === "strayLocalRepo";
}

function metadataBackedGlossaryRepo(record) {
  if (
    !record
    || record.recordState !== "live"
    || record.remoteState !== "linked"
    || typeof record.repoName !== "string"
    || !record.repoName.trim()
    || typeof record.fullName !== "string"
    || !record.fullName.trim()
  ) {
    return null;
  }

  return normalizeRemoteGlossaryRepo({
    repoId: record.githubRepoId,
    nodeId: record.githubNodeId,
    name: record.repoName,
    fullName: record.fullName,
    defaultBranchName: record.defaultBranch || "main",
  });
}

function remoteGlossaryToVisibleSummary(remoteGlossary) {
  const normalizedRemote = normalizeRemoteGlossaryRepo(remoteGlossary);
  if (!normalizedRemote) {
    return null;
  }

  return normalizeGlossarySummary({
    glossaryId: normalizedRemote.nodeId || normalizedRemote.fullName || normalizedRemote.name,
    repoName: normalizedRemote.name,
    title: normalizedRemote.name,
    lifecycleState: "active",
    remoteState: "linked",
    recordState: "live",
    fullName: normalizedRemote.fullName,
    htmlUrl: normalizedRemote.htmlUrl,
    defaultBranchName: normalizedRemote.defaultBranchName,
    defaultBranchHeadOid: normalizedRemote.defaultBranchHeadOid,
    repoId: normalizedRemote.repoId,
    nodeId: normalizedRemote.nodeId,
  });
}

function findMatchingLocalGlossary(record, localById, localByRepoName) {
  const byId = localById.get(record.id);
  if (byId) {
    return byId;
  }

  const repoNames = [record.repoName, ...(Array.isArray(record.previousRepoNames) ? record.previousRepoNames : [])];
  for (const repoName of repoNames) {
    const match = localByRepoName.get(repoName);
    if (match) {
      return match;
    }
  }

  return null;
}

export function findMatchingRemoteGlossary(record, remoteByRepoName, remoteByFullName, remoteByRepoId, remoteByNodeId) {
  if (Number.isFinite(record.githubRepoId) && remoteByRepoId.has(record.githubRepoId)) {
    return remoteByRepoId.get(record.githubRepoId);
  }

  if (record.githubNodeId && remoteByNodeId.has(record.githubNodeId)) {
    return remoteByNodeId.get(record.githubNodeId);
  }

  if (record.fullName && remoteByFullName.has(record.fullName)) {
    return remoteByFullName.get(record.fullName);
  }

  const repoNames = [record.repoName, ...(Array.isArray(record.previousRepoNames) ? record.previousRepoNames : [])];
  for (const repoName of repoNames) {
    const match = remoteByRepoName.get(repoName);
    if (match) {
      return match;
    }
  }

  return null;
}

export function findConfirmedMissingGlossaryRecords(metadataRecords = [], remoteRepos = []) {
  const normalizedRemotes = (Array.isArray(remoteRepos) ? remoteRepos : [])
    .map(normalizeRemoteGlossaryRepo)
    .filter(Boolean);
  const remoteByRepoId = new Map(
    normalizedRemotes
      .filter((repo) => Number.isFinite(repo.repoId))
      .map((repo) => [repo.repoId, repo]),
  );
  const remoteByNodeId = new Map(
    normalizedRemotes
      .filter((repo) => typeof repo.nodeId === "string" && repo.nodeId.trim())
      .map((repo) => [repo.nodeId, repo]),
  );
  const remoteByRepoName = new Map(normalizedRemotes.map((repo) => [repo.name, repo]));
  const remoteByFullName = new Map(normalizedRemotes.map((repo) => [repo.fullName, repo]));

  return (Array.isArray(metadataRecords) ? metadataRecords : []).filter((record) =>
    record?.recordState === "live"
    && (record?.remoteState ?? "linked") === "linked"
    && !findMatchingRemoteGlossary(
      record,
      remoteByRepoName,
      remoteByFullName,
      remoteByRepoId,
      remoteByNodeId,
    )
  );
}

export function mergeMetadataBackedGlossarySummaries(
  localSummaries,
  metadataRecords,
  remoteRepos,
  options = {},
) {
  const metadataLoaded = options.metadataLoaded === true;
  const remoteLoaded = options.remoteLoaded === true;
  const repairLoaded = options.repairLoaded === true;
  const repairIssueMaps = createRepairIssueMaps(options.repairIssues);
  const normalizedLocals = (Array.isArray(localSummaries) ? localSummaries : [])
    .map(normalizeGlossarySummary)
    .filter(Boolean);
  const localById = new Map(normalizedLocals.map((glossary) => [glossary.id, glossary]));
  const localByRepoName = new Map(normalizedLocals.map((glossary) => [glossary.repoName, glossary]));
  const normalizedRemotes = (Array.isArray(remoteRepos) ? remoteRepos : [])
    .map(normalizeRemoteGlossaryRepo)
    .filter(Boolean);
  const remoteByRepoId = new Map(
    normalizedRemotes
      .filter((repo) => Number.isFinite(repo.repoId))
      .map((repo) => [repo.repoId, repo]),
  );
  const remoteByNodeId = new Map(
    normalizedRemotes
      .filter((repo) => typeof repo.nodeId === "string" && repo.nodeId.trim())
      .map((repo) => [repo.nodeId, repo]),
  );
  const remoteByRepoName = new Map(
    normalizedRemotes
      .map((repo) => [repo.name, repo]),
  );
  const remoteByFullName = new Map(
    normalizedRemotes
      .map((repo) => [repo.fullName, repo]),
  );
  const matchedLocalIds = new Set();
  const matchedLocalRepoNames = new Set();
  const merged = [];

  for (const record of Array.isArray(metadataRecords) ? metadataRecords : []) {
    if (record?.recordState !== "live" && record?.recordState !== "tombstone") {
      continue;
    }
    if (record?.recordState === "tombstone") {
      if (typeof record?.id === "string" && record.id.trim()) {
        matchedLocalIds.add(record.id);
      }
      if (typeof record?.repoName === "string" && record.repoName.trim()) {
        matchedLocalRepoNames.add(record.repoName);
      }
      continue;
    }

    const localGlossary = findMatchingLocalGlossary(record, localById, localByRepoName);
    const remoteGlossary =
      findMatchingRemoteGlossary(record, remoteByRepoName, remoteByFullName, remoteByRepoId, remoteByNodeId)
      ?? metadataBackedGlossaryRepo(record);

    if (localGlossary) {
      matchedLocalIds.add(localGlossary.id);
      matchedLocalRepoNames.add(localGlossary.repoName);
    }

    const remoteState =
      remoteLoaded
      && (record.remoteState ?? "linked") === "linked"
      && !remoteGlossary
        ? "missing"
        : (record.remoteState ?? "linked");
    const resolutionState =
      remoteState === "missing"
          ? "missing"
          : matchingRepairIssue({ id: record.id, repoName: record.repoName }, repairIssueMaps)
            ? "repair"
            : "";

    const mergedGlossary = normalizeGlossarySummary({
      glossaryId: record.id,
      repoName: record.repoName,
      title: record.title,
      sourceLanguage: localGlossary?.sourceLanguage ?? record.sourceLanguage ?? null,
      targetLanguage: localGlossary?.targetLanguage ?? record.targetLanguage ?? null,
      lifecycleState: record.lifecycleState,
      remoteState,
      recordState: record.recordState ?? "live",
      resolutionState,
      repairIssueType: matchingRepairIssue({ id: record.id, repoName: record.repoName }, repairIssueMaps)?.issueType ?? "",
      repairIssueMessage: matchingRepairIssue({ id: record.id, repoName: record.repoName }, repairIssueMaps)?.message ?? "",
      deletedAt: record.deletedAt ?? null,
      termCount: localGlossary?.termCount ?? record.termCount ?? 0,
      repoId: remoteGlossary?.repoId ?? record.githubRepoId ?? localGlossary?.repoId ?? null,
      nodeId: remoteGlossary?.nodeId ?? record.githubNodeId ?? localGlossary?.nodeId ?? null,
      fullName: remoteGlossary?.fullName ?? record.fullName ?? localGlossary?.fullName ?? "",
      htmlUrl: remoteGlossary?.htmlUrl ?? localGlossary?.htmlUrl ?? "",
      defaultBranchName:
        remoteGlossary?.defaultBranchName
        ?? record.defaultBranch
        ?? localGlossary?.defaultBranchName
        ?? "main",
      defaultBranchHeadOid:
        remoteGlossary?.defaultBranchHeadOid
        ?? localGlossary?.defaultBranchHeadOid
        ?? null,
    });

    if (mergedGlossary) {
      merged.push(mergedGlossary);
    }
  }

  for (const glossary of normalizedLocals) {
    if (matchedLocalIds.has(glossary.id) || matchedLocalRepoNames.has(glossary.repoName)) {
      continue;
    }
    if (glossary?.recordState === "tombstone") {
      continue;
    }
    const repairIssue = matchingRepairIssue(glossary, repairIssueMaps);
    if (metadataLoaded && repairLoaded && !supportsUnmatchedLocalGlossary(glossary, repairIssueMaps)) {
      continue;
    }
    merged.push(normalizeGlossarySummary({
      ...glossary,
      resolutionState:
        repairIssue
          ? "repair"
          : metadataLoaded
            && glossary.recordState !== "tombstone"
              ? "unregisteredLocal"
              : glossary.resolutionState ?? "",
      repairIssueType: repairIssue?.issueType ?? "",
      repairIssueMessage: repairIssue?.message ?? "",
    }));
  }

  if (!metadataLoaded) {
    for (const remoteGlossary of normalizedRemotes) {
      const visibleGlossary = remoteGlossaryToVisibleSummary(remoteGlossary);
      if (!visibleGlossary) {
        continue;
      }
      if (
        matchedLocalIds.has(visibleGlossary.id)
        || matchedLocalRepoNames.has(visibleGlossary.repoName)
        || merged.some((glossary) =>
          glossary.id === visibleGlossary.id || glossary.repoName === visibleGlossary.repoName)
      ) {
        continue;
      }
      merged.push(visibleGlossary);
    }
  }

  return sortGlossaries(merged);
}
