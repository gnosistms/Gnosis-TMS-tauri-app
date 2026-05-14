import { requireBrokerSession } from "./auth-flow.js";
import { appendRepoNameSuffix, slugifyRepoName } from "./repo-names.js";
import { invoke } from "./runtime.js";
import { state } from "./state.js";

function ensureInvoke() {
  if (!invoke) {
    throw new Error("QA list GitHub sync is only available in the desktop app.");
  }
}

export function teamSupportsQaListRepos(team) {
  return Boolean(invoke)
    && Number.isFinite(team?.installationId)
    && typeof team?.githubOrg === "string"
    && team.githubOrg.trim();
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
  return invoke("list_gnosis_qa_lists_for_installation", {
    installationId: team.installationId,
    sessionToken: requireBrokerSession(),
  });
}

export async function syncQaListReposForTeam(team, remoteRepos) {
  if (!teamSupportsQaListRepos(team) || !Array.isArray(remoteRepos) || remoteRepos.length === 0) {
    return [];
  }
  ensureInvoke();
  return invoke("sync_gtms_qa_list_repos", {
    input: {
      installationId: team.installationId,
      qaLists: remoteRepos.map((repo) => ({
        qaListId: repo.qaListId ?? repo.id ?? null,
        repoName: repo.name,
        fullName: repo.fullName,
        repoId: Number.isFinite(repo.repoId) ? repo.repoId : null,
        defaultBranchName: repo.defaultBranchName || "main",
        defaultBranchHeadOid: repo.defaultBranchHeadOid || null,
      })),
    },
    sessionToken: requireBrokerSession(),
  });
}

export async function syncSingleQaListForTeam(team, qaList) {
  const descriptor = qaListRepoDescriptor(qaList);
  if (!descriptor) {
    return [];
  }

  return syncQaListReposForTeam(team, [{
    ...descriptor,
    name: descriptor.repoName,
  }]);
}

export async function createRemoteQaListRepo(team, title) {
  if (!teamSupportsQaListRepos(team)) {
    return null;
  }
  ensureInvoke();

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
      return await invoke("create_gnosis_qa_list_repo", {
        input: {
          installationId: team.installationId,
          orgLogin: team.githubOrg,
          repoName,
        },
        sessionToken: requireBrokerSession(),
      });
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
