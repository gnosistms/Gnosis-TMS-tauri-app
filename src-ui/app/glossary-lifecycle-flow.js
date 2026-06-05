import { invoke } from "./runtime.js";
import {
  resetGlossaryPermanentDeletion,
  resetGlossaryRename,
  state,
} from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import {
  createGlossaryPermanentDeleteMutationOptions,
  createGlossaryRenameMutationOptions,
  createGlossaryRestoreMutationOptions,
  createGlossarySoftDeleteMutationOptions,
  persistGlossariesQueryDataForTeam,
} from "./glossary-query.js";
import { createMutationObserver } from "./query-client.js";
import { removeGlossaryEditorQuery } from "./glossary-editor-query.js";
import {
  currentGlossaryTeam,
  ensureGlossariesQueryDataForTeam,
  repoBackedGlossaryInput,
  triggerGlossaryRepoSync,
} from "./glossary-top-level-state.js";
import { makeGlossaryDefaultIfFirst, updateDefaultGlossaryAfterDeletion } from "./glossary-default-flow.js";
import {
  ensureGlossaryNotTombstoned,
  teamSupportsGlossaryRepos,
} from "./glossary-repo-flow.js";
import {
  canManageGlossaryResourcesForTeam,
  canPermanentlyDeleteGlossaries,
} from "./glossary-shared.js";
import {
  commitMetadataFirstTopLevelMutation,
  guardPermanentDeleteConfirmation,
  guardTopLevelResourceAction,
} from "./resource-lifecycle-engine.js";
import { openTopLevelRenameModal } from "./resource-top-level-controller.js";
import {
  areResourcePageWritesDisabled,
  areResourcePageWriteSubmissionsDisabled,
} from "./resource-page-controller.js";
import {
  cancelEntityModal,
  entityConfirmationMatches,
  openEntityConfirmationModal,
  updateEntityModalConfirmation,
  updateEntityModalName,
} from "./resource-entity-modal.js";
import { anyGlossaryMutatingWriteIsActive } from "./glossary-write-coordinator.js";
import { addLocalHardDeleteTombstone } from "./local-hard-delete-store.js";
import { upsertGlossaryMetadataRecord } from "./team-metadata-flow.js";

function glossaryById(glossaryId) {
  return state.glossaries.find((item) => item.id === glossaryId) ?? null;
}

function glossaryMetadataRecord(glossary, overrides = {}) {
  return {
    glossaryId: glossary.id ?? glossary.glossaryId,
    title: overrides.title ?? glossary.title,
    repoName: overrides.repoName ?? glossary.repoName,
    previousRepoNames: overrides.previousRepoNames ?? glossary.previousRepoNames ?? [],
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
      ?? (glossary.lifecycleState === "deleted" ? "deleted" : "active"),
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

async function commitGlossaryLifecycleMutation(team, mutation) {
  const glossary = glossaryById(mutation.glossaryId ?? mutation.resourceId);
  if (!glossary) {
    throw new Error("Could not find the selected glossary.");
  }

  if (teamSupportsGlossaryRepos(team) && glossary.repoName) {
    return commitMetadataFirstTopLevelMutation({
      mutation,
      resource: glossary,
      resourceLabel: "glossary",
      writeMetadata: (record) => upsertGlossaryMetadataRecord(team, record, { requirePushSuccess: true }),
      buildRecord: (currentGlossary, overrides = {}) =>
        glossaryMetadataRecord(currentGlossary, overrides),
      applyLocalMutation: async (currentGlossary, currentMutation) => {
        if (currentMutation.type === "rename") {
          const summary = await invoke("rename_gtms_glossary", {
            input: {
              ...repoBackedGlossaryInput(team, currentGlossary),
              title: currentMutation.title,
            },
          });
          triggerGlossaryRepoSync(team, currentGlossary);
          return summary;
        }

        if (currentMutation.type === "softDelete") {
          const summary = await invoke("soft_delete_gtms_glossary", {
            input: repoBackedGlossaryInput(team, currentGlossary),
          });
          triggerGlossaryRepoSync(team, currentGlossary);
          return summary;
        }

        if (currentMutation.type === "restore") {
          const summary = await invoke("restore_gtms_glossary", {
            input: repoBackedGlossaryInput(team, currentGlossary),
          });
          triggerGlossaryRepoSync(team, currentGlossary);
          return summary;
        }

        return {};
      },
    });
  }

  const updatedAt = new Date().toISOString();
  if (mutation.type === "rename") {
    return { title: mutation.title, updatedAt };
  }
  if (mutation.type === "softDelete") {
    return { lifecycleState: "deleted", updatedAt };
  }
  if (mutation.type === "restore") {
    return { lifecycleState: "active", updatedAt };
  }
  return {};
}

function glossaryLifecycleActionBlockedMessage(team, { actionLabel, requireOwner = false } = {}) {
  if (!Number.isFinite(team?.installationId)) {
    return "This glossary action requires a GitHub App-connected team.";
  }
  if (state.offline?.isEnabled === true) {
    return `You cannot ${actionLabel} while offline.`;
  }
  if (requireOwner ? !canPermanentlyDeleteGlossaries(team) : !canManageGlossaryResourcesForTeam(team)) {
    return `You do not have permission to ${actionLabel} in this team.`;
  }
  return "";
}

function glossaryWriteBlockedMessage() {
  return "Wait for the current glossary refresh or write to finish.";
}

function glossaryLifecycleWriteBlockedMessage() {
  return "Wait for the current glossary write to finish.";
}

function areGlossaryLifecycleWritesDisabled() {
  return areResourcePageWriteSubmissionsDisabled(state.glossariesPage);
}

function areGlossaryHeavyWritesDisabled() {
  return areResourcePageWritesDisabled(state.glossariesPage) || anyGlossaryMutatingWriteIsActive();
}

export function toggleDeletedGlossaries(render) {
  state.showDeletedGlossaries = !state.showDeletedGlossaries;
  render();
}

export function openGlossaryRename(render, glossaryId) {
  const glossary = glossaryById(glossaryId);
  const team = currentGlossaryTeam();
  if (areGlossaryLifecycleWritesDisabled()) {
    showNoticeBadge(glossaryLifecycleWriteBlockedMessage(), render);
    return;
  }

  openTopLevelRenameModal({
    resource: glossary,
    isExpectedResource: (currentGlossary) =>
      Boolean(currentGlossary) && currentGlossary.lifecycleState !== "deleted",
    getBlockedMessage: () =>
      glossaryLifecycleActionBlockedMessage(team, { actionLabel: "rename glossaries" }),
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
  const rename = state.glossaryRename;
  const title = String(rename.glossaryName ?? "").trim();
  if (!title) {
    state.glossaryRename = { ...rename, error: "Enter a glossary name." };
    render();
    return;
  }

  const team = currentGlossaryTeam();
  const glossary = glossaryById(rename.glossaryId);
  const allowed = await guardTopLevelResourceAction({
    resource: glossary,
    isExpectedResource: (currentGlossary) =>
      Boolean(currentGlossary) && currentGlossary.lifecycleState !== "deleted",
    getBlockedMessage: () =>
      glossaryLifecycleActionBlockedMessage(team, { actionLabel: "rename glossaries" }),
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
  if (areGlossaryLifecycleWritesDisabled()) {
    state.glossaryRename.status = "idle";
    state.glossaryRename.error = glossaryLifecycleWriteBlockedMessage();
    render();
    return;
  }

  ensureGlossariesQueryDataForTeam(team);
  try {
    await createMutationObserver(createGlossaryRenameMutationOptions({
      team,
      glossary,
      nextTitle: title,
      commitMutation: commitGlossaryLifecycleMutation,
      onOptimisticApplied: () => {
        if (state.glossaryEditor.glossaryId === rename.glossaryId) {
          state.glossaryEditor = {
            ...state.glossaryEditor,
            title,
          };
        }
        resetGlossaryRename();
      },
      onSuccessApplied: (queryData) => {
        removeGlossaryEditorQuery(team, glossary);
        persistGlossariesQueryDataForTeam(team, queryData);
      },
      onErrorApplied: (error) => {
        state.glossaryRename = {
          isOpen: true,
          glossaryId: glossary.id,
          glossaryName: title,
          status: "idle",
          error: error?.message ?? String(error),
        };
      },
      render,
    })).mutate();
  } catch {}
}

export async function deleteGlossary(render, glossaryId) {
  const team = currentGlossaryTeam();
  const glossary = glossaryById(glossaryId);
  const allowed = await guardTopLevelResourceAction({
    resource: glossary,
    isExpectedResource: (currentGlossary) =>
      Boolean(currentGlossary) && currentGlossary.lifecycleState !== "deleted",
    getBlockedMessage: () =>
      glossaryLifecycleActionBlockedMessage(team, { actionLabel: "delete glossaries" }),
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
  if (areGlossaryLifecycleWritesDisabled()) {
    showNoticeBadge(glossaryLifecycleWriteBlockedMessage(), render);
    return;
  }
  const keepDeletedSectionOpen =
    state.showDeletedGlossaries === true
    && state.glossaries.some((item) => item.lifecycleState === "deleted");

  ensureGlossariesQueryDataForTeam(team);
  try {
    await createMutationObserver(createGlossarySoftDeleteMutationOptions({
      team,
      glossary,
      commitMutation: commitGlossaryLifecycleMutation,
      onOptimisticApplied: () => {
        state.showDeletedGlossaries = keepDeletedSectionOpen;
      },
      onSuccessApplied: (queryData) => {
        removeGlossaryEditorQuery(team, glossary);
        updateDefaultGlossaryAfterDeletion(team, glossary.id);
        persistGlossariesQueryDataForTeam(team, queryData);
      },
      render,
    })).mutate();
  } catch {}
}

export async function restoreGlossary(render, glossaryId) {
  const team = currentGlossaryTeam();
  const restored = glossaryById(glossaryId);
  const allowed = await guardTopLevelResourceAction({
    resource: restored,
    isExpectedResource: (currentGlossary) =>
      Boolean(currentGlossary) && currentGlossary.lifecycleState === "deleted",
    getBlockedMessage: () =>
      glossaryLifecycleActionBlockedMessage(team, { actionLabel: "restore glossaries" }),
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
  if (areGlossaryLifecycleWritesDisabled()) {
    showNoticeBadge(glossaryLifecycleWriteBlockedMessage(), render);
    return;
  }

  ensureGlossariesQueryDataForTeam(team);
  try {
    await createMutationObserver(createGlossaryRestoreMutationOptions({
      team,
      glossary: restored,
      commitMutation: commitGlossaryLifecycleMutation,
      onSuccessApplied: (queryData) => {
        removeGlossaryEditorQuery(team, restored);
        makeGlossaryDefaultIfFirst(team, restored.id);
        persistGlossariesQueryDataForTeam(team, queryData);
      },
      render,
    })).mutate();
  } catch {}
}

export function openGlossaryPermanentDeletion(render, glossaryId) {
  const glossary = glossaryById(glossaryId);
  const team = currentGlossaryTeam();
  if (areGlossaryHeavyWritesDisabled()) {
    showNoticeBadge(glossaryWriteBlockedMessage(), render);
    return;
  }

  void guardTopLevelResourceAction({
    resource: glossary,
    isExpectedResource: (currentGlossary) =>
      Boolean(currentGlossary) && currentGlossary.lifecycleState === "deleted",
    getBlockedMessage: () => team ? "" : "Could not determine the selected team.",
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
  const team = currentGlossaryTeam();
  const glossary = glossaryById(state.glossaryPermanentDeletion.glossaryId);
  if (areGlossaryHeavyWritesDisabled()) {
    state.glossaryPermanentDeletion.status = "idle";
    state.glossaryPermanentDeletion.error = glossaryWriteBlockedMessage();
    render();
    return;
  }

  const allowed = await guardPermanentDeleteConfirmation({
    resource: glossary,
    modalState: state.glossaryPermanentDeletion,
    missingMessage: "Could not find the selected glossary.",
    getBlockedMessage: () => team ? "" : "Could not determine the selected team.",
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

  const deletionState = { ...state.glossaryPermanentDeletion };
  try {
    await createMutationObserver(createGlossaryPermanentDeleteMutationOptions({
      team,
      glossary,
      commitMutation: async () => {
        if (teamSupportsGlossaryRepos(team) && glossary?.repoName) {
          await invoke("purge_local_gtms_glossary_repo", {
            input: repoBackedGlossaryInput(team, glossary),
          });
        }
        addLocalHardDeleteTombstone(team, "glossary", glossary);
      },
      onOptimisticApplied: () => {
        resetGlossaryPermanentDeletion();
      },
      onSuccessApplied: (queryData) => {
        removeGlossaryEditorQuery(team, glossary);
        if (state.selectedGlossaryId === glossary.id) {
          state.selectedGlossaryId = null;
        }
        updateDefaultGlossaryAfterDeletion(team, glossary.id);
        persistGlossariesQueryDataForTeam(team, queryData);
      },
      onErrorApplied: (error) => {
        state.glossaryPermanentDeletion = {
          ...deletionState,
          status: "idle",
          error: error?.message ?? "Could not permanently delete this glossary.",
        };
      },
      render,
    })).mutate();
  } catch {}
}
