import { requireBrokerSession } from "./auth-flow.js";
import { invoke } from "./runtime.js";
import { normalizeGlossarySummary, sortGlossaries } from "./glossary-shared.js";
import { createUniqueRepoWithNumericSuffix } from "./repo-creation.js";
import { listGlossaryMetadataRecords } from "./team-metadata-flow.js";

const GLOSSARY_BROKER_ROUTE_UNAVAILABLE_MESSAGE =
  "The GitHub App broker does not have glossary repo routes deployed yet. Remote glossary sync and repo actions are unavailable right now.";

function glossaryBrokerRouteUnavailable(error) {
  const message = String(error?.message ?? error ?? "");
  return (
    message.includes("/gnosis-glossaries")
    && (
      message.includes("Cannot GET ")
      || message.includes("Cannot POST ")
      || message.includes("Cannot DELETE ")
    )
  );
}

function normalizeGlossaryBrokerError(error) {
  if (glossaryBrokerRouteUnavailable(error)) {
    return new Error(GLOSSARY_BROKER_ROUTE_UNAVAILABLE_MESSAGE);
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error ?? "Unknown glossary broker error."));
}

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

function glossaryRepoSyncDescriptor(repo) {
  return {
    repoName: repo.name,
    fullName: repo.fullName,
    repoId: Number.isFinite(repo.repoId) ? repo.repoId : null,
    defaultBranchName: repo.defaultBranchName || "main",
    defaultBranchHeadOid: repo.defaultBranchHeadOid || null,
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

function mergeMetadataBackedGlossarySummaries(localSummaries, metadataRecords, remoteRepos) {
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
    if (record?.recordState !== "live") {
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

    const mergedGlossary = normalizeGlossarySummary({
      glossaryId: record.id,
      repoName: record.repoName,
      title: record.title,
      sourceLanguage: localGlossary?.sourceLanguage ?? record.sourceLanguage ?? null,
      targetLanguage: localGlossary?.targetLanguage ?? record.targetLanguage ?? null,
      lifecycleState: record.lifecycleState,
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
    merged.push(glossary);
  }

  return sortGlossaries(merged);
}

function buildMetadataBackedGlossarySyncRepos(metadataRecords, remoteRepos) {
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
  const syncRepos = [];
  const seenRepoNames = new Set();

  for (const record of Array.isArray(metadataRecords) ? metadataRecords : []) {
    if (record?.recordState !== "live" || record?.remoteState !== "linked") {
      continue;
    }

    const repo =
      findMatchingRemoteGlossary(record, remoteByRepoName, remoteByFullName)
      ?? metadataBackedGlossaryRepo(record);
    if (!repo || seenRepoNames.has(repo.name)) {
      continue;
    }

    seenRepoNames.add(repo.name);
    syncRepos.push(repo);
  }

  return syncRepos;
}

export function glossaryArchiveDownloadUrl(glossary) {
  const htmlUrl =
    typeof glossary?.htmlUrl === "string" && glossary.htmlUrl.trim()
      ? glossary.htmlUrl.trim()
      : "";
  if (!htmlUrl) {
    return "";
  }

  const branchName =
    typeof glossary?.defaultBranchName === "string" && glossary.defaultBranchName.trim()
      ? glossary.defaultBranchName.trim()
      : "main";
  return `${htmlUrl}/archive/refs/heads/${encodeURIComponent(branchName)}.zip`;
}

export function getGlossarySyncIssueMessage(syncSnapshots) {
  const snapshots = Array.isArray(syncSnapshots) ? syncSnapshots : [];
  const failedSnapshot = snapshots.find((snapshot) =>
    snapshot?.status === "syncError" || snapshot?.status === "dirtyLocal",
  );
  if (!failedSnapshot) {
    return "";
  }

  return typeof failedSnapshot.message === "string" && failedSnapshot.message.trim()
    ? failedSnapshot.message.trim()
    : `Could not sync glossary repo ${failedSnapshot.repoName ?? ""}.`.trim();
}

export async function listRemoteGlossaryReposForTeam(team) {
  if (!Number.isFinite(team?.installationId)) {
    return [];
  }

  let repos;
  try {
    repos = await invoke("list_gnosis_glossaries_for_installation", {
      installationId: team.installationId,
      sessionToken: requireBrokerSession(),
    });
  } catch (error) {
    throw normalizeGlossaryBrokerError(error);
  }

  return (Array.isArray(repos) ? repos : [])
    .map(normalizeRemoteGlossaryRepo)
    .filter(Boolean);
}

export async function syncGlossaryReposForTeam(team, remoteRepos) {
  const glossaries = (Array.isArray(remoteRepos) ? remoteRepos : [])
    .map(normalizeRemoteGlossaryRepo)
    .filter(Boolean);
  if (!Number.isFinite(team?.installationId) || glossaries.length === 0) {
    return [];
  }

  const snapshots = await invoke("sync_gtms_glossary_repos", {
    input: {
      installationId: team.installationId,
      glossaries: glossaries.map(glossaryRepoSyncDescriptor),
    },
    sessionToken: requireBrokerSession(),
  });

  return Array.isArray(snapshots) ? snapshots : [];
}

export async function listLocalGlossarySummariesForTeam(team) {
  if (!Number.isFinite(team?.installationId)) {
    return [];
  }

  const glossaries = await invoke("list_local_gtms_glossaries", {
    input: { installationId: team.installationId },
  });

  return Array.isArray(glossaries) ? glossaries : [];
}

export function mergeRepoBackedGlossarySummaries(localSummaries, remoteRepos) {
  const remoteByRepoName = new Map(
    (Array.isArray(remoteRepos) ? remoteRepos : [])
      .map(normalizeRemoteGlossaryRepo)
      .filter(Boolean)
      .map((repo) => [repo.name, repo]),
  );

  return sortGlossaries(
    (Array.isArray(localSummaries) ? localSummaries : [])
      .map((summary) => {
        const normalized = normalizeGlossarySummary(summary);
        if (!normalized) {
          return null;
        }

        const remoteRepo = remoteByRepoName.get(normalized.repoName);
        if (!remoteRepo) {
          return normalized;
        }

        return {
          ...normalized,
          fullName: remoteRepo.fullName,
          htmlUrl: remoteRepo.htmlUrl,
          defaultBranchName: remoteRepo.defaultBranchName,
          defaultBranchHeadOid: remoteRepo.defaultBranchHeadOid,
        };
      })
      .filter(Boolean),
  );
}

function getMissingRemoteGlossaryMessage(localSummaries, remoteRepos) {
  const localRepoNames = new Set(
    (Array.isArray(localSummaries) ? localSummaries : [])
      .map((summary) => normalizeGlossarySummary(summary))
      .filter(Boolean)
      .map((summary) => summary.repoName),
  );
  if (localRepoNames.size === 0) {
    return "";
  }

  const remoteRepoNames = new Set(
    (Array.isArray(remoteRepos) ? remoteRepos : [])
      .map(normalizeRemoteGlossaryRepo)
      .filter(Boolean)
      .map((repo) => repo.name),
  );
  const missingCount = [...localRepoNames].filter((repoName) => !remoteRepoNames.has(repoName)).length;
  if (missingCount === 0) {
    return "";
  }

  return `Showing ${missingCount} local ${
    missingCount === 1 ? "glossary" : "glossaries"
  } that remote discovery did not recognize yet.`;
}

export async function loadRepoBackedGlossariesForTeam(team, options = {}) {
  const offlineMode = options.offlineMode === true;
  const localSummaries = await listLocalGlossarySummariesForTeam(team);

  if (offlineMode || !Number.isFinite(team?.installationId)) {
    return {
      glossaries: sortGlossaries(
        localSummaries.map(normalizeGlossarySummary).filter(Boolean),
      ),
      remoteRepos: [],
      syncSnapshots: [],
      syncIssue: "",
      brokerWarning: "",
    };
  }

  let metadataRecords = [];
  try {
    metadataRecords = await listGlossaryMetadataRecords(team);
  } catch {}

  let remoteRepos;
  try {
    remoteRepos = await listRemoteGlossaryReposForTeam(team);
  } catch (error) {
    if (glossaryBrokerRouteUnavailable(error) || error?.message === GLOSSARY_BROKER_ROUTE_UNAVAILABLE_MESSAGE) {
      if (metadataRecords.length > 0) {
        const syncRepos = buildMetadataBackedGlossarySyncRepos(metadataRecords, []);
        const syncSnapshots = syncRepos.length > 0
          ? await syncGlossaryReposForTeam(team, syncRepos)
          : [];
        const refreshedLocalSummaries = await listLocalGlossarySummariesForTeam(team);
        return {
          glossaries: mergeMetadataBackedGlossarySummaries(
            refreshedLocalSummaries,
            metadataRecords,
            syncRepos,
          ),
          remoteRepos: syncRepos,
          syncSnapshots,
          syncIssue: getGlossarySyncIssueMessage(syncSnapshots),
          brokerWarning: "",
        };
      }

      return {
        glossaries: sortGlossaries(localSummaries.map(normalizeGlossarySummary).filter(Boolean)),
        remoteRepos: [],
        syncSnapshots: [],
        syncIssue: "",
        brokerWarning: GLOSSARY_BROKER_ROUTE_UNAVAILABLE_MESSAGE,
      };
    }
    throw error;
  }
  const syncTargets = metadataRecords.length > 0
    ? buildMetadataBackedGlossarySyncRepos(metadataRecords, remoteRepos)
    : remoteRepos;
  const syncSnapshots = syncTargets.length > 0
    ? await syncGlossaryReposForTeam(team, syncTargets)
    : [];
  const refreshedLocalSummaries = await listLocalGlossarySummariesForTeam(team);
  const syncIssue = getGlossarySyncIssueMessage(syncSnapshots);

  return {
    glossaries:
      metadataRecords.length > 0
        ? mergeMetadataBackedGlossarySummaries(refreshedLocalSummaries, metadataRecords, remoteRepos)
        : mergeRepoBackedGlossarySummaries(refreshedLocalSummaries, remoteRepos),
    remoteRepos: syncTargets,
    syncSnapshots,
    syncIssue,
    brokerWarning: "",
  };
}

export async function createRemoteGlossaryRepoForTeam(team, repoName) {
  let createdRepo;
  try {
    createdRepo = await invoke("create_gnosis_glossary_repo", {
      input: {
        installationId: team.installationId,
        orgLogin: team.githubOrg,
        repoName,
      },
      sessionToken: requireBrokerSession(),
    });
  } catch (error) {
    throw normalizeGlossaryBrokerError(error);
  }

  const remoteRepo = normalizeRemoteGlossaryRepo(createdRepo);
  if (!remoteRepo) {
    throw new Error("Could not determine the new glossary repo metadata.");
  }
  return remoteRepo;
}

export async function createUniqueRemoteGlossaryRepoForTeam(team, baseRepoName) {
  const { result, attemptedRepoName, collisionResolved } =
    await createUniqueRepoWithNumericSuffix(
      baseRepoName,
      (candidateRepoName) => createRemoteGlossaryRepoForTeam(team, candidateRepoName),
    );
  return {
    remoteRepo: result,
    attemptedRepoName,
    collisionResolved,
  };
}

export async function permanentlyDeleteRemoteGlossaryRepoForTeam(team, repoName) {
  try {
    await invoke("permanently_delete_gnosis_glossary_repo", {
      input: {
        installationId: team.installationId,
        orgLogin: team.githubOrg,
        repoName,
      },
      sessionToken: requireBrokerSession(),
    });
  } catch (error) {
    throw normalizeGlossaryBrokerError(error);
  }
}

export async function syncSingleGlossaryForTeam(team, glossary) {
  const repo =
    glossary && typeof glossary === "object"
      ? normalizeRemoteGlossaryRepo({
          name: glossary.repoName ?? glossary.name,
          fullName: glossary.fullName,
          htmlUrl: glossary.htmlUrl,
          private: glossary.private,
          description: glossary.description,
          defaultBranchName: glossary.defaultBranchName,
          defaultBranchHeadOid: glossary.defaultBranchHeadOid,
          repoId: glossary.repoId,
          nodeId: glossary.nodeId,
        })
      : null;

  if (!repo) {
    return [];
  }

  return syncGlossaryReposForTeam(team, [repo]);
}
