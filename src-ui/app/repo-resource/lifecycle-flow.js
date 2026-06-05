import { invoke } from "../runtime.js";
import { state } from "../state.js";
import { showNoticeBadge } from "../status-feedback.js";
import { createMutationObserver } from "../query-client.js";
import {
  commitMetadataFirstTopLevelMutation,
  guardPermanentDeleteConfirmation,
  guardTopLevelResourceAction,
} from "../resource-lifecycle-engine.js";
import { openTopLevelRenameModal } from "../resource-top-level-controller.js";
import {
  areResourcePageWritesDisabled,
  areResourcePageWriteSubmissionsDisabled,
} from "../resource-page-controller.js";
import {
  cancelEntityModal,
  entityConfirmationMatches,
  openEntityConfirmationModal,
  updateEntityModalConfirmation,
  updateEntityModalName,
} from "../resource-entity-modal.js";
import { addLocalHardDeleteTombstone } from "../local-hard-delete-store.js";

// Shared lifecycle-flow engine for glossary / QA-list. Term-model metadata and default-resource
// behavior stay descriptor hooks because glossary is bilingual and QA lists are per-language.
//
// Descriptor shape:
//   collectionField, selectedIdField, pageField, editorField, renameField, permanentDeletionField,
//   showDeletedField, resourceIdField, nameField
//   resourceLabel, tombstoneKind, missing/blocked/confirmation messages
//   currentTeam, ensureQueryDataForTeam, persistQueryDataForTeam
//   mutation option factories, editor-query removal, default-resource hooks
//   repo-backed hooks: teamSupportsRepos, repoBackedInput, triggerRepoSync, buildMetadataRecord
//   resource-specific blocked-message and tombstone guards
export function createRepoResourceLifecycleFlow(descriptor) {
  const {
    collectionField,
    selectedIdField,
    pageField,
    editorField,
    renameField,
    permanentDeletionField,
    showDeletedField,
    resourceIdField,
    nameField,
    confirmationField = "confirmationText",
    resourceLabel,
    tombstoneKind,
    currentTeam,
    ensureQueryDataForTeam,
    persistQueryDataForTeam,
    resetRename,
    resetPermanentDeletion,
    createRenameMutationOptions,
    createSoftDeleteMutationOptions,
    createRestoreMutationOptions,
    createPermanentDeleteMutationOptions,
    removeEditorQuery,
    makeDefaultIfFirst,
    updateDefaultAfterDeletion,
    teamSupportsRepos,
    repoBackedInput,
    triggerRepoSync,
    writeMetadata,
    buildMetadataRecord,
    getActionBlockedMessage,
    ensureNotTombstoned,
    anyMutatingWriteIsActive,
    commands,
    messages,
  } = descriptor;

  function resourceById(resourceId) {
    return state[collectionField].find((item) => item.id === resourceId) ?? null;
  }

  function resourceIdFromMutation(mutation) {
    return mutation?.[resourceIdField] ?? mutation?.resourceId ?? null;
  }

  async function commitLifecycleMutation(team, mutation) {
    const resource = resourceById(resourceIdFromMutation(mutation));
    if (!resource) {
      throw new Error(messages.missing);
    }

    if (teamSupportsRepos(team) && resource.repoName) {
      return commitMetadataFirstTopLevelMutation({
        mutation,
        resource,
        resourceLabel,
        writeMetadata: (record) => writeMetadata(team, record),
        buildRecord: (currentResource, overrides = {}) =>
          buildMetadataRecord(currentResource, overrides),
        applyLocalMutation: async (currentResource, currentMutation) => {
          if (currentMutation.type === "rename") {
            const summary = await invoke(commands.rename, {
              input: {
                ...repoBackedInput(team, currentResource),
                title: currentMutation.title,
              },
            });
            triggerRepoSync(team, currentResource);
            return summary;
          }

          if (currentMutation.type === "softDelete") {
            const summary = await invoke(commands.softDelete, {
              input: repoBackedInput(team, currentResource),
            });
            triggerRepoSync(team, currentResource);
            return summary;
          }

          if (currentMutation.type === "restore") {
            const summary = await invoke(commands.restore, {
              input: repoBackedInput(team, currentResource),
            });
            triggerRepoSync(team, currentResource);
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

  function lifecycleWritesDisabled() {
    return areResourcePageWriteSubmissionsDisabled(state[pageField]);
  }

  function heavyWritesDisabled() {
    return areResourcePageWritesDisabled(state[pageField]) || anyMutatingWriteIsActive();
  }

  function deletedResourcesAreVisible() {
    return state[showDeletedField] === true
      && state[collectionField].some((item) => item.lifecycleState === "deleted");
  }

  function toggleDeleted(render) {
    state[showDeletedField] = !state[showDeletedField];
    render();
  }

  function openRename(render, resourceId) {
    const resource = resourceById(resourceId);
    const team = currentTeam();
    if (lifecycleWritesDisabled()) {
      showNoticeBadge(messages.lifecycleWriteBlocked, render);
      return;
    }

    openTopLevelRenameModal({
      resource,
      isExpectedResource: (currentResource) =>
        Boolean(currentResource) && currentResource.lifecycleState !== "deleted",
      getBlockedMessage: () =>
        getActionBlockedMessage(team, { actionLabel: messages.renameActionLabel }),
      ensureNotTombstoned: (currentResource) =>
        ensureNotTombstoned(render, team, currentResource),
      onMissing: () => {
        showNoticeBadge(messages.missing, render);
      },
      onBlocked: (blockedMessage) => {
        showNoticeBadge(blockedMessage, render);
      },
      setModalState: (nextState) => {
        state[renameField] = nextState;
      },
      idField: resourceIdField,
      nameField,
      currentName: resource?.title ?? "",
      render,
    });
  }

  function updateRenameName(value) {
    updateEntityModalName(state[renameField], nameField, value);
  }

  function cancelRename(render) {
    cancelEntityModal(resetRename, render);
  }

  async function submitRename(render) {
    const rename = state[renameField];
    const title = String(rename[nameField] ?? "").trim();
    if (!title) {
      state[renameField] = { ...rename, error: messages.emptyRename };
      render();
      return;
    }

    const team = currentTeam();
    const resource = resourceById(rename[resourceIdField]);
    const allowed = await guardTopLevelResourceAction({
      resource,
      isExpectedResource: (currentResource) =>
        Boolean(currentResource) && currentResource.lifecycleState !== "deleted",
      getBlockedMessage: () =>
        getActionBlockedMessage(team, { actionLabel: messages.renameActionLabel }),
      ensureNotTombstoned: (currentResource) =>
        ensureNotTombstoned(render, team, currentResource),
      onMissing: () => {
        state[renameField].error = messages.missing;
        render();
      },
      onBlocked: (blockedMessage) => {
        state[renameField].error = blockedMessage;
        render();
      },
      onTombstoned: () => {
        resetRename();
        render();
      },
    });
    if (!allowed) {
      return;
    }
    if (lifecycleWritesDisabled()) {
      state[renameField].status = "idle";
      state[renameField].error = messages.lifecycleWriteBlocked;
      render();
      return;
    }

    ensureQueryDataForTeam(team);
    try {
      await createMutationObserver(createRenameMutationOptions({
        team,
        resource,
        nextTitle: title,
        commitMutation: commitLifecycleMutation,
        onOptimisticApplied: () => {
          if (state[editorField][resourceIdField] === rename[resourceIdField]) {
            state[editorField] = {
              ...state[editorField],
              title,
            };
          }
          resetRename();
        },
        onSuccessApplied: (queryData) => {
          removeEditorQuery(team, resource);
          persistQueryDataForTeam(team, queryData);
        },
        onErrorApplied: (error) => {
          state[renameField] = descriptor.renameErrorState?.({
            error,
            rename,
            resource,
            title,
          }) ?? {
            ...rename,
            error: error?.message ?? messages.renameFallbackError,
          };
        },
        render,
      })).mutate();
    } catch {}
  }

  async function deleteResource(render, resourceId) {
    const team = currentTeam();
    const resource = resourceById(resourceId);
    const allowed = await guardTopLevelResourceAction({
      resource,
      isExpectedResource: (currentResource) =>
        Boolean(currentResource) && currentResource.lifecycleState !== "deleted",
      getBlockedMessage: () =>
        getActionBlockedMessage(team, { actionLabel: messages.deleteActionLabel }),
      ensureNotTombstoned: (currentResource) =>
        ensureNotTombstoned(render, team, currentResource),
      onMissing: () => {
        showNoticeBadge(messages.missing, render);
      },
      onBlocked: (blockedMessage) => {
        showNoticeBadge(blockedMessage, render);
      },
    });
    if (!allowed) {
      return;
    }
    if (lifecycleWritesDisabled()) {
      showNoticeBadge(messages.lifecycleWriteBlocked, render);
      return;
    }
    const keepDeletedSectionOpen = deletedResourcesAreVisible();

    ensureQueryDataForTeam(team);
    try {
      await createMutationObserver(createSoftDeleteMutationOptions({
        team,
        resource,
        commitMutation: commitLifecycleMutation,
        onOptimisticApplied: () => {
          state[showDeletedField] = keepDeletedSectionOpen;
        },
        onSuccessApplied: (queryData) => {
          removeEditorQuery(team, resource);
          updateDefaultAfterDeletion(team, resource);
          persistQueryDataForTeam(team, queryData);
        },
        render,
      })).mutate();
    } catch {}
  }

  async function restoreResource(render, resourceId) {
    const team = currentTeam();
    const restored = resourceById(resourceId);
    const allowed = await guardTopLevelResourceAction({
      resource: restored,
      isExpectedResource: (currentResource) =>
        Boolean(currentResource) && currentResource.lifecycleState === "deleted",
      getBlockedMessage: () =>
        getActionBlockedMessage(team, { actionLabel: messages.restoreActionLabel }),
      ensureNotTombstoned: (currentResource) =>
        ensureNotTombstoned(render, team, currentResource),
      onMissing: () => {
        showNoticeBadge(messages.missingDeleted, render);
      },
      onBlocked: (blockedMessage) => {
        showNoticeBadge(blockedMessage, render);
      },
    });
    if (!allowed) {
      return;
    }
    if (lifecycleWritesDisabled()) {
      showNoticeBadge(messages.lifecycleWriteBlocked, render);
      return;
    }

    ensureQueryDataForTeam(team);
    try {
      await createMutationObserver(createRestoreMutationOptions({
        team,
        resource: restored,
        commitMutation: commitLifecycleMutation,
        onSuccessApplied: (queryData) => {
          removeEditorQuery(team, restored);
          makeDefaultIfFirst(team, restored);
          persistQueryDataForTeam(team, queryData);
        },
        render,
      })).mutate();
    } catch {}
  }

  function openPermanentDeletion(render, resourceId) {
    const resource = resourceById(resourceId);
    const team = currentTeam();
    if (heavyWritesDisabled()) {
      showNoticeBadge(messages.writeBlocked, render);
      return;
    }

    void guardTopLevelResourceAction({
      resource,
      isExpectedResource: (currentResource) =>
        Boolean(currentResource) && currentResource.lifecycleState === "deleted",
      getBlockedMessage: () => team ? "" : "Could not determine the selected team.",
      ensureNotTombstoned: (currentResource) =>
        ensureNotTombstoned(render, team, currentResource),
      onMissing: () => {
        showNoticeBadge(messages.missingDeleted, render);
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
          state[permanentDeletionField] = nextState;
        },
        entityId: resourceId,
        idField: resourceIdField,
        nameField,
        confirmationField,
        currentName: resource.title,
      });
      render();
    });
  }

  function updatePermanentDeletionConfirmation(value) {
    updateEntityModalConfirmation(state[permanentDeletionField], confirmationField, value);
  }

  function cancelPermanentDeletion(render) {
    cancelEntityModal(resetPermanentDeletion, render);
  }

  async function confirmPermanentDeletion(render) {
    const team = currentTeam();
    const modalState = state[permanentDeletionField];
    const resource = resourceById(modalState[resourceIdField]);
    if (heavyWritesDisabled()) {
      modalState.status = "idle";
      modalState.error = messages.writeBlocked;
      render();
      return;
    }

    const allowed = await guardPermanentDeleteConfirmation({
      resource,
      modalState,
      missingMessage: messages.missing,
      getBlockedMessage: () => team ? "" : "Could not determine the selected team.",
      confirmationMessage: messages.permanentConfirmation,
      matchesConfirmation: () => entityConfirmationMatches(state[permanentDeletionField], {
        nameField,
        confirmationField,
      }),
      ensureNotTombstoned: (currentResource) =>
        ensureNotTombstoned(render, team, currentResource),
      onTombstoned: () => {
        resetPermanentDeletion();
        render();
      },
      render,
    });
    if (!allowed) {
      return;
    }

    modalState.status = "loading";
    modalState.error = "";
    render();

    const deletionState = { ...modalState };
    try {
      await createMutationObserver(createPermanentDeleteMutationOptions({
        team,
        resource,
        commitMutation: async () => {
          if (teamSupportsRepos(team) && resource?.repoName) {
            await invoke(commands.purge, {
              input: repoBackedInput(team, resource),
            });
          }
          addLocalHardDeleteTombstone(team, tombstoneKind, resource);
        },
        onOptimisticApplied: () => {
          resetPermanentDeletion();
        },
        onSuccessApplied: (queryData) => {
          removeEditorQuery(team, resource);
          if (state[selectedIdField] === resource.id) {
            state[selectedIdField] = null;
          }
          updateDefaultAfterDeletion(team, resource);
          persistQueryDataForTeam(team, queryData);
        },
        onErrorApplied: (error) => {
          state[permanentDeletionField] = {
            ...deletionState,
            status: "idle",
            error: error?.message ?? messages.permanentDeleteFallbackError,
          };
        },
        render,
      })).mutate();
    } catch {}
  }

  return {
    toggleDeleted,
    openRename,
    updateRenameName,
    cancelRename,
    submitRename,
    deleteResource,
    restoreResource,
    openPermanentDeletion,
    updatePermanentDeletionConfirmation,
    cancelPermanentDeletion,
    confirmPermanentDeletion,
  };
}
