import { invoke, waitForNextPaint } from "./runtime.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import {
  saveStoredGlossaryPendingMutations,
} from "./glossary-cache.js";
import { removePendingMutation } from "./optimistic-collection.js";
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
import {
  processQueuedResourceMutations,
  queueTopLevelResourceMutation,
  submitTopLevelResourceMutation,
} from "./resource-top-level-mutations.js";
import {
  commitMetadataFirstTopLevelMutation,
  guardTopLevelResourceAction,
  runPermanentDeleteLocalFirst,
} from "./resource-lifecycle-engine.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";
import {
  beginEntityModalSubmit,
  cancelEntityModal,
  entityConfirmationMatches,
  openEntityConfirmationModal,
  openEntityRenameModal,
  updateEntityModalConfirmation,
  updateEntityModalName,
} from "./resource-entity-modal.js";

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
  void guardTopLevelResourceAction({
    resource: glossary,
    isExpectedResource: (currentGlossary) =>
      Boolean(currentGlossary) && currentGlossary.lifecycleState !== "deleted",
    getBlockedMessage: () =>
      lifecycleActionBlockedMessage(team, { actionLabel: "rename glossaries" }),
    ensureNotTombstoned: (currentGlossary) =>
      ensureGlossaryNotTombstoned(render, team, currentGlossary),
    onMissing: () => {
      showNoticeBadge("Could not find the selected glossary.", render);
    },
    onBlocked: (blockedMessage) => {
      showNoticeBadge(blockedMessage, render);
    },
  }).then((allowed) => {
    if (!allowed) {
      return;
    }

    openEntityRenameModal({
      setState: (nextState) => {
        state.glossaryRename = nextState;
      },
      entityId: glossaryId,
      idField: "glossaryId",
      nameField: "glossaryName",
      currentName: glossary.title,
    });
    render();
  });
}

export function updateGlossaryRenameName(value) {
  updateEntityModalName(state.glossaryRename, "glossaryName", value);
}

export function cancelGlossaryRename(render) {
  cancelEntityModal(resetGlossaryRename, render);
}

export async function submitGlossaryRename(render) {
  const team = selectedTeam();
  const glossary = glossaryById(state.glossaryRename.glossaryId);
  const nextTitle = String(state.glossaryRename.glossaryName ?? "").trim();
  const allowed = await guardTopLevelResourceAction({
    resource: glossary,
    getBlockedMessage: () =>
      lifecycleActionBlockedMessage(team, { actionLabel: "rename glossaries" }),
    ensureNotTombstoned: (currentGlossary) =>
      ensureGlossaryNotTombstoned(render, team, currentGlossary),
    onMissing: () => {
      state.glossaryRename.error = "Could not find the selected glossary.";
      render();
    },
    onBlocked: (blockedMessage) => {
      state.glossaryRename.error = blockedMessage;
      render();
    },
    onTombstoned: () => {
      resetGlossaryRename();
      render();
    },
  });
  if (!allowed) {
    return;
  }
  if (!nextTitle) {
    state.glossaryRename.error = "Enter a glossary name.";
    render();
    return;
  }

  state.glossarySyncVersion += 1;
  await submitTopLevelResourceMutation({
    setLoading: () => {
      state.glossaryRename.status = "loading";
      state.glossaryRename.error = "";
      render();
    },
    buildMutation: () => ({
      id: crypto.randomUUID(),
      type: "rename",
      resourceId: glossary.id,
      glossaryId: glossary.id,
      title: nextTitle,
      previousTitle: glossary.title,
    }),
    queueMutation: (mutation) => {
      queueTopLevelResourceMutation({
        mutation,
        currentSnapshot: () => glossarySnapshotFromState(),
        applyMutation: (snapshot, nextMutation) =>
          applyGlossaryPendingMutation(snapshot, nextMutation),
        applySnapshot: (snapshot) =>
          applyGlossarySnapshotToState(snapshot, { fallbackToFirstActive: false }),
        beginSync: () => beginPageSync(),
        getPendingMutations: () => state.pendingGlossaryMutations,
        setPendingMutations: (mutations) => {
          state.pendingGlossaryMutations = mutations;
        },
        persistPendingMutations: (mutations) =>
          saveStoredGlossaryPendingMutations(team, mutations),
        persistVisibleState: () => persistGlossariesForTeam(team),
        render,
      });
    },
    afterQueue: () => {
      resetGlossaryRename();
      render();
    },
    processQueue: () => processPendingGlossaryMutations(render, team),
    onError: async (error) => {
      if (await handleSyncFailure(classifySyncError(error), { render })) {
        return;
      }
      state.glossaryRename.status = "idle";
      state.glossaryRename.error = error?.message ?? String(error);
      render();
    },
  });
}

export async function deleteGlossary(render, glossaryId) {
  const team = selectedTeam();
  const glossary = glossaryById(glossaryId);
  const allowed = await guardTopLevelResourceAction({
    resource: glossary,
    isExpectedResource: (currentGlossary) =>
      Boolean(currentGlossary) && currentGlossary.lifecycleState !== "deleted",
    getBlockedMessage: () =>
      lifecycleActionBlockedMessage(team, { actionLabel: "delete glossaries" }),
    ensureNotTombstoned: (currentGlossary) =>
      ensureGlossaryNotTombstoned(render, team, currentGlossary),
    onMissing: () => {
      showNoticeBadge("Could not find the selected glossary.", render);
    },
    onBlocked: (blockedMessage) => {
      showNoticeBadge(blockedMessage, render);
    },
  });
  if (!allowed) {
    return;
  }

  state.glossarySyncVersion += 1;
  await submitTopLevelResourceMutation({
    buildMutation: () => ({
      id: crypto.randomUUID(),
      type: "softDelete",
      resourceId: glossary.id,
      glossaryId: glossary.id,
    }),
    queueMutation: (mutation) => {
      queueTopLevelResourceMutation({
        mutation,
        currentSnapshot: () => glossarySnapshotFromState(),
        applyMutation: (snapshot, nextMutation) =>
          applyGlossaryPendingMutation(snapshot, nextMutation),
        applySnapshot: (snapshot) =>
          applyGlossarySnapshotToState(snapshot, { fallbackToFirstActive: false }),
        beginSync: () => beginPageSync(),
        getPendingMutations: () => state.pendingGlossaryMutations,
        setPendingMutations: (mutations) => {
          state.pendingGlossaryMutations = mutations;
        },
        persistPendingMutations: (mutations) =>
          saveStoredGlossaryPendingMutations(team, mutations),
        persistVisibleState: () => persistGlossariesForTeam(team),
        render,
      });
    },
    processQueue: () => processPendingGlossaryMutations(render, team),
    waitForProcessing: waitForNextPaint,
  });
}

export async function restoreGlossary(render, glossaryId) {
  const team = selectedTeam();
  const glossary = glossaryById(glossaryId);
  const allowed = await guardTopLevelResourceAction({
    resource: glossary,
    isExpectedResource: (currentGlossary) =>
      Boolean(currentGlossary) && currentGlossary.lifecycleState === "deleted",
    getBlockedMessage: () =>
      lifecycleActionBlockedMessage(team, { actionLabel: "restore glossaries" }),
    ensureNotTombstoned: (currentGlossary) =>
      ensureGlossaryNotTombstoned(render, team, currentGlossary),
    onMissing: () => {
      showNoticeBadge("Could not find the selected deleted glossary.", render);
    },
    onBlocked: (blockedMessage) => {
      showNoticeBadge(blockedMessage, render);
    },
  });
  if (!allowed) {
    return;
  }

  state.glossarySyncVersion += 1;
  await submitTopLevelResourceMutation({
    buildMutation: () => ({
      id: crypto.randomUUID(),
      type: "restore",
      resourceId: glossary.id,
      glossaryId: glossary.id,
    }),
    queueMutation: (mutation) => {
      queueTopLevelResourceMutation({
        mutation,
        currentSnapshot: () => glossarySnapshotFromState(),
        applyMutation: (snapshot, nextMutation) =>
          applyGlossaryPendingMutation(snapshot, nextMutation),
        applySnapshot: (snapshot) =>
          applyGlossarySnapshotToState(snapshot, { fallbackToFirstActive: false }),
        beginSync: () => beginPageSync(),
        getPendingMutations: () => state.pendingGlossaryMutations,
        setPendingMutations: (mutations) => {
          state.pendingGlossaryMutations = mutations;
        },
        persistPendingMutations: (mutations) =>
          saveStoredGlossaryPendingMutations(team, mutations),
        persistVisibleState: () => persistGlossariesForTeam(team),
        render,
      });
    },
    processQueue: () => processPendingGlossaryMutations(render, team),
    waitForProcessing: waitForNextPaint,
  });
}

export function openGlossaryPermanentDeletion(render, glossaryId) {
  const glossary = glossaryById(glossaryId);
  const team = selectedTeam();
  void guardTopLevelResourceAction({
    resource: glossary,
    isExpectedResource: (currentGlossary) =>
      Boolean(currentGlossary) && currentGlossary.lifecycleState === "deleted",
    getBlockedMessage: () => lifecycleActionBlockedMessage(team, {
      actionLabel: "permanently delete glossaries",
      requireOwner: true,
    }),
    ensureNotTombstoned: (currentGlossary) =>
      ensureGlossaryNotTombstoned(render, team, currentGlossary),
    onMissing: () => {
      showNoticeBadge("Could not find the selected deleted glossary.", render);
    },
    onBlocked: (blockedMessage) => {
      showNoticeBadge(blockedMessage, render);
    },
  }).then((allowed) => {
    if (!allowed) {
      return;
    }

    openEntityConfirmationModal({
      setState: (nextState) => {
        state.glossaryPermanentDeletion = nextState;
      },
      entityId: glossaryId,
      idField: "glossaryId",
      nameField: "glossaryName",
      confirmationField: "confirmationText",
      currentName: glossary.title,
    });
    render();
  });
}

export function updateGlossaryPermanentDeletionConfirmation(value) {
  updateEntityModalConfirmation(state.glossaryPermanentDeletion, "confirmationText", value);
}

export function cancelGlossaryPermanentDeletion(render) {
  cancelEntityModal(resetGlossaryPermanentDeletion, render);
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
  if (!entityConfirmationMatches(state.glossaryPermanentDeletion, {
    nameField: "glossaryName",
    confirmationField: "confirmationText",
  })) {
    state.glossaryPermanentDeletion.error = "Enter the glossary name exactly to delete it.";
    render();
    return;
  }
  if (await ensureGlossaryNotTombstoned(render, team, glossary)) {
    resetGlossaryPermanentDeletion();
    render();
    return;
  }

  beginEntityModalSubmit(state.glossaryPermanentDeletion, render);
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

  runPermanentDeleteLocalFirst({
    commitTombstone: () => upsertGlossaryMetadataRecord(team, glossaryMetadataRecord(glossary, {
      lifecycleState: "softDeleted",
      remoteState: "deleted",
      recordState: "tombstone",
      deletedAt: new Date().toISOString(),
    })),
    purgeLocalRepo: () => invoke("purge_local_gtms_glossary_repo", {
      input: {
        installationId: team.installationId,
        glossaryId: glossary.id,
        repoName: glossary.repoName,
      },
    }),
    deleteRemote: () => permanentlyDeleteRemoteGlossaryRepoForTeam(team, glossary.repoName),
    reloadAfterSuccess: () => loadTeamGlossaries(render, team.id, { preserveVisibleData: true }),
    rollbackBeforeTombstone: async (error) => {
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
      render();
    },
    onRemoteDeleteError: async (error) => {
      showNoticeBadge(
        `Glossary deletion was committed locally, but remote cleanup still needs attention: ${
          error?.message ?? String(error)
        }`,
        render,
        4200,
      );
      render();
    },
    onLocalDeleteError: async (error) => {
      showNoticeBadge(
        `Glossary deletion was committed locally, but local cleanup still needs attention: ${error?.message ?? String(error)}`,
        render,
        4200,
      );
      render();
      return true;
    },
  });
}
