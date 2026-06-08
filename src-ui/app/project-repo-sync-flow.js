import { invoke } from "./runtime.js";
import { state } from "./state.js";
import {
  clearScopedSyncBadge,
  showNoticeBadge,
  showScopedSyncBadge,
} from "./status-feedback.js";
import { requireBrokerSession } from "./auth-flow.js";
import {
  buildProjectRepoSyncInput,
  PROJECT_REPO_SYNC_STATUS_IMPORTED_EDITOR_CONFLICTS,
  PROJECT_REPO_SYNC_STATUS_UNRESOLVED_CONFLICT,
  PROJECT_REPO_SYNC_STATUS_UPDATE_REQUIRED,
} from "./project-repo-sync-shared.js";
import { requireAppUpdate } from "./updater-flow.js";
import {
  enqueueRepoWrite,
  getRepoWriteQueueSnapshot,
  projectRepoScope,
  subscribeRepoWriteQueue,
} from "./repo-write-queue.js";

const PROJECT_REPO_SYNC_POLL_DELAY_MS = 1400;
const PROJECT_REPO_SYNC_MAX_POLL_MS = 180_000;
const PROJECT_REPO_SYNC_NO_PROGRESS_POLLS = 8;
const PROJECT_REPO_SYNC_KIND = "projectRepoSync";
const LOCAL_REPO_WRITE_OPERATION_TYPES = new Set(["localEditorWrite", "localMetadataWrite"]);

let projectRepoSyncNow = () => Date.now();
let projectRepoSyncDelay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

function delay(ms) {
  return projectRepoSyncDelay(ms);
}

function applyProjectRepoSyncSnapshots(snapshots) {
  state.projectRepoSyncByProjectId = Object.fromEntries(
    (snapshots || []).map((snapshot) => [snapshot.projectId, snapshot]),
  );
}

function mergeProjectRepoSyncSnapshots(snapshots) {
  state.projectRepoSyncByProjectId = {
    ...(state.projectRepoSyncByProjectId ?? {}),
    ...Object.fromEntries(
      (snapshots || []).map((snapshot) => [snapshot.projectId, snapshot]),
    ),
  };
}

function summarizeSnapshots(snapshots = []) {
  const summary = {
    syncing: 0,
    cloning: 0,
    issues: 0,
    dirty: 0,
    notCloned: 0,
    syncErrors: 0,
    stalled: 0,
  };

  for (const snapshot of snapshots) {
    if (snapshot?.status === "syncing") {
      summary.syncing += 1;
      if (String(snapshot?.message || "").toLowerCase().includes("cloning")) {
        summary.cloning += 1;
      }
      continue;
    }

    if (snapshot?.status === "dirtyLocal") {
      summary.issues += 1;
      summary.dirty += 1;
      continue;
    }

    if (snapshot?.status === "notCloned") {
      summary.issues += 1;
      summary.notCloned += 1;
      continue;
    }

    if (
      snapshot?.status === "syncError"
      || snapshot?.status === "missingRemoteHead"
      || snapshot?.status === "syncStalled"
      || snapshot?.syncStalled === true
      || snapshot?.status === PROJECT_REPO_SYNC_STATUS_UNRESOLVED_CONFLICT
      || snapshot?.status === PROJECT_REPO_SYNC_STATUS_IMPORTED_EDITOR_CONFLICTS
      || snapshot?.status === PROJECT_REPO_SYNC_STATUS_UPDATE_REQUIRED
    ) {
      summary.issues += 1;
      summary.syncErrors += 1;
      if (snapshot?.status === "syncStalled" || snapshot?.syncStalled === true) {
        summary.stalled += 1;
      }
    }
  }

  return summary;
}

function syncingBadgeText(snapshots) {
  const summary = summarizeSnapshots(snapshots);
  const syncingOnly = Math.max(0, summary.syncing - summary.cloning);

  if (summary.cloning > 0 && syncingOnly > 0) {
    return `Cloning ${summary.cloning} repos and syncing ${syncingOnly} repos...`;
  }

  if (summary.cloning > 0) {
    return `Cloning ${summary.cloning} repo${summary.cloning === 1 ? "" : "s"}...`;
  }

  if (summary.syncing > 0) {
    return `Syncing ${summary.syncing} repo${summary.syncing === 1 ? "" : "s"}...`;
  }

  return "Checking local repos...";
}

function issueNoticeText(snapshots) {
  const summary = summarizeSnapshots(snapshots);
  if (summary.issues === 0) {
    return "";
  }

  if (summary.dirty > 0 && summary.syncErrors === 0 && summary.notCloned === 0) {
    return `${summary.dirty} repo${summary.dirty === 1 ? " has" : "s have"} local changes and could not be auto-synced`;
  }
  if (summary.stalled > 0 && summary.stalled === summary.issues) {
    return `${summary.stalled} project repo sync ${summary.stalled === 1 ? "is" : "are"} taking longer than expected; try refreshing again`;
  }

  return `${summary.issues} project repo${summary.issues === 1 ? " needs" : "s need"} attention`;
}

function hasSyncingRepos(snapshots) {
  return (snapshots || []).some((snapshot) => snapshot?.status === "syncing");
}

function projectRepoSyncScope(team, descriptor) {
  return projectRepoScope({
    team,
    projectId: descriptor?.projectId,
    repoName: descriptor?.repoName,
  });
}

function queuedSyncBadgeText(waitingSummary, totalCount) {
  const localWaitingCount = waitingSummary?.local ?? 0;
  const repoOperationWaitingCount = waitingSummary?.repoOperation ?? 0;
  const overdueCount = waitingSummary?.overdue ?? 0;
  const overdueSuffix = overdueCount > 0 ? " (taking longer than expected)" : "";

  if (localWaitingCount <= 0 && repoOperationWaitingCount <= 0) {
    return "Checking local repos...";
  }
  if (localWaitingCount > 0 && repoOperationWaitingCount <= 0) {
    if (localWaitingCount === totalCount) {
      return `Waiting for local saves in ${localWaitingCount} project repo${localWaitingCount === 1 ? "" : "s"}...${overdueSuffix}`;
    }
    return `Checking ${totalCount} project repos; waiting for local saves in ${localWaitingCount}...${overdueSuffix}`;
  }
  if (localWaitingCount <= 0) {
    if (repoOperationWaitingCount === totalCount) {
      return `Waiting for project repo operation in ${repoOperationWaitingCount} project repo${repoOperationWaitingCount === 1 ? "" : "s"}...${overdueSuffix}`;
    }
    return `Checking ${totalCount} project repos; waiting for project repo operation in ${repoOperationWaitingCount}...${overdueSuffix}`;
  }
  return `Checking ${totalCount} project repos; waiting for local saves in ${localWaitingCount} and project repo operation in ${repoOperationWaitingCount}...${overdueSuffix}`;
}

function waitingSummaryForProjectSync(team, projects) {
  return projects.reduce((summary, project) => {
    const snapshot = getRepoWriteQueueSnapshot(projectRepoSyncScope(team, project));
    // Only count work that is *blocking* sync. Exclude this reconcile's own
    // projectRepoSync operations, otherwise the badge would report the sync we just
    // started as something we are waiting on.
    const blockingOperations = snapshot.operations.filter(
      (operation) => operation.kind !== PROJECT_REPO_SYNC_KIND,
    );
    if (blockingOperations.length === 0) {
      return summary;
    }
    if (blockingOperations.some((operation) => operation.overdue)) {
      summary.overdue += 1;
    }
    const hasLocalWrites = blockingOperations.some((operation) =>
      LOCAL_REPO_WRITE_OPERATION_TYPES.has(operation.operationType),
    );
    if (hasLocalWrites) {
      summary.local += 1;
    } else {
      summary.repoOperation += 1;
    }
    return summary;
  }, { local: 0, repoOperation: 0, overdue: 0 });
}

function projectRepoSyncSignature(snapshots) {
  // Key the no-progress detector on the fields that change as a sync genuinely
  // advances (head OIDs move, message/status update). Pinning an explicit allowlist
  // keeps the detector robust if a volatile field (e.g. a timestamp) is ever added to
  // the snapshot shape, which would otherwise make every poll look like progress.
  const list = Array.isArray(snapshots) ? snapshots : [];
  return JSON.stringify(
    list.map((snapshot) => [
      snapshot?.projectId ?? "",
      snapshot?.status ?? "",
      snapshot?.message ?? "",
      snapshot?.localHeadOid ?? "",
      snapshot?.remoteHeadOid ?? "",
    ]),
  );
}

function markProjectRepoSyncStalled(snapshots, descriptor, reason) {
  const list = Array.isArray(snapshots) && snapshots.length > 0
    ? snapshots
    : [{
      projectId: descriptor?.projectId ?? "",
      repoName: descriptor?.repoName ?? "",
      status: "syncing",
    }];
  return list.map((snapshot) => {
    const projectId = snapshot?.projectId ?? descriptor?.projectId;
    const repoName = snapshot?.repoName ?? descriptor?.repoName;
    const isDescriptor =
      projectId === descriptor?.projectId
      || (repoName && repoName === descriptor?.repoName);
    if (!isDescriptor && list.length !== 1) {
      return snapshot;
    }
    return {
      ...snapshot,
      projectId,
      repoName,
      status: "syncStalled",
      syncStalled: true,
      stallReason: reason,
      message: "Project repo sync is taking longer than expected. Try refreshing again.",
    };
  });
}

async function reconcileOneProjectRepoSyncState({
  render,
  team,
  installationId,
  descriptor,
  shouldAbort,
  onSnapshots,
  mergeSnapshots = mergeProjectRepoSyncSnapshots,
}) {
  const scope = projectRepoSyncScope(team, descriptor);
  const input = {
    installationId,
    projects: [descriptor],
  };

  return enqueueRepoWrite({
    scope,
    kind: PROJECT_REPO_SYNC_KIND,
    sourceScreen: "projects",
    errorTarget: {
      projectId: descriptor.projectId,
      kind: PROJECT_REPO_SYNC_KIND,
    },
    metadata: {
      projectId: descriptor.projectId,
      repoName: descriptor.repoName,
    },
    run: async () => {
      if (shouldAbort?.()) {
        return [];
      }

      const initialSnapshots = await invoke("reconcile_project_repo_sync_states", {
        input,
        sessionToken: requireBrokerSession(),
      });
      if (shouldAbort?.()) {
        return Array.isArray(initialSnapshots) ? initialSnapshots : [];
      }

      mergeSnapshots(initialSnapshots);
      onSnapshots?.(initialSnapshots, descriptor);
      openRequiredAppUpdatePromptFromProjectSnapshots(initialSnapshots, render);
      showScopedSyncBadge("projects", syncingBadgeText(initialSnapshots), render);
      render();

      let snapshots = initialSnapshots;
      const pollingStartedAt = projectRepoSyncNow();
      let previousSignature = projectRepoSyncSignature(snapshots);
      let noProgressPolls = 0;
      while (hasSyncingRepos(snapshots)) {
        await delay(PROJECT_REPO_SYNC_POLL_DELAY_MS);
        if (shouldAbort?.() || state.selectedTeamId !== team.id) {
          return Array.isArray(snapshots) ? snapshots : [];
        }
        snapshots = await invoke("list_project_repo_sync_states", { input });
        if (shouldAbort?.()) {
          return Array.isArray(snapshots) ? snapshots : [];
        }
        const signature = projectRepoSyncSignature(snapshots);
        noProgressPolls = signature === previousSignature ? noProgressPolls + 1 : 0;
        previousSignature = signature;
        const elapsedMs = Math.max(0, projectRepoSyncNow() - pollingStartedAt);
        if (
          elapsedMs >= PROJECT_REPO_SYNC_MAX_POLL_MS
          || noProgressPolls >= PROJECT_REPO_SYNC_NO_PROGRESS_POLLS
        ) {
          snapshots = markProjectRepoSyncStalled(
            snapshots,
            descriptor,
            elapsedMs >= PROJECT_REPO_SYNC_MAX_POLL_MS ? "maxDuration" : "noProgress",
          );
          mergeSnapshots(snapshots);
          onSnapshots?.(snapshots, descriptor);
          openRequiredAppUpdatePromptFromProjectSnapshots(snapshots, render);
          showScopedSyncBadge("projects", "Project repo sync is taking longer than expected.", render);
          render();
          break;
        }
        mergeSnapshots(snapshots);
        onSnapshots?.(snapshots, descriptor);
        openRequiredAppUpdatePromptFromProjectSnapshots(snapshots, render);
        showScopedSyncBadge("projects", syncingBadgeText(snapshots), render);
        render();
      }

      return Array.isArray(snapshots) ? snapshots : [];
    },
  });
}

function openRequiredAppUpdatePromptFromProjectSnapshots(snapshots, render) {
  const requiredSnapshot = (Array.isArray(snapshots) ? snapshots : []).find(
    (snapshot) => snapshot?.status === PROJECT_REPO_SYNC_STATUS_UPDATE_REQUIRED,
  );
  if (!requiredSnapshot) {
    return false;
  }

  return requireAppUpdate(
    {
      requiredVersion: requiredSnapshot.requiredAppVersion ?? null,
      currentVersion: requiredSnapshot.currentAppVersion ?? null,
      message: requiredSnapshot.message ?? "",
    },
    render,
  );
}

export async function reconcileProjectRepoSyncStates(render, team, projects, options = {}) {
  const shouldAbort = typeof options.shouldAbort === "function" ? options.shouldAbort : null;
  const clearStatusOnComplete = options.clearStatusOnComplete !== false;
  const onSnapshots = typeof options.onSnapshots === "function" ? options.onSnapshots : null;
  const applySnapshots =
    typeof options.applySnapshots === "function"
      ? options.applySnapshots
      : applyProjectRepoSyncSnapshots;
  const mergeSnapshots =
    typeof options.mergeSnapshots === "function"
      ? options.mergeSnapshots
      : mergeProjectRepoSyncSnapshots;

  if (shouldAbort?.()) {
    return [];
  }

  if (
    state.offline?.isEnabled === true ||
    !Number.isFinite(team?.installationId) ||
    !Array.isArray(projects) ||
    projects.length === 0
  ) {
    applySnapshots([]);
    if (clearStatusOnComplete) {
      clearScopedSyncBadge("projects", render);
    }
    render();
    return;
  }

  const input = buildProjectRepoSyncInput(team, projects);
  if (input.projects.length === 0) {
    applySnapshots([]);
    if (clearStatusOnComplete) {
      clearScopedSyncBadge("projects", render);
    }
    render();
    return;
  }
  const updateQueuedSyncBadge = () => {
    showScopedSyncBadge(
      "projects",
      queuedSyncBadgeText(waitingSummaryForProjectSync(team, input.projects), input.projects.length),
      render,
    );
  };
  updateQueuedSyncBadge();

  let snapshotResults = [];
  const unsubscribeRepoQueue = subscribeRepoWriteQueue(updateQueuedSyncBadge);
  try {
    snapshotResults = await Promise.all(
      input.projects.map((descriptor) =>
        reconcileOneProjectRepoSyncState({
          render,
          team,
          installationId: input.installationId,
          descriptor,
          shouldAbort,
          onSnapshots,
          mergeSnapshots,
        })),
    );
  } finally {
    unsubscribeRepoQueue();
  }
  const snapshots = snapshotResults.flat();

  if (shouldAbort?.()) {
    return Array.isArray(snapshots) ? snapshots : [];
  }
  applySnapshots(snapshots);
  if (clearStatusOnComplete) {
    clearScopedSyncBadge("projects", render);
  }
  openRequiredAppUpdatePromptFromProjectSnapshots(snapshots, render);
  const issueText = issueNoticeText(snapshots);
  if (issueText) {
    showNoticeBadge(issueText, render, 2400);
  } else {
    render();
  }

  return Array.isArray(snapshots) ? snapshots : [];
}

export function __setProjectRepoSyncTiming(options = {}) {
  projectRepoSyncNow = typeof options.now === "function" ? options.now : (() => Date.now());
  projectRepoSyncDelay = typeof options.delay === "function"
    ? options.delay
    : ((ms) => new Promise((resolve) => window.setTimeout(resolve, ms)));
}
