import { invoke } from "./runtime.js";
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
import { clearScopedSyncBadge, showNoticeBadge, showScopedSyncBadge } from "./status-feedback.js";
import {
  ensureGlossaryNotTombstoned,
  permanentlyDeleteRemoteGlossaryRepoForTeam,
} from "./glossary-repo-flow.js";
import { upsertGlossaryMetadataRecord } from "./team-metadata-flow.js";
import {
  commitMetadataFirstTopLevelMutation,
  guardPermanentDeleteConfirmation,
  guardTopLevelResourceAction,
} from "./resource-lifecycle-engine.js";
import { openTopLevelRenameModal } from "./resource-top-level-controller.js";
import {
  areResourcePageWritesDisabled,
  submitResourcePageWrite,
} from "./resource-page-controller.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";
import {
  beginEntityModalSubmit,
  cancelEntityModal,
  entityConfirmationMatches,
  openEntityConfirmationModal,
  openEntityRenameModal,
  reopenEntityConfirmationModalWithError,
  updateEntityModalConfirmation,
  updateEntityModalName,
} from "./resource-entity-modal.js";

function setGlossaryUiDebug(render, text) {
  showScopedSyncBadge("glossaries", text, render);
}

function clearGlossaryUiDebug(render) {
  clearScopedSyncBadge("glossaries", render);
}

function glossaryById(glossaryId) {
  return state.glossaries.find((glossary) => glossary.id === glossaryId) ?? null;
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

async function commitGlossaryMutationStrict(team, mutation) {
  const glossary = glossaryById(mutation.glossaryId ?? mutation.resourceId);

  if (!Number.isFinite(team?.installationId) || !glossary) {
    return;
  }

  await commitMetadataFirstTopLevelMutation({
    mutation,
    resource: glossary,
    resourceLabel: "glossary",
    writeMetadata: (record) => upsertGlossaryMetadataRecord(team, record, { requirePushSuccess: true }),
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

async function reloadGlossariesAfterWrite(render, team) {
  await loadTeamGlossaries(render, team?.id, { preserveVisibleData: false });
  return state.glossaries;
}

function glossaryWriteBlockedMessage() {
  return "Wait for the current glossary refresh or write to finish.";
}

export function toggleDeletedGlossaries(render) {
  state.showDeletedGlossaries = !state.showDeletedGlossaries;
  render();
}

export function openGlossaryRename(render, glossaryId) {
  const glossary = glossaryById(glossaryId);
  const team = selectedTeam();
  if (areResourcePageWritesDisabled(state.glossariesPage)) {
    showNoticeBadge(glossaryWriteBlockedMessage(), render);
    return;
  }
  openTopLevelRenameModal({
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
    setModalState: (nextState) => {
      state.glossaryRename = nextState;
    },
    idField: "glossaryId",
    nameField: "glossaryName",
    currentName: glossary?.title ?? "",
    render,
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

  state.glossaryRename.status = "loading";
  state.glossaryRename.error = "";
  render();
  await submitResourcePageWrite({
    pageState: state.glossariesPage,
    render,
    onBlocked: async () => {
      state.glossaryRename.status = "idle";
      state.glossaryRename.error = glossaryWriteBlockedMessage();
      render();
    },
    runMutation: async () => {
      await commitGlossaryMutationStrict(team, {
        type: "rename",
        resourceId: glossary.id,
        glossaryId: glossary.id,
        title: nextTitle,
        previousTitle: glossary.title,
      });
    },
    refreshOptions: {
      loadData: async () => reloadGlossariesAfterWrite(render, team),
    },
    onSuccess: async () => {
      resetGlossaryRename();
    },
    onError: async (error) => {
      if (await handleSyncFailure(classifySyncError(error), { render })) {
        return;
      }
      state.glossaryRename.status = "idle";
      state.glossaryRename.error = error?.message ?? String(error);
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

  await submitResourcePageWrite({
    pageState: state.glossariesPage,
    render,
    onBlocked: async () => {
      showNoticeBadge(glossaryWriteBlockedMessage(), render);
    },
    runMutation: async () => {
      await commitGlossaryMutationStrict(team, {
        type: "softDelete",
        resourceId: glossary.id,
        glossaryId: glossary.id,
      });
    },
    refreshOptions: {
      loadData: async () => reloadGlossariesAfterWrite(render, team),
    },
    onError: async (error) => {
      if (await handleSyncFailure(classifySyncError(error), { render })) {
        return;
      }
      showNoticeBadge(error?.message ?? String(error), render);
    },
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

  await submitResourcePageWrite({
    pageState: state.glossariesPage,
    render,
    onBlocked: async () => {
      showNoticeBadge(glossaryWriteBlockedMessage(), render);
    },
    runMutation: async () => {
      await commitGlossaryMutationStrict(team, {
        type: "restore",
        resourceId: glossary.id,
        glossaryId: glossary.id,
      });
    },
    refreshOptions: {
      loadData: async () => reloadGlossariesAfterWrite(render, team),
    },
    onError: async (error) => {
      if (await handleSyncFailure(classifySyncError(error), { render })) {
        return;
      }
      showNoticeBadge(error?.message ?? String(error), render);
    },
  });
}

export function openGlossaryPermanentDeletion(render, glossaryId) {
  const glossary = glossaryById(glossaryId);
  const team = selectedTeam();
  if (areResourcePageWritesDisabled(state.glossariesPage)) {
    showNoticeBadge(glossaryWriteBlockedMessage(), render);
    return;
  }
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
  if (areResourcePageWritesDisabled(state.glossariesPage)) {
    state.glossaryPermanentDeletion.status = "idle";
    state.glossaryPermanentDeletion.error = glossaryWriteBlockedMessage();
    render();
    return;
  }
  const allowed = await guardPermanentDeleteConfirmation({
    resource: glossary,
    modalState: state.glossaryPermanentDeletion,
    missingMessage: "Could not find the selected glossary.",
    getBlockedMessage: () => lifecycleActionBlockedMessage(team, {
      actionLabel: "permanently delete glossaries",
      requireOwner: true,
    }),
    confirmationMessage: "Enter the glossary name exactly to delete it.",
    matchesConfirmation: () => entityConfirmationMatches(state.glossaryPermanentDeletion, {
      nameField: "glossaryName",
      confirmationField: "confirmationText",
    }),
    ensureNotTombstoned: (currentGlossary) =>
      ensureGlossaryNotTombstoned(render, team, currentGlossary),
    onTombstoned: () => {
      resetGlossaryPermanentDeletion();
      render();
    },
    render,
  });
  if (!allowed) {
    return;
  }

  state.glossaryPermanentDeletion.status = "loading";
  state.glossaryPermanentDeletion.error = "";
  render();

  await submitResourcePageWrite({
    pageState: state.glossariesPage,
    render,
    onBlocked: async () => {
      state.glossaryPermanentDeletion.status = "idle";
      state.glossaryPermanentDeletion.error = glossaryWriteBlockedMessage();
      render();
    },
    runMutation: async () => {
      await upsertGlossaryMetadataRecord(team, glossaryMetadataRecord(glossary, {
        lifecycleState: "softDeleted",
        remoteState: "deleted",
        recordState: "tombstone",
        deletedAt: new Date().toISOString(),
      }), { requirePushSuccess: true });
      await invoke("purge_local_gtms_glossary_repo", {
        input: {
          installationId: team.installationId,
          glossaryId: glossary.id,
          repoName: glossary.repoName,
        },
      });
      await permanentlyDeleteRemoteGlossaryRepoForTeam(team, glossary.repoName);
    },
    refreshOptions: {
      loadData: async () => reloadGlossariesAfterWrite(render, team),
    },
    onSuccess: async () => {
      resetGlossaryPermanentDeletion();
      if (state.selectedGlossaryId === glossary.id) {
        state.selectedGlossaryId = null;
      }
    },
    onError: async (error) => {
      if (await handleSyncFailure(classifySyncError(error), {
        render,
        teamId: team?.id ?? null,
        currentResource: true,
      })) {
        return;
      }
      state.glossaryPermanentDeletion.status = "idle";
      state.glossaryPermanentDeletion.error = error?.message ?? String(error);
    },
  });
}
