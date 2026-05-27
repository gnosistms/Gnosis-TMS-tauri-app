import { requireBrokerSession } from "./auth-flow.js";
import { appendRepoNameSuffix, slugifyRepoName } from "./repo-names.js";
import { invoke } from "./runtime.js";
import { normalizeQaList, sortQaLists } from "./qa-list-shared.js";
import { state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import {
  clearRestoredLocalHardDeleteTombstones,
  filterLocalHardDeletedResources,
  isLocalHardDeletedResource,
} from "./local-hard-delete-store.js";
import { isSoftDeletedResource } from "./resource-write-policy.js";

function ensureInvoke() {
  if (!invoke) {
    throw new Error("QA list GitHub sync is only available in the desktop app.");
  }
}

function normalizeQaListBrokerError(error) {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error ?? "Unknown QA list broker error."));
}

export function teamSupportsQaListRepos(team) {
  return Boolean(invoke)
    && Number.isFinite(team?.installationId)
    && typeof team?.githubOrg === "string"
    && team.githubOrg.trim();
}

export function normalizeRemoteQaListRepo(repo) {
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

export function qaListRepoDescriptor(qaList) {
  if (!qaList?.repoName || !qaList?.fullName) {
    return null;
  }

  return {
    qaListId: qaList.id ?? qaList.qaListId ?? null,
    repoName: qaList.repoName,
    fullName: qaList.fullName,
    repoId: Number.isFinite(qaList.repoId) ? qaList.repoId : null,
    defaultBranchName: qaList.defaultBranchName || "main",
    defaultBranchHeadOid: qaList.defaultBranchHeadOid || null,
  };
}

function qaListRepoSyncDescriptor(repo) {
  return {
    qaListId:
      typeof repo?.qaListId === "string" && repo.qaListId.trim()
        ? repo.qaListId.trim()
        : typeof repo?.id === "string" && repo.id.trim()
          ? repo.id.trim()
          : null,
    repoName: repo.name,
    fullName: repo.fullName,
    repoId: Number.isFinite(repo.repoId) ? repo.repoId : null,
    defaultBranchName: repo.defaultBranchName || "main",
    defaultBranchHeadOid: repo.defaultBranchHeadOid || null,
  };
}

export function getQaListSyncIssueMessage(syncSnapshots) {
  const snapshots = Array.isArray(syncSnapshots) ? syncSnapshots : [];
  const failedSnapshot = snapshots.find((snapshot) =>
    snapshot?.status === "syncError"
    || snapshot?.status === "dirtyLocal"
    || snapshot?.status === "updateRequired"
  );
  if (!failedSnapshot) {
    return { message: "", snapshots };
  }

  return {
    message:
      typeof failedSnapshot.message === "string" && failedSnapshot.message.trim()
        ? failedSnapshot.message.trim()
        : `Could not sync QA list repo ${failedSnapshot.repoName ?? ""}.`.trim(),
    snapshots,
  };
}

export async function listLocalQaListsForTeam(team) {
  if (!Number.isFinite(team?.installationId)) {
    return [];
  }
  ensureInvoke();
  return invoke("list_local_gtms_qa_lists", {
    input: {
      installationId: team.installationId,
    },
  });
}

export async function listRemoteQaListReposForTeam(team) {
  if (!teamSupportsQaListRepos(team)) {
    return [];
  }
  ensureInvoke();
  let repos;
  try {
    repos = await invoke("list_gnosis_qa_lists_for_installation", {
      installationId: team.installationId,
      sessionToken: requireBrokerSession(),
    });
  } catch (error) {
    throw normalizeQaListBrokerError(error);
  }

  return (Array.isArray(repos) ? repos : [])
    .map(normalizeRemoteQaListRepo)
    .filter(Boolean);
}

export async function syncQaListReposForTeam(team, remoteRepos) {
  const qaLists = (Array.isArray(remoteRepos) ? remoteRepos : [])
    .map(normalizeRemoteQaListRepo)
    .filter(Boolean);
  if (!teamSupportsQaListRepos(team) || qaLists.length === 0) {
    return [];
  }
  ensureInvoke();
  return invoke("sync_gtms_qa_list_repos", {
    input: {
      installationId: team.installationId,
      qaLists: qaLists.map(qaListRepoSyncDescriptor),
    },
    sessionToken: requireBrokerSession(),
  });
}

export async function syncSingleQaListForTeam(team, qaList) {
  const repo =
    qaList && typeof qaList === "object"
      ? normalizeRemoteQaListRepo({
          name: qaList.repoName ?? qaList.name,
          fullName: qaList.fullName,
          htmlUrl: qaList.htmlUrl,
          private: qaList.private,
          description: qaList.description,
          defaultBranchName: qaList.defaultBranchName,
          defaultBranchHeadOid: qaList.defaultBranchHeadOid,
          repoId: qaList.repoId,
          nodeId: qaList.nodeId,
        })
      : null;

  if (!repo) {
    return [];
  }

  return syncQaListReposForTeam(team, [{
    ...repo,
    qaListId:
      typeof qaList?.id === "string" && qaList.id.trim()
        ? qaList.id.trim()
        : typeof qaList?.qaListId === "string" && qaList.qaListId.trim()
          ? qaList.qaListId.trim()
          : null,
  }]);
}

export async function createRemoteQaListRepoWithName(team, repoName) {
  if (!teamSupportsQaListRepos(team)) {
    return null;
  }
  ensureInvoke();

  const normalizedRepoName = slugifyRepoName(repoName) || "qa-list";
  let createdRepo;
  try {
    createdRepo = await invoke("create_gnosis_qa_list_repo", {
      input: {
        installationId: team.installationId,
        orgLogin: team.githubOrg,
        repoName: normalizedRepoName,
      },
      sessionToken: requireBrokerSession(),
    });
  } catch (error) {
    throw normalizeQaListBrokerError(error);
  }

  const remoteRepo = normalizeRemoteQaListRepo(createdRepo);
  if (!remoteRepo) {
    throw new Error("Could not determine the new QA list repo metadata.");
  }
  return remoteRepo;
}

export async function createRemoteQaListRepo(team, title) {
  if (!teamSupportsQaListRepos(team)) {
    return null;
  }

  const baseRepoName = slugifyRepoName(`qa-list-${title}`) || "qa-list";
  const usedRepoNames = new Set(
    (state.qaLists ?? [])
      .map((qaList) => String(qaList.repoName ?? "").trim())
      .filter(Boolean),
  );

  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const repoName = appendRepoNameSuffix(baseRepoName, attempt);
    if (usedRepoNames.has(repoName)) {
      continue;
    }

    try {
      return await createRemoteQaListRepoWithName(team, repoName);
    } catch (error) {
      const message = String(error?.message ?? error ?? "").toLowerCase();
      if (!message.includes("name already exists on this account")) {
        throw error;
      }
    }
  }

  throw new Error("Could not determine an available QA list repo name.");
}

export async function prepareLocalQaListRepo(team, repo, qaListId = null) {
  if (!Number.isFinite(team?.installationId) || !repo?.name) {
    return;
  }
  ensureInvoke();
  await invoke("prepare_local_gtms_qa_list_repo", {
    input: {
      installationId: team.installationId,
      qaListId,
      repoName: repo.name,
      remoteUrl: repo.fullName ? `https://github.com/${repo.fullName}.git` : null,
      defaultBranchName: repo.defaultBranchName || "main",
    },
  });
}

export async function deleteRemoteQaListRepo(team, qaList) {
  if (!teamSupportsQaListRepos(team) || !qaList?.repoName) {
    return;
  }
  ensureInvoke();
  await invoke("permanently_delete_gnosis_qa_list_repo", {
    input: {
      installationId: team.installationId,
      orgLogin: team.githubOrg,
      repoName: qaList.repoName,
    },
    sessionToken: requireBrokerSession(),
  });
}

function mergeQaListRepoMetadata(localQaLists, remoteRepos) {
  const remoteByName = new Map(
    (Array.isArray(remoteRepos) ? remoteRepos : [])
      .map(normalizeRemoteQaListRepo)
      .filter(Boolean)
      .map((repo) => [repo.name, repo]),
  );

  return sortQaLists(
    (Array.isArray(localQaLists) ? localQaLists : [])
      .map((qaList) => {
        const remote = remoteByName.get(qaList.repoName);
        return normalizeQaList({
          ...qaList,
          repoId: remote?.repoId ?? qaList.repoId ?? null,
          nodeId: remote?.nodeId ?? qaList.nodeId ?? null,
          fullName: remote?.fullName ?? qaList.fullName ?? null,
          htmlUrl: remote?.htmlUrl ?? qaList.htmlUrl ?? "",
          defaultBranchName: remote?.defaultBranchName ?? qaList.defaultBranchName ?? "main",
          defaultBranchHeadOid: remote?.defaultBranchHeadOid ?? qaList.defaultBranchHeadOid ?? null,
        });
      })
      .filter(Boolean),
  );
}

function applyLocalQaListHardDeleteState(team, qaLists) {
  const items = Array.isArray(qaLists) ? qaLists : [];
  clearRestoredLocalHardDeleteTombstones(team, "qaList", items, {
    isActive: (qaList) => !isSoftDeletedResource(qaList, "qaList"),
  });
  return filterLocalHardDeletedResources(team, "qaList", items, {
    isDeleted: (qaList) => isSoftDeletedResource(qaList, "qaList"),
  });
}

function filterDeletedQaListSyncTargets(team, localQaLists, remoteRepos) {
  const deletedRepoNames = new Set(
    (Array.isArray(localQaLists) ? localQaLists : [])
      .map(normalizeQaList)
      .filter((qaList) => qaList?.lifecycleState === "deleted")
      .map((qaList) => qaList.repoName)
      .filter(Boolean),
  );
  return (Array.isArray(remoteRepos) ? remoteRepos : []).filter((repo) =>
    !deletedRepoNames.has(repo?.name)
    && !isLocalHardDeletedResource(team, "qaList", {
      repoName: repo?.name,
      fullName: repo?.fullName,
      repoId: repo?.repoId,
      nodeId: repo?.nodeId,
    })
  );
}

export async function loadRepoBackedQaListsForTeam(team, options = {}) {
  const offlineMode = options.offlineMode === true;
  const emptyResult = {
    qaLists: [],
    remoteRepos: [],
    syncSnapshots: [],
    syncIssue: "",
    brokerWarning: "",
    recoveryMessage: "",
  };
  if (!Number.isFinite(team?.installationId) || (!teamSupportsQaListRepos(team) && !invoke)) {
    return emptyResult;
  }

  let localQaLists = await listLocalQaListsForTeam(team);

  if (offlineMode || !teamSupportsQaListRepos(team)) {
    return {
      qaLists: sortQaLists(
        applyLocalQaListHardDeleteState(team, localQaLists.map(normalizeQaList).filter(Boolean)),
      ),
      remoteRepos: [],
      syncSnapshots: [],
      syncIssue: "",
      brokerWarning: "",
      recoveryMessage: "",
    };
  }

  const remoteRepos = await listRemoteQaListReposForTeam(team);
  const syncTargets = filterDeletedQaListSyncTargets(team, localQaLists, remoteRepos);
  const syncSnapshots = syncTargets.length > 0
    ? await syncQaListReposForTeam(team, syncTargets)
    : [];
  localQaLists = await listLocalQaListsForTeam(team);
  const syncIssue = getQaListSyncIssueMessage(syncSnapshots);
  const mergedQaLists = mergeQaListRepoMetadata(localQaLists, remoteRepos);

  return {
    qaLists: applyLocalQaListHardDeleteState(team, mergedQaLists),
    remoteRepos,
    syncSnapshots,
    syncIssue,
    brokerWarning: "",
    recoveryMessage: "",
  };
}

export async function ensureQaListNotTombstoned(render, team, qaList) {
  if (!Number.isFinite(team?.installationId) || !qaList?.id) {
    return false;
  }

  // QA lists do not yet have team metadata tombstone records like glossaries.
  // Keep the lifecycle API shape aligned so the real tombstone check can be
  // plugged in when QA list metadata reaches parity.
  if (qaList.recordState === "tombstone" || qaList.remoteState === "deleted") {
    state.qaLists = state.qaLists.filter((item) => item?.id !== qaList.id);
    showNoticeBadge("This QA list has already been permanently deleted.", render);
    render?.();
    return true;
  }

  return false;
}
