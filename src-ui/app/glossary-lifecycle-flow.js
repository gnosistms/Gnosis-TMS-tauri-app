import { invoke, waitForNextPaint } from "./runtime.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import {
  saveStoredGlossaryPendingMutations,
} from "./glossary-cache.js";
import {
  removePendingMutation,
  upsertPendingMutation,
} from "./optimistic-collection.js";
import {
  resetGlossaryPermanentDeletion,
  resetGlossaryRename,
  state,
} from "./state.js";
import { loadTeamGlossaries } from "./glossary-discovery-flow.js";
import {
  canManageGlossaries,
  canPermanentlyDeleteGlossaries,
  selectedTeam,
} from "./glossary-shared.js";
import { showNoticeBadge } from "./status-feedback.js";
import {
  ensureGlossaryNotTombstoned,
  permanentlyDeleteRemoteGlossaryRepoForTeam,
} from "./glossary-repo-flow.js";
import { upsertGlossaryMetadataRecord } from "./team-metadata-flow.js";
import {
  applyGlossaryPendingMutation,
  applyGlossarySnapshotToState,
  glossarySnapshotFromState,
  persistGlossariesForTeam,
  removeGlossaryFromState,
  rollbackVisibleGlossaryMutation,
} from "./glossary-top-level-state.js";
import { processQueuedResourceMutations } from "./resource-top-level-mutations.js";
import { commitMetadataFirstTopLevelMutation } from "./resource-lifecycle-engine.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";

const inflightGlossaryMutationIds = new Set();

function glossaryById(glossaryId) {
  return state.glossaries.find((glossary) => glossary.id === glossaryId) ?? null;
}

function snapshotVisibleGlossaryState() {
  return {
    snapshot: glossarySnapshotFromState(),
    selectedGlossaryId: state.selectedGlossaryId,
    showDeletedGlossaries: state.showDeletedGlossaries,
  };
}

function restoreVisibleGlossaryState(snapshot) {
  applyGlossarySnapshotToState(snapshot?.snapshot ?? { items: [], deletedItems: [] }, {
    fallbackToFirstActive: false,
  });
  state.selectedGlossaryId = snapshot?.selectedGlossaryId ?? null;
  state.showDeletedGlossaries = snapshot?.showDeletedGlossaries === true;
}

function lifecycleActionBlockedMessage(team, { actionLabel, requireOwner = false } = {}) {
  if (!Number.isFinite(team?.installationId)) {
    return "This glossary action requires a GitHub App-connected team.";
  }
  if (state.offline?.isEnabled === true) {
    return `You cannot ${actionLabel} while offline.`;
  }
  if (requireOwner ? !canPermanentlyDeleteGlossaries(team) : !canManageGlossaries(team)) {
    return `You do not have permission to ${actionLabel} in this team.`;
  }
  return "";
}

function glossaryMetadataRecord(glossary, overrides = {}) {
  return {
    glossaryId: glossary.id,
    title: overrides.title ?? glossary.title,
    repoName: overrides.repoName ?? glossary.repoName,
    githubRepoId:
      Number.isFinite(overrides.githubRepoId)
        ? overrides.githubRepoId
        : Number.isFinite(glossary.repoId)
          ? glossary.repoId
          : null,
    githubNodeId:
      typeof overrides.githubNodeId === "string" && overrides.githubNodeId.trim()
        ? overrides.githubNodeId.trim()
        : typeof glossary.nodeId === "string" && glossary.nodeId.trim()
          ? glossary.nodeId.trim()
        : null,
    fullName:
      typeof overrides.fullName === "string" && overrides.fullName.trim()
        ? overrides.fullName.trim()
        : typeof glossary.fullName === "string" && glossary.fullName.trim()
          ? glossary.fullName.trim()
        : null,
    defaultBranch:
      typeof overrides.defaultBranch === "string" && overrides.defaultBranch.trim()
        ? overrides.defaultBranch.trim()
        : typeof glossary.defaultBranchName === "string" && glossary.defaultBranchName.trim()
          ? glossary.defaultBranchName.trim()
        : "main",
    lifecycleState:
      overrides.lifecycleState
      ?? (glossary.lifecycleState === "deleted" ? "softDeleted" : "active"),
    remoteState: overrides.remoteState ?? glossary.remoteState ?? "linked",
    recordState: overrides.recordState ?? glossary.recordState ?? "live",
    deletedAt: overrides.deletedAt ?? glossary.deletedAt ?? null,
    sourceLanguage: overrides.sourceLanguage ?? glossary.sourceLanguage ?? null,
    targetLanguage: overrides.targetLanguage ?? glossary.targetLanguage ?? null,
    termCount:
      Number.isFinite(overrides.termCount)
        ? overrides.termCount
        : Number.isFinite(glossary.termCount)
          ? glossary.termCount
          : 0,
  };
}

async function commitGlossaryMutation(team, mutation) {
  const glossary = glossaryById(mutation.glossaryId ?? mutation.resourceId);

  if (!Number.isFinite(team?.installationId) || !glossary) {
    return;
  }

  await commitMetadataFirstTopLevelMutation({
    mutation,
    resource: glossary,
    resourceLabel: "glossary",
    writeMetadata: (record) => upsertGlossaryMetadataRecord(team, record),
    buildRecord: (currentGlossary, overrides = {}) =>
      glossaryMetadataRecord(currentGlossary, overrides),
    applyLocalMutation: (currentGlossary, currentMutation) => {
      if (currentMutation.type === "rename") {
        return invoke("rename_gtms_glossary", {
          input: {
            installationId: team.installationId,
            glossaryId: currentGlossary.id,
            repoName: currentGlossary.repoName,
            title: currentMutation.title,
          },
        });
      }

      if (currentMutation.type === "softDelete") {
        return invoke("soft_delete_gtms_glossary", {
          input: {
            installationId: team.installationId,
            glossaryId: currentGlossary.id,
            repoName: currentGlossary.repoName,
          },
        });
      }

      if (currentMutation.type === "restore") {
        return invoke("restore_gtms_glossary", {
          input: {
            installationId: team.installationId,
            glossaryId: currentGlossary.id,
            repoName: currentGlossary.repoName,
          },
        });
      }

      return Promise.resolve();
    },
  });
}

export async function processPendingGlossaryMutations(render, team = selectedTeam()) {
  await processQueuedResourceMutations({
    getPendingMutations: () => state.pendingGlossaryMutations,
    inflightMutationIds: inflightGlossaryMutationIds,
    waitForNextPaint,
    commitMutation: (mutation) => commitGlossaryMutation(team, mutation),
    setPendingMutations: (mutations) => {
      state.pendingGlossaryMutations = mutations;
    },
    persistPendingMutations: (mutations) => saveStoredGlossaryPendingMutations(team, mutations),
    persistVisibleState: () => persistGlossariesForTeam(team),
    rollbackVisibleMutation: rollbackVisibleGlossaryMutation,
    onMutationError: async (_mutation, error) => {
      if (
        await handleSyncFailure(classifySyncError(error), {
          render,
          teamId: team?.id ?? null,
          currentResource: true,
        })
      ) {
        failPageSync();
        return true;
      }

      showNoticeBadge(error?.message ?? String(error), render);
      await loadTeamGlossaries(render, team?.id, { preserveVisibleData: true });
      return true;
    },
    onQueueComplete: async () => {
      await completePageSync(render);
      render();
    },
  });
}

export function toggleDeletedGlossaries(render) {
  state.showDeletedGlossaries = !state.showDeletedGlossaries;
  render();
}

export function openGlossaryRename(render, glossaryId) {
  const glossary = glossaryById(glossaryId);
  const team = selectedTeam();
  const blockedMessage = lifecycleActionBlockedMessage(team, { actionLabel: "rename glossaries" });

  if (!glossary || glossary.lifecycleState === "deleted") {
    showNoticeBadge("Could not find the selected glossary.", render);
    return;
  }
  if (blockedMessage) {
    showNoticeBadge(blockedMessage, render);
    return;
  }
  void ensureGlossaryNotTombstoned(render, team, glossary).then((blocked) => {
    if (blocked) {
      return;
    }

    state.glossaryRename = {
      isOpen: true,
      status: "idle",
      error: "",
      glossaryId,
      glossaryName: glossary.title,
    };
    render();
  });
}

export function updateGlossaryRenameName(value) {
  state.glossaryRename.glossaryName = value;
  if (state.glossaryRename.error) {
    state.glossaryRename.error = "";
  }
}

export function cancelGlossaryRename(render) {
  resetGlossaryRename();
  render();
}

export async function submitGlossaryRename(render) {
  const team = selectedTeam();
  const glossary = glossaryById(state.glossaryRename.glossaryId);
  const nextTitle = String(state.glossaryRename.glossaryName ?? "").trim();
  const blockedMessage = lifecycleActionBlockedMessage(team, { actionLabel: "rename glossaries" });

  if (!glossary) {
    state.glossaryRename.error = "Could not find the selected glossary.";
    render();
    return;
  }
  if (blockedMessage) {
    state.glossaryRename.error = blockedMessage;
    render();
    return;
  }
  if (!nextTitle) {
    state.glossaryRename.error = "Enter a glossary name.";
    render();
    return;
  }
  if (await ensureGlossaryNotTombstoned(render, team, glossary)) {
    resetGlossaryRename();
    render();
    return;
  }

  state.glossaryRename.status = "loading";
  state.glossaryRename.error = "";
  render();
  state.glossarySyncVersion += 1;

  try {
    const mutation = {
      id: crypto.randomUUID(),
      type: "rename",
      resourceId: glossary.id,
      glossaryId: glossary.id,
      title: nextTitle,
      previousTitle: glossary.title,
    };
    const snapshot = applyGlossaryPendingMutation(glossarySnapshotFromState(), mutation);
    applyGlossarySnapshotToState(snapshot, { fallbackToFirstActive: false });
    beginPageSync();
    state.pendingGlossaryMutations = upsertPendingMutation(state.pendingGlossaryMutations, mutation);
    persistGlossariesForTeam(team);
    saveStoredGlossaryPendingMutations(team, state.pendingGlossaryMutations);
    resetGlossaryRename();
    render();
    void processPendingGlossaryMutations(render, team);
  } catch (error) {
    if (await handleSyncFailure(classifySyncError(error), { render })) {
      return;
    }
    state.glossaryRename.status = "idle";
    state.glossaryRename.error = error?.message ?? String(error);
    render();
  }
}

export async function deleteGlossary(render, glossaryId) {
  const team = selectedTeam();
  const glossary = glossaryById(glossaryId);
  const blockedMessage = lifecycleActionBlockedMessage(team, { actionLabel: "delete glossaries" });

  if (!glossary || glossary.lifecycleState === "deleted") {
    showNoticeBadge("Could not find the selected glossary.", render);
    return;
  }
  if (blockedMessage) {
    showNoticeBadge(blockedMessage, render);
    return;
  }
  if (await ensureGlossaryNotTombstoned(render, team, glossary)) {
    return;
  }

  state.glossarySyncVersion += 1;
  const mutation = {
    id: crypto.randomUUID(),
    type: "softDelete",
    resourceId: glossary.id,
    glossaryId: glossary.id,
  };
  applyGlossarySnapshotToState(
    applyGlossaryPendingMutation(glossarySnapshotFromState(), mutation),
    { fallbackToFirstActive: false },
  );
  beginPageSync();
  state.pendingGlossaryMutations = upsertPendingMutation(state.pendingGlossaryMutations, mutation);
  persistGlossariesForTeam(team);
  saveStoredGlossaryPendingMutations(team, state.pendingGlossaryMutations);
  render();
  void waitForNextPaint().then(() => processPendingGlossaryMutations(render, team));
}

export async function restoreGlossary(render, glossaryId) {
  const team = selectedTeam();
  const glossary = glossaryById(glossaryId);
  const blockedMessage = lifecycleActionBlockedMessage(team, { actionLabel: "restore glossaries" });

  if (!glossary || glossary.lifecycleState !== "deleted") {
    showNoticeBadge("Could not find the selected deleted glossary.", render);
    return;
  }
  if (blockedMessage) {
    showNoticeBadge(blockedMessage, render);
    return;
  }
  if (await ensureGlossaryNotTombstoned(render, team, glossary)) {
    return;
  }

  state.glossarySyncVersion += 1;
  const mutation = {
    id: crypto.randomUUID(),
    type: "restore",
    resourceId: glossary.id,
    glossaryId: glossary.id,
  };
  applyGlossarySnapshotToState(
    applyGlossaryPendingMutation(glossarySnapshotFromState(), mutation),
    { fallbackToFirstActive: false },
  );
  beginPageSync();
  state.pendingGlossaryMutations = upsertPendingMutation(state.pendingGlossaryMutations, mutation);
  persistGlossariesForTeam(team);
  saveStoredGlossaryPendingMutations(team, state.pendingGlossaryMutations);
  render();
  void waitForNextPaint().then(() => processPendingGlossaryMutations(render, team));
}

export function openGlossaryPermanentDeletion(render, glossaryId) {
  const glossary = glossaryById(glossaryId);
  const team = selectedTeam();
  const blockedMessage = lifecycleActionBlockedMessage(team, {
    actionLabel: "permanently delete glossaries",
    requireOwner: true,
  });

  if (!glossary || glossary.lifecycleState !== "deleted") {
    showNoticeBadge("Could not find the selected deleted glossary.", render);
    return;
  }
  if (blockedMessage) {
    showNoticeBadge(blockedMessage, render);
    return;
  }
  void ensureGlossaryNotTombstoned(render, team, glossary).then((blocked) => {
    if (blocked) {
      return;
    }

    state.glossaryPermanentDeletion = {
      isOpen: true,
      status: "idle",
      error: "",
      glossaryId,
      glossaryName: glossary.title,
      confirmationText: "",
    };
    render();
  });
}

export function updateGlossaryPermanentDeletionConfirmation(value) {
  state.glossaryPermanentDeletion.confirmationText = value;
  if (state.glossaryPermanentDeletion.error) {
    state.glossaryPermanentDeletion.error = "";
  }
}

export function cancelGlossaryPermanentDeletion(render) {
  resetGlossaryPermanentDeletion();
  render();
}

export async function confirmGlossaryPermanentDeletion(render) {
  const team = selectedTeam();
  const glossary = glossaryById(state.glossaryPermanentDeletion.glossaryId);
  const confirmationText = String(state.glossaryPermanentDeletion.confirmationText ?? "");
  const blockedMessage = lifecycleActionBlockedMessage(team, {
    actionLabel: "permanently delete glossaries",
    requireOwner: true,
  });

  if (!glossary) {
    state.glossaryPermanentDeletion.error = "Could not find the selected glossary.";
    render();
    return;
  }
  if (blockedMessage) {
    state.glossaryPermanentDeletion.error = blockedMessage;
    render();
    return;
  }
  if (confirmationText !== state.glossaryPermanentDeletion.glossaryName) {
    state.glossaryPermanentDeletion.error = "Enter the glossary name exactly to delete it.";
    render();
    return;
  }
  if (await ensureGlossaryNotTombstoned(render, team, glossary)) {
    resetGlossaryPermanentDeletion();
    render();
    return;
  }

  state.glossaryPermanentDeletion.status = "loading";
  state.glossaryPermanentDeletion.error = "";
  render();
  await waitForNextPaint();
  state.glossarySyncVersion += 1;
  const snapshot = snapshotVisibleGlossaryState();
  removeGlossaryFromState(glossary.id, glossary.repoName);
  persistGlossariesForTeam(team);
  if (state.selectedGlossaryId === glossary.id) {
    state.selectedGlossaryId = null;
  }
  resetGlossaryPermanentDeletion();
  render();

  void (async () => {
    let tombstoneCommitted = false;
    try {
      await upsertGlossaryMetadataRecord(team, glossaryMetadataRecord(glossary, {
        lifecycleState: "softDeleted",
        remoteState: "deleted",
        recordState: "tombstone",
        deletedAt: new Date().toISOString(),
      }));
      tombstoneCommitted = true;
      await invoke("purge_local_gtms_glossary_repo", {
        input: {
          installationId: team.installationId,
          glossaryId: glossary.id,
          repoName: glossary.repoName,
        },
      });
      try {
        await permanentlyDeleteRemoteGlossaryRepoForTeam(team, glossary.repoName);
      } catch (error) {
        showNoticeBadge(
          `Glossary deletion was committed locally, but remote cleanup still needs attention: ${
            error?.message ?? String(error)
          }`,
          render,
          4200,
        );
        render();
        return;
      }
      await loadTeamGlossaries(render, team.id, { preserveVisibleData: true });
    } catch (error) {
      if (!tombstoneCommitted) {
        restoreVisibleGlossaryState(snapshot);
        persistGlossariesForTeam(team);
        state.glossaryPermanentDeletion = {
          isOpen: true,
          status: "idle",
          error: error?.message ?? String(error),
          glossaryId: glossary.id,
          glossaryName: glossary.title,
          confirmationText,
        };
      } else {
        showNoticeBadge(
          `Glossary deletion was committed locally, but local cleanup still needs attention: ${error?.message ?? String(error)}`,
          render,
          4200,
        );
      }
      render();
    }
  })();
}
