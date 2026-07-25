import { requireBrokerSession } from "./auth-flow.js";
import { formatErrorForDisplay } from "./error-display.js";
import { compareDefaultCandidates } from "./glossary-default-flow.js";
import { loadStoredGlossariesForTeam } from "./glossary-cache.js";
import {
  createProjectRepoForTeam,
  projectsPageOwnsTeam,
  reloadProjectsAfterWrite,
  rollbackCreatedProjectRepo,
} from "./project-flow.js";
import { slugifyRepoName } from "./repo-names.js";
import { canCreateRepoResources } from "./resource-capabilities.js";
import { enqueueRepoWrite, projectRepoScope } from "./repo-write-queue.js";
import { invoke, listen } from "./runtime.js";
import { createProjectTransferState, resetProjectTransfer, state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import {
  deleteProjectMetadataRecord,
  refreshGlossaryMetadataRecords,
  upsertProjectMetadataRecord,
} from "./team-metadata-flow.js";

const activeProjectTransferJobs = new Set();
const finalizingProjectTransferJobs = new Set();
let listenersRegistered = false;
let listenerRegistrationPromise = null;
let recoveryRetryTimer = null;

function normalizeText(value) {
  return String(value ?? "").trim();
}

function createJobId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `project-transfer-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function currentTransferMatches(jobId) {
  return Boolean(jobId) && state.projectTransfer?.jobId === jobId;
}

function patchTransfer(patch, render = null) {
  state.projectTransfer = {
    ...(state.projectTransfer ?? createProjectTransferState()),
    ...patch,
  };
  render?.();
}

function projectForTransfer(projectId) {
  return (Array.isArray(state.projects) ? state.projects : [])
    .find((project) => project?.id === projectId) ?? null;
}

function eligibleTarget(teamId) {
  return eligibleProjectTransferTargets().find((team) => team?.id === teamId) ?? null;
}

export function eligibleProjectTransferTargets(appState = state) {
  return (Array.isArray(appState?.teams) ? appState.teams : [])
    .filter((team) => canCreateRepoResources(team));
}

export function openProjectTransfer(render, projectId, operations = {}) {
  const project = projectForTransfer(projectId);
  if (!project) {
    showNoticeBadge("Could not find the selected project.", render);
    return;
  }
  const targets = eligibleProjectTransferTargets();
  state.projectTransfer = {
    ...createProjectTransferState(),
    isOpen: true,
    projectId: project.id,
    sourceTitle: normalizeText(project.title ?? project.name),
    projectName: normalizeText(project.title ?? project.name),
  };
  render?.();
  if (targets.length === 1) {
    selectProjectTransferTeam(render, targets[0].id, operations);
  }
}

export function updateProjectTransferName(value, render = null) {
  patchTransfer({ projectName: String(value ?? ""), error: "" }, render);
}

export function selectProjectTransferGlossary(render, glossaryId) {
  if (state.projectTransfer?.status === "transferring") {
    return;
  }
  const normalizedId = normalizeText(glossaryId);
  const valid = !normalizedId
    || state.projectTransfer?.glossaries?.some((glossary) => glossary.id === normalizedId);
  patchTransfer({ glossaryId: valid ? normalizedId : "", error: "" }, render);
}

export function cancelProjectTransfer(render) {
  if (state.projectTransfer?.status === "transferring") {
    return;
  }
  resetProjectTransfer();
  render?.();
}

export function selectProjectTransferTeam(render, teamId, operations = {}) {
  if (!state.projectTransfer?.isOpen || state.projectTransfer.status === "transferring") {
    return;
  }
  const team = eligibleTarget(teamId);
  patchTransfer({
    targetTeamId: team?.id ?? "",
    glossaryId: "",
    glossaries: [],
    targetProjects: [],
    resourcesStatus: team ? "loading" : "idle",
    error: "",
  }, render);
  if (team) {
    void loadProjectTransferResources(render, team, operations);
  }
}

function remoteGlossaryForRecord(record, remotes) {
  return remotes.find((remote) =>
    (Number.isFinite(record?.githubRepoId) && remote?.repoId === record.githubRepoId)
    || (
      normalizeText(record?.githubNodeId)
      && normalizeText(remote?.nodeId) === normalizeText(record.githubNodeId)
    )
    || normalizeText(remote?.name) === normalizeText(record?.repoName)
    || (
      normalizeText(record?.fullName)
      && normalizeText(remote?.fullName) === normalizeText(record.fullName)
    )
  ) ?? null;
}

export function reconcileProjectTransferGlossaries(metadataRecords, remoteRepos, cachedGlossaries) {
  const remotes = Array.isArray(remoteRepos) ? remoteRepos : [];
  const cachedById = new Map(
    (Array.isArray(cachedGlossaries) ? cachedGlossaries : [])
      .map((glossary) => [glossary?.id, glossary]),
  );
  return (Array.isArray(metadataRecords) ? metadataRecords : [])
    .filter((record) =>
      record?.lifecycleState !== "deleted"
      && record?.recordState !== "tombstone"
      && (record?.remoteState ?? "linked") === "linked"
    )
    .map((record) => {
      const remote = remoteGlossaryForRecord(record, remotes);
      if (!remote) {
        return null;
      }
      const cached = cachedById.get(record.id);
      return {
        id: record.id,
        title: record.title,
        repoName: remote.name,
        termCount: Number.isFinite(cached?.termCount)
          ? cached.termCount
          : Number.isFinite(record.termCount)
            ? record.termCount
            : 0,
      };
    })
    .filter(Boolean)
    .sort(compareDefaultCandidates);
}

async function loadProjectTransferResources(render, team, operations = {}) {
  const invokeCommand = operations.invoke ?? invoke;
  const requireSession = operations.requireBrokerSession ?? requireBrokerSession;
  const refreshMetadata =
    operations.refreshGlossaryMetadataRecords ?? refreshGlossaryMetadataRecords;
  try {
    const [resources, metadataRecords] = await Promise.all([
      invokeCommand("list_gnosis_resources_for_installation", {
        installationId: team.installationId,
        sessionToken: requireSession(),
      }),
      refreshMetadata(team),
    ]);
    if (state.projectTransfer?.targetTeamId !== team.id) {
      return;
    }
    const cached = loadStoredGlossariesForTeam(team)?.glossaries ?? [];
    const glossaries = reconcileProjectTransferGlossaries(
      metadataRecords,
      resources?.glossaries,
      cached,
    );
    const targetProjects = (Array.isArray(resources?.projects) ? resources.projects : [])
      .filter((project) => normalizeText(project?.status).toLowerCase() !== "deleted");
    patchTransfer({
      glossaries,
      targetProjects,
      glossaryId: glossaries[0]?.id ?? "",
      resourcesStatus: "done",
      error: "",
    }, render);
  } catch (error) {
    if (state.projectTransfer?.targetTeamId !== team.id) {
      return;
    }
    patchTransfer({
      glossaries: [],
      targetProjects: [],
      glossaryId: "",
      resourcesStatus: "error",
      error: formatErrorForDisplay(error),
    }, render);
  }
}

function selectedGlossary(transfer) {
  if (!transfer?.glossaryId) {
    return null;
  }
  return transfer.glossaries.find((glossary) => glossary.id === transfer.glossaryId) ?? null;
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function updateStageIfVisible(jobId, stage, render) {
  if (currentTransferMatches(jobId)) {
    patchTransfer({ stage }, render);
  }
}

function statusIsTerminal(status) {
  return status?.status === "success" || status?.status === "error";
}

async function waitForProjectTransferStatus(jobId, render, operations = {}) {
  const invokeCommand = operations.invoke ?? invoke;
  const pollDelayMs = Number.isFinite(operations.pollDelayMs)
    ? Math.max(0, operations.pollDelayMs)
    : 250;
  let readFailures = 0;
  while (true) {
    let status;
    try {
      status = await invokeCommand("get_gtms_project_transfer_status", {
        input: { jobId },
      });
    } catch (error) {
      readFailures += 1;
      if (readFailures < 4) {
        await delay(pollDelayMs);
        continue;
      }
      const recoveryError = new Error(
        `The project transfer is still being recovered: ${formatErrorForDisplay(error)}`,
      );
      recoveryError.deferTransferRecovery = true;
      throw recoveryError;
    }
    if (!status) {
      readFailures += 1;
      if (readFailures < 4) {
        await delay(pollDelayMs);
        continue;
      }
      const recoveryError = new Error("The project transfer status could not be recovered yet.");
      recoveryError.deferTransferRecovery = true;
      throw recoveryError;
    }
    readFailures = 0;
    if (statusIsTerminal(status)) {
      return status;
    }
    updateStageIfVisible(jobId, normalizeText(status.message), render);
    await delay(pollDelayMs);
  }
}

function recoveryTargetTeam(status) {
  const recovery = status?.recovery ?? {};
  return {
    installationId: recovery.targetInstallationId,
    githubOrg: recovery.targetOrgLogin,
    name: recovery.targetOrgLogin,
  };
}

function recoveryCreatedProject(status) {
  const recovery = status?.recovery ?? {};
  return {
    projectId: recovery.targetProjectId,
    repoName: recovery.targetRepoName,
    localRepoInitialized: true,
    remoteProject: {
      name: recovery.metadataRepoName || recovery.targetRepoName,
      fullName: recovery.targetFullName,
      repoId: recovery.targetRepoId ?? null,
      nodeId: recovery.targetNodeId ?? null,
      defaultBranchName: recovery.targetDefaultBranch || "main",
    },
    metadataRecord: {
      projectId: recovery.targetProjectId,
      title: status.targetProjectTitle,
      repoName: recovery.metadataRepoName || recovery.targetRepoName,
      previousRepoNames: Array.isArray(recovery.previousRepoNames)
        ? recovery.previousRepoNames
        : [],
      githubRepoId: recovery.targetRepoId ?? null,
      githubNodeId: recovery.targetNodeId ?? null,
      fullName: recovery.targetFullName,
      defaultBranch: recovery.targetDefaultBranch || "main",
      lifecycleState: recovery.targetLifecycleState || "active",
      recordState: recovery.targetRecordState || "live",
      remoteState: recovery.targetRemoteState || "linked",
      deletedAt: null,
    },
  };
}

async function acknowledgeTransferStatus(jobId, invokeCommand) {
  await invokeCommand("acknowledge_gtms_project_transfer_status", {
    input: { jobId },
  });
}

async function rollbackRecoveredTransfer(status, error, operations) {
  const rollbackRepo = operations.rollbackCreatedProjectRepo ?? rollbackCreatedProjectRepo;
  await rollbackRepo(
    recoveryTargetTeam(status),
    recoveryCreatedProject(status),
    error,
    {
      invoke: operations.invoke ?? invoke,
      requireBrokerSession: operations.requireBrokerSession ?? requireBrokerSession,
      rethrowCause: false,
    },
  );
}

async function publishRecoveredTransfer(status, operations) {
  const upsertMetadata = operations.upsertProjectMetadataRecord ?? upsertProjectMetadataRecord;
  const deleteMetadata =
    operations.deleteProjectMetadataRecord ?? deleteProjectMetadataRecord;
  const targetTeam = recoveryTargetTeam(status);
  const created = recoveryCreatedProject(status);
  const copiedChapters = status?.copiedChapters;
  if (!Number.isSafeInteger(copiedChapters) || copiedChapters < 1) {
    throw new Error("The transfer completed without an authoritative copied-file count.");
  }
  try {
    await upsertMetadata(
      targetTeam,
      {
        ...created.metadataRecord,
        chapterCount: copiedChapters,
      },
      { requirePushSuccess: true },
    );
  } catch (metadataError) {
    try {
      await deleteMetadata(
        targetTeam,
        created.projectId,
        { requirePushSuccess: true },
      );
    } catch (rollbackError) {
      const ambiguousError = new Error(
        `${metadataError?.message ?? String(metadataError)} Metadata cleanup also failed, so the destination project was preserved to avoid leaving an active metadata record pointing to a deleted project: ${
          rollbackError?.message ?? String(rollbackError)
        }`,
      );
      ambiguousError.preserveCreatedProject = true;
      throw ambiguousError;
    }
    throw metadataError;
  }
  return { targetTeam, created };
}

async function finalizeProjectTransferStatus(status, operations = {}) {
  const jobId = normalizeText(status?.jobId);
  if (!jobId || finalizingProjectTransferJobs.has(jobId)) {
    return null;
  }
  finalizingProjectTransferJobs.add(jobId);
  const invokeCommand = operations.invoke ?? invoke;
  try {
    if (status.status === "success") {
      try {
        const result = await publishRecoveredTransfer(status, operations);
        await acknowledgeTransferStatus(jobId, invokeCommand);
        return { ...result, success: true };
      } catch (error) {
        if (error?.preserveCreatedProject === true) {
          throw error;
        }
        await rollbackRecoveredTransfer(status, error, operations);
        await acknowledgeTransferStatus(jobId, invokeCommand);
        error.transferFinalized = true;
        throw error;
      }
    }
    const error = new Error(normalizeText(status.message) || "The project transfer failed.");
    await rollbackRecoveredTransfer(status, error, operations);
    await acknowledgeTransferStatus(jobId, invokeCommand);
    error.transferFinalized = true;
    return { error, success: false };
  } finally {
    finalizingProjectTransferJobs.delete(jobId);
  }
}

function scheduleProjectTransferRecovery(render, operations = {}) {
  if (recoveryRetryTimer !== null) {
    return;
  }
  recoveryRetryTimer = window.setTimeout(() => {
    recoveryRetryTimer = null;
    void recoverPendingProjectTransfers(render, operations);
  }, 1000);
}

export async function recoverPendingProjectTransfers(render, operations = {}) {
  const invokeCommand = operations.invoke ?? invoke;
  let statuses;
  try {
    (operations.requireBrokerSession ?? requireBrokerSession)();
    statuses = await invokeCommand("list_gtms_project_transfer_statuses");
  } catch {
    scheduleProjectTransferRecovery(render, operations);
    return false;
  }
  let pending = false;
  for (const status of Array.isArray(statuses) ? statuses : []) {
    if (!statusIsTerminal(status)) {
      pending = true;
      continue;
    }
    try {
      const result = await finalizeProjectTransferStatus(status, operations);
      if (!result) {
        continue;
      }
      if (currentTransferMatches(status.jobId)) {
        resetProjectTransfer();
        render?.();
      }
      if (result.success) {
        showNoticeBadge(
          `Finished transferring ${status.targetProjectTitle}.`,
          render,
          3200,
        );
      } else {
        showNoticeBadge(
          `Project transfer failed: ${formatErrorForDisplay(result.error)}`,
          render,
          4200,
        );
      }
    } catch (error) {
      pending = true;
      if (currentTransferMatches(status.jobId)) {
        patchTransfer({
          status: "idle",
          stage: "",
          error: formatErrorForDisplay(error),
        }, render);
      }
    }
  }
  if (pending) {
    scheduleProjectTransferRecovery(render, operations);
  }
  return true;
}

export async function submitProjectTransfer(render, operations = {}) {
  const transfer = state.projectTransfer;
  if (!transfer?.isOpen || transfer.status === "transferring") {
    return false;
  }
  const sourceTeam = state.teams.find((team) => team?.id === state.selectedTeamId) ?? null;
  const targetTeam = eligibleTarget(transfer.targetTeamId);
  const sourceProject = projectForTransfer(transfer.projectId);
  const projectName = normalizeText(transfer.projectName);
  const baseRepoName = slugifyRepoName(projectName);
  if (!targetTeam) {
    patchTransfer({ error: "Choose the destination team first." }, render);
    return false;
  }
  if (!projectName) {
    patchTransfer({ error: "Enter a project name." }, render);
    return false;
  }
  if (!baseRepoName) {
    patchTransfer({
      error: "Project names must contain at least one letter or number.",
    }, render);
    return false;
  }
  if (!sourceTeam || !sourceProject) {
    patchTransfer({ error: "Could not find the source project." }, render);
    return false;
  }

  const requireSession = operations.requireBrokerSession ?? requireBrokerSession;
  let sessionToken;
  try {
    sessionToken = requireSession();
  } catch (error) {
    patchTransfer({ error: formatErrorForDisplay(error) }, render);
    return false;
  }

  const invokeCommand = operations.invoke ?? invoke;
  const enqueue = operations.enqueueRepoWrite ?? enqueueRepoWrite;
  const createRepo = operations.createProjectRepoForTeam ?? createProjectRepoForTeam;
  const rollbackRepo = operations.rollbackCreatedProjectRepo ?? rollbackCreatedProjectRepo;
  const upsertMetadata = operations.upsertProjectMetadataRecord ?? upsertProjectMetadataRecord;
  const deleteMetadata =
    operations.deleteProjectMetadataRecord ?? deleteProjectMetadataRecord;
  const reloadProjects = operations.reloadProjectsAfterWrite ?? reloadProjectsAfterWrite;
  const ownsProjectsPage = operations.projectsPageOwnsTeam ?? projectsPageOwnsTeam;
  const jobId = createJobId();
  const glossary = selectedGlossary(transfer);
  patchTransfer({
    status: "transferring",
    stage: "Starting the transfer...",
    jobId,
    error: "",
  }, render);

  let created = null;
  try {
    const result = await enqueue({
      scope: projectRepoScope({ team: targetTeam }),
      kind: "projectTransfer",
      sourceScreen: "projects",
      run: async () => {
        try {
          created = await createRepo(targetTeam, projectName, baseRepoName, {
            usedRepoNames: new Set(
              transfer.targetProjects.map((project) => normalizeText(project?.name)).filter(Boolean),
            ),
            writeMetadataRecord: false,
            invoke: invokeCommand,
            requireBrokerSession: () => sessionToken,
            onProgress: (message) => updateStageIfVisible(jobId, message, render),
          });
          activeProjectTransferJobs.add(jobId);
          const transferStatus = await enqueue({
            scope: projectRepoScope({ team: sourceTeam, project: sourceProject }),
            kind: "projectTransferSourceRead",
            sourceScreen: "projects",
            run: async () => {
              await invokeCommand("transfer_gtms_project_to_team", {
                input: {
                  jobId,
                  source: {
                    installationId: sourceTeam.installationId,
                    projectId: sourceProject.id ?? null,
                    repoName: sourceProject.name,
                    projectTitle: transfer.sourceTitle,
                  },
                  target: {
                    installationId: targetTeam.installationId,
                    orgLogin: targetTeam.githubOrg,
                    projectId: created.projectId,
                    repoName: created.repoName,
                    metadataRepoName:
                      created.metadataRecord?.repoName ?? created.remoteProject.name,
                    previousRepoNames: created.metadataRecord?.previousRepoNames ?? [],
                    fullName: created.remoteProject.fullName,
                    repoId: created.remoteProject.repoId ?? null,
                    nodeId: created.remoteProject.nodeId ?? null,
                    defaultBranchName: created.remoteProject.defaultBranchName ?? "main",
                    defaultBranchHeadOid: created.remoteProject.defaultBranchHeadOid ?? null,
                    lifecycleState: created.metadataRecord?.lifecycleState ?? "active",
                    recordState: created.metadataRecord?.recordState ?? "live",
                    remoteState: created.metadataRecord?.remoteState ?? "linked",
                    status: created.remoteProject.status ?? "active",
                    projectTitle: projectName,
                  },
                  glossary: glossary
                    ? { glossaryId: glossary.id, repoName: glossary.repoName }
                    : null,
                },
                sessionToken,
              });
              return waitForProjectTransferStatus(jobId, render, {
                invoke: invokeCommand,
                pollDelayMs: operations.pollDelayMs,
              });
            },
          });
          updateStageIfVisible(jobId, "Publishing project metadata...", render);
          const finalized = await finalizeProjectTransferStatus(transferStatus, {
            invoke: invokeCommand,
            requireBrokerSession: () => sessionToken,
            upsertProjectMetadataRecord: upsertMetadata,
            deleteProjectMetadataRecord: deleteMetadata,
            rollbackCreatedProjectRepo: rollbackRepo,
          });
          if (!finalized?.success) {
            throw finalized?.error ?? new Error("The project transfer failed.");
          }
          return finalized.created;
        } catch (error) {
          if (
            created
            && error?.preserveCreatedProject !== true
            && error?.deferTransferRecovery !== true
            && error?.transferFinalized !== true
            && !statusIsTerminal(
              await invokeCommand("get_gtms_project_transfer_status", {
                input: { jobId },
              }).catch(() => null),
            )
          ) {
            await rollbackRepo(
              targetTeam,
              created,
              error,
              {
                invoke: invokeCommand,
                requireBrokerSession: () => sessionToken,
                rethrowCause: false,
              },
            );
          }
          if (error?.deferTransferRecovery === true) {
            scheduleProjectTransferRecovery(render, {
              invoke: invokeCommand,
              requireBrokerSession: () => sessionToken,
              upsertProjectMetadataRecord: upsertMetadata,
              deleteProjectMetadataRecord: deleteMetadata,
              rollbackCreatedProjectRepo: rollbackRepo,
            });
          }
          throw error;
        } finally {
          activeProjectTransferJobs.delete(jobId);
        }
      },
    });

    const visibleTarget = state.screen === "projects" && ownsProjectsPage(targetTeam);
    let refreshWarning = "";
    if (visibleTarget) {
      try {
        await reloadProjects(render, targetTeam, { suppressRecoveryWarning: true });
        state.selectedProjectId = result.projectId;
      } catch (error) {
        refreshWarning = ` The transfer succeeded, but the project list could not refresh: ${
          formatErrorForDisplay(error)
        }`;
      }
    }
    if (currentTransferMatches(jobId)) {
      resetProjectTransfer();
      render?.();
    }
    showNoticeBadge(
      visibleTarget
        ? `Copied ${transfer.sourceTitle} to ${projectName}.${refreshWarning}`
        : `Transferred ${projectName} to ${targetTeam.name ?? targetTeam.githubOrg}. Open that team to see it.`,
      render,
      3200,
    );
    return true;
  } catch (error) {
    if (currentTransferMatches(jobId)) {
      patchTransfer({
        status: "idle",
        stage: "",
        jobId: "",
        error: formatErrorForDisplay(error),
      }, render);
    } else {
      showNoticeBadge(`Project transfer failed: ${formatErrorForDisplay(error)}`, render, 4200);
    }
    return false;
  }
}

export function handleProjectTransferProgressEvent(payload, render) {
  const jobId = normalizeText(payload?.jobId);
  if (!jobId) {
    return;
  }
  if (payload.status === "progress" || payload.status === "running") {
    updateStageIfVisible(jobId, normalizeText(payload.message), render);
    return;
  }
  if (statusIsTerminal(payload) && !activeProjectTransferJobs.has(jobId)) {
    void recoverPendingProjectTransfers(render);
  }
}

export async function registerProjectTransferListeners(render, operations = {}) {
  if (listenersRegistered) {
    return;
  }
  if (!listenerRegistrationPromise) {
    listenerRegistrationPromise = (async () => {
      const listenForEvent = operations.listen ?? listen;
      await listenForEvent("team-project-transfer-progress", (event) => {
        handleProjectTransferProgressEvent(event?.payload, render);
      });
      listenersRegistered = true;
      void recoverPendingProjectTransfers(render, operations);
    })().finally(() => {
      listenerRegistrationPromise = null;
    });
  }
  await listenerRegistrationPromise;
}

export function __resetProjectTransferJobsForTests() {
  activeProjectTransferJobs.clear();
  finalizingProjectTransferJobs.clear();
  if (recoveryRetryTimer !== null) {
    window.clearTimeout(recoveryRetryTimer);
    recoveryRetryTimer = null;
  }
  listenersRegistered = false;
  listenerRegistrationPromise = null;
}
