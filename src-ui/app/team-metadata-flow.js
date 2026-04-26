import { requireBrokerSession } from "./auth-flow.js";
import { invoke } from "./runtime.js";

const METADATA_WRITE_RETRY_DELAYS_MS = [180, 420];
const teamMetadataWriteQueues = new Map();

function metadataRouteUnavailable(error, resourcePath, methods = ["PATCH", "DELETE"]) {
  const message = String(error?.message ?? error ?? "");
  return message.includes(resourcePath) && methods.some((method) => message.includes(`Cannot ${method} `));
}

function normalizeMetadataError(error, fallbackMessage, resourcePath, methods) {
  if (metadataRouteUnavailable(error, resourcePath, methods)) {
    return new Error(fallbackMessage);
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error ?? fallbackMessage));
}

function metadataWriteConflict(error) {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  return (
    message.includes("status: 409")
    || message.includes("github api conflict")
    || (message.includes("sha") && message.includes("match"))
  );
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function teamMetadataWriteQueueKey(team) {
  if (Number.isFinite(team?.installationId)) {
    return `installation:${team.installationId}`;
  }

  if (typeof team?.id === "string" && team.id.trim()) {
    return `team:${team.id.trim()}`;
  }

  if (typeof team?.githubOrg === "string" && team.githubOrg.trim()) {
    return `org:${team.githubOrg.trim()}`;
  }

  return "unknown";
}

export function enqueueTeamMetadataWrite(team, operation) {
  if (typeof operation !== "function") {
    throw new Error("Team metadata write queue requires an operation callback.");
  }

  const queueKey = teamMetadataWriteQueueKey(team);
  const previousTail = teamMetadataWriteQueues.get(queueKey) ?? Promise.resolve();
  const run = previousTail.then(() => operation());
  const nextTail = run.catch(() => null);

  teamMetadataWriteQueues.set(queueKey, nextTail);
  void nextTail.then(() => {
    if (teamMetadataWriteQueues.get(queueKey) === nextTail) {
      teamMetadataWriteQueues.delete(queueKey);
    }
  });

  return run;
}

async function withMetadataWriteRetries(operation) {
  let lastError = null;

  for (let attempt = 0; attempt <= METADATA_WRITE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!metadataWriteConflict(error) || attempt === METADATA_WRITE_RETRY_DELAYS_MS.length) {
        throw error;
      }
      await delay(METADATA_WRITE_RETRY_DELAYS_MS[attempt]);
    }
  }

  throw lastError ?? new Error("The metadata write could not be completed.");
}

function metadataLanguagePayload(language) {
  const code =
    typeof language?.code === "string" && language.code.trim()
      ? language.code.trim()
      : "";
  const name =
    typeof language?.name === "string" && language.name.trim()
      ? language.name.trim()
      : "";

  if (!code || !name) {
    return null;
  }

  return { code, name };
}

function normalizeMetadataLanguage(language) {
  const code =
    typeof language?.code === "string" && language.code.trim()
      ? language.code.trim()
      : "";
  const name =
    typeof language?.name === "string" && language.name.trim()
      ? language.name.trim()
      : "";
  return code && name ? { code, name } : null;
}

function normalizeStringList(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  )];
}

function normalizeProjectMetadataRecord(record) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const id =
    typeof record.id === "string" && record.id.trim()
      ? record.id.trim()
      : null;
  const title =
    typeof record.title === "string" && record.title.trim()
      ? record.title.trim()
      : null;
  const repoName =
    typeof record.repoName === "string" && record.repoName.trim()
      ? record.repoName.trim()
      : null;
  if (!id || !title || !repoName) {
    return null;
  }

  return {
    id,
    kind: "project",
    title,
    repoName,
    previousRepoNames: normalizeStringList(record.previousRepoNames),
    githubRepoId: Number.isFinite(record.githubRepoId) ? record.githubRepoId : null,
    githubNodeId:
      typeof record.githubNodeId === "string" && record.githubNodeId.trim()
        ? record.githubNodeId.trim()
        : null,
    fullName:
      typeof record.fullName === "string" && record.fullName.trim()
        ? record.fullName.trim()
        : null,
    defaultBranch:
      typeof record.defaultBranch === "string" && record.defaultBranch.trim()
        ? record.defaultBranch.trim()
        : "main",
    lifecycleState:
      record.lifecycleState === "softDeleted" || record.lifecycleState === "deleted"
        ? "deleted"
        : "active",
    remoteState:
      typeof record.remoteState === "string" && record.remoteState.trim()
        ? record.remoteState.trim()
        : "linked",
    recordState:
      typeof record.recordState === "string" && record.recordState.trim()
        ? record.recordState.trim()
        : "live",
    deletedAt:
      typeof record.deletedAt === "string" && record.deletedAt.trim()
        ? record.deletedAt.trim()
        : null,
    chapterCount: Number.isFinite(record.chapterCount) ? record.chapterCount : 0,
  };
}

function normalizeGlossaryMetadataRecord(record) {
  const shared = normalizeProjectMetadataRecord(record);
  if (!shared) {
    return null;
  }

  return {
    ...shared,
    kind: "glossary",
    sourceLanguage: normalizeMetadataLanguage(record.sourceLanguage),
    targetLanguage: normalizeMetadataLanguage(record.targetLanguage),
    termCount: Number.isFinite(record.termCount) ? record.termCount : 0,
  };
}

function normalizeLocalRepoRepairIssue(issue) {
  if (!issue || typeof issue !== "object") {
    return null;
  }

  const kind =
    typeof issue.kind === "string" && issue.kind.trim()
      ? issue.kind.trim()
      : null;
  const issueType =
    typeof issue.issueType === "string" && issue.issueType.trim()
      ? issue.issueType.trim()
      : null;
  const message =
    typeof issue.message === "string" && issue.message.trim()
      ? issue.message.trim()
      : null;
  if (!kind || !issueType || !message) {
    return null;
  }

  return {
    kind,
    issueType,
    resourceId:
      typeof issue.resourceId === "string" && issue.resourceId.trim()
        ? issue.resourceId.trim()
        : null,
    repoName:
      typeof issue.repoName === "string" && issue.repoName.trim()
        ? issue.repoName.trim()
        : null,
    expectedRepoName:
      typeof issue.expectedRepoName === "string" && issue.expectedRepoName.trim()
        ? issue.expectedRepoName.trim()
        : null,
    message,
    canAutoRepair: issue.canAutoRepair === true,
  };
}

function previousRepoNamesPayload(previousRepoNames = []) {
  const names = [...new Set(
    (Array.isArray(previousRepoNames) ? previousRepoNames : [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  )];
  return names.length > 0 ? names : undefined;
}

async function ensureLocalTeamMetadataRepo(team) {
  return invoke("ensure_local_team_metadata_repo", {
    installationId: team.installationId,
    orgLogin: team.githubOrg,
    sessionToken: requireBrokerSession(),
  });
}

async function syncLocalTeamMetadataRepo(team) {
  return invoke("sync_local_team_metadata_repo", {
    installationId: team.installationId,
    orgLogin: team.githubOrg,
    sessionToken: requireBrokerSession(),
  });
}

async function pushLocalTeamMetadataRepo(team) {
  return invoke("push_local_team_metadata_repo", {
    installationId: team.installationId,
    orgLogin: team.githubOrg,
    sessionToken: requireBrokerSession(),
  });
}

function localMetadataPushConflict(error) {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  return (
    message.includes("non-fast-forward")
    || message.includes("fetch first")
    || message.includes("failed to push some refs")
    || message.includes("tip of your current branch is behind")
  );
}

async function commitLocalMetadataMutation(team, operation, options = {}) {
  return enqueueTeamMetadataWrite(team, async () => {
    await ensureLocalTeamMetadataRepo(team);

    let syncError = null;
    try {
      await syncLocalTeamMetadataRepo(team);
    } catch (error) {
      syncError = error;
    }

    try {
      const result = await operation();
      if (result?.commitCreated !== false) {
        try {
          await pushLocalTeamMetadataRepo(team);
        } catch (pushError) {
          if (options.requirePushSuccess === true) {
            throw pushError;
          }
          console.warn(
            localMetadataPushConflict(pushError)
              ? `team-metadata push conflict after local commit: ${pushError?.message ?? String(pushError)}`
              : `team-metadata push failed after local commit: ${pushError?.message ?? String(pushError)}`,
          );
        }
      }
      if (syncError) {
        console.warn(`Best-effort team-metadata sync failed before local commit: ${syncError?.message ?? String(syncError)}`);
      }
      return result;
    } catch (error) {
      if (syncError) {
        throw new Error(
          `${error?.message ?? String(error)} A best-effort sync of the local team-metadata repo also failed before this write: ${
            syncError?.message ?? String(syncError)
          }`,
        );
      }
      throw error;
    }
  });
}

export async function upsertProjectMetadataRecord(team, record, options = {}) {
  await commitLocalMetadataMutation(
    team,
    () =>
      invoke("upsert_local_gnosis_project_metadata_record", {
        input: {
          installationId: team.installationId,
          orgLogin: team.githubOrg,
          projectId: record.projectId,
          title: record.title,
          repoName: record.repoName,
          previousRepoNames: previousRepoNamesPayload(record.previousRepoNames),
          githubRepoId: Number.isFinite(record.githubRepoId) ? record.githubRepoId : null,
          githubNodeId:
            typeof record.githubNodeId === "string" && record.githubNodeId.trim()
              ? record.githubNodeId.trim()
              : null,
          fullName:
            typeof record.fullName === "string" && record.fullName.trim()
              ? record.fullName.trim()
              : null,
          defaultBranch:
            typeof record.defaultBranch === "string" && record.defaultBranch.trim()
              ? record.defaultBranch.trim()
              : null,
          lifecycleState: record.lifecycleState ?? null,
          remoteState: record.remoteState ?? null,
          recordState: record.recordState ?? null,
          deletedAt:
            typeof record.deletedAt === "string" && record.deletedAt.trim()
              ? record.deletedAt.trim()
              : null,
        },
        sessionToken: requireBrokerSession(),
      }),
    options,
  );
}

export async function deleteProjectMetadataRecord(team, projectId, options = {}) {
  await commitLocalMetadataMutation(
    team,
    () =>
      invoke("delete_local_gnosis_project_metadata_record", {
        input: {
          installationId: team.installationId,
          orgLogin: team.githubOrg,
          projectId,
        },
        sessionToken: requireBrokerSession(),
      }),
    options,
  );
}

export async function upsertGlossaryMetadataRecord(team, record, options = {}) {
  await commitLocalMetadataMutation(
    team,
    () =>
      invoke("upsert_local_gnosis_glossary_metadata_record", {
        input: {
          installationId: team.installationId,
          orgLogin: team.githubOrg,
          glossaryId: record.glossaryId,
          title: record.title,
          repoName: record.repoName,
          previousRepoNames: previousRepoNamesPayload(record.previousRepoNames),
          githubRepoId: Number.isFinite(record.githubRepoId) ? record.githubRepoId : null,
          githubNodeId:
            typeof record.githubNodeId === "string" && record.githubNodeId.trim()
              ? record.githubNodeId.trim()
              : null,
          fullName:
            typeof record.fullName === "string" && record.fullName.trim()
              ? record.fullName.trim()
              : null,
          defaultBranch:
            typeof record.defaultBranch === "string" && record.defaultBranch.trim()
              ? record.defaultBranch.trim()
              : null,
          lifecycleState: record.lifecycleState ?? null,
          remoteState: record.remoteState ?? null,
          recordState: record.recordState ?? null,
          deletedAt:
            typeof record.deletedAt === "string" && record.deletedAt.trim()
              ? record.deletedAt.trim()
              : null,
          sourceLanguage: metadataLanguagePayload(record.sourceLanguage),
          targetLanguage: metadataLanguagePayload(record.targetLanguage),
        },
        sessionToken: requireBrokerSession(),
      }),
    options,
  );
}

export async function deleteGlossaryMetadataRecord(team, glossaryId, options = {}) {
  await commitLocalMetadataMutation(
    team,
    () =>
      invoke("delete_local_gnosis_glossary_metadata_record", {
        input: {
          installationId: team.installationId,
          orgLogin: team.githubOrg,
          glossaryId,
        },
        sessionToken: requireBrokerSession(),
      }),
    options,
  );
}

export async function lookupLocalMetadataTombstone(team, kind, resourceId) {
  if (!Number.isFinite(team?.installationId) || typeof resourceId !== "string" || !resourceId.trim()) {
    return false;
  }

  await ensureLocalTeamMetadataRepo(team);
  return invoke("lookup_local_team_metadata_tombstone", {
    installationId: team.installationId,
    kind,
    resourceId,
  });
}

export async function listProjectMetadataRecords(team) {
  const syncPromise = invoke("sync_local_team_metadata_repo", {
    installationId: team.installationId,
    orgLogin: team.githubOrg,
    sessionToken: requireBrokerSession(),
  });

  try {
    const records = await invoke("list_local_gnosis_project_metadata_records", {
      installationId: team.installationId,
    });
    void syncPromise.catch(() => null);
    return (Array.isArray(records) ? records : [])
      .map(normalizeProjectMetadataRecord)
      .filter(Boolean);
  } catch (error) {
    let detail = error?.message ?? String(error);
    try {
      await syncPromise;
      const records = await invoke("list_local_gnosis_project_metadata_records", {
        installationId: team.installationId,
      });
      return (Array.isArray(records) ? records : [])
        .map(normalizeProjectMetadataRecord)
        .filter(Boolean);
    } catch (syncError) {
      detail = syncError?.message ?? detail;
    }
    throw new Error(`Project metadata could not be loaded from the local team-metadata repo. ${detail}`);
  }
}

export async function listGlossaryMetadataRecords(team) {
  const syncPromise = invoke("sync_local_team_metadata_repo", {
    installationId: team.installationId,
    orgLogin: team.githubOrg,
    sessionToken: requireBrokerSession(),
  });

  try {
    const records = await invoke("list_local_gnosis_glossary_metadata_records", {
      installationId: team.installationId,
    });
    void syncPromise.catch(() => null);
    return (Array.isArray(records) ? records : [])
      .map(normalizeGlossaryMetadataRecord)
      .filter(Boolean);
  } catch (error) {
    let detail = error?.message ?? String(error);
    try {
      await syncPromise;
      const records = await invoke("list_local_gnosis_glossary_metadata_records", {
        installationId: team.installationId,
      });
      return (Array.isArray(records) ? records : [])
        .map(normalizeGlossaryMetadataRecord)
        .filter(Boolean);
    } catch (syncError) {
      detail = syncError?.message ?? detail;
    }
    throw new Error(`Glossary metadata could not be loaded from the local team-metadata repo. ${detail}`);
  }
}

export async function refreshGlossaryMetadataRecords(team) {
  await syncLocalTeamMetadataRepo(team);
  const records = await invoke("list_local_gnosis_glossary_metadata_records", {
    installationId: team.installationId,
  });
  return (Array.isArray(records) ? records : [])
    .map(normalizeGlossaryMetadataRecord)
    .filter(Boolean);
}

export async function inspectAndMigrateLocalRepoBindings(team) {
  if (!Number.isFinite(team?.installationId)) {
    return {
      issues: [],
      autoRepairedCount: 0,
    };
  }

  await ensureLocalTeamMetadataRepo(team);
  const result = await invoke("inspect_and_migrate_local_repo_bindings", {
    installationId: team.installationId,
  });

  return {
    issues: (Array.isArray(result?.issues) ? result.issues : [])
      .map(normalizeLocalRepoRepairIssue)
      .filter(Boolean),
    autoRepairedCount: Number.isFinite(result?.autoRepairedCount)
      ? result.autoRepairedCount
      : 0,
  };
}

export async function repairLocalRepoBinding(team, kind, resourceId) {
  if (!Number.isFinite(team?.installationId)) {
    throw new Error("Could not determine which installation to repair.");
  }

  const result = await invoke("repair_local_repo_binding", {
    input: {
      installationId: team.installationId,
      kind,
      resourceId,
    },
  });

  return normalizeLocalRepoRepairIssue(result);
}

export async function repairAutoRepairableRepoBindings(team, issues) {
  const repairTargets = [...new Map(
    (Array.isArray(issues) ? issues : [])
      .filter((issue) =>
        issue?.canAutoRepair === true
        && issue?.issueType === "missingOrigin"
        && typeof issue?.kind === "string"
        && issue.kind.trim()
        && typeof issue?.resourceId === "string"
        && issue.resourceId.trim()
      )
      .map((issue) => [`${issue.kind}:${issue.resourceId}`, issue]),
  ).values()];

  if (repairTargets.length === 0) {
    return [];
  }

  const repaired = [];
  for (const issue of repairTargets) {
    try {
      const result = await repairLocalRepoBinding(team, issue.kind, issue.resourceId);
      if (result) {
        repaired.push(result);
      }
    } catch {
      // Leave unrepaired issues visible in discovery rather than failing the whole load path.
    }
  }

  return repaired;
}
