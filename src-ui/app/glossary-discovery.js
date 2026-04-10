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

function findMatchingRemoteGlossary(record, remoteByRepoName, remoteByFullName) {
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

export function mergeMetadataBackedGlossarySummaries(
  localSummaries,
  metadataRecords,
  remoteRepos,
  options = {},
) {
  const metadataLoaded = options.metadataLoaded === true;
  const remoteLoaded = options.remoteLoaded === true;
  const glossaryIdsInFlight = options.glossaryIdsInFlight instanceof Set
    ? options.glossaryIdsInFlight
    : new Set();
  const normalizedLocals = (Array.isArray(localSummaries) ? localSummaries : [])
    .map(normalizeGlossarySummary)
    .filter(Boolean);
  const localById = new Map(normalizedLocals.map((glossary) => [glossary.id, glossary]));
  const localByRepoName = new Map(normalizedLocals.map((glossary) => [glossary.repoName, glossary]));
  const remoteByRepoName = new Map(
    (Array.isArray(remoteRepos) ? remoteRepos : [])
      .map(normalizeRemoteGlossaryRepo)
      .filter(Boolean)
      .map((repo) => [repo.name, repo]),
  );
  const remoteByFullName = new Map(
    (Array.isArray(remoteRepos) ? remoteRepos : [])
      .map(normalizeRemoteGlossaryRepo)
      .filter(Boolean)
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
      findMatchingRemoteGlossary(record, remoteByRepoName, remoteByFullName)
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
      remoteState === "pendingCreate"
        ? "pendingCreate"
        : remoteState === "missing"
          ? "missing"
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
    const suppressUnregisteredLocal = glossaryIdsInFlight.has(glossary.id);
    merged.push(normalizeGlossarySummary({
      ...glossary,
      resolutionState:
        metadataLoaded
        && !suppressUnregisteredLocal
        && glossary.recordState !== "tombstone"
        && glossary.remoteState !== "pendingCreate"
          ? "unregisteredLocal"
          : glossary.resolutionState ?? "",
    }));
  }

  return sortGlossaries(merged);
}
