import { invoke } from "./runtime.js";
import {
  resetQaListPermanentDeletion,
  resetQaListRename,
  state,
} from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import {
  createQaListPermanentDeleteMutationOptions,
  createQaListRenameMutationOptions,
  createQaListRestoreMutationOptions,
  createQaListSoftDeleteMutationOptions,
  persistQaListsQueryDataForTeam,
} from "./qa-list-query.js";
import { createMutationObserver } from "./query-client.js";
import { removeQaListEditorQuery } from "./qa-list-editor-query.js";
import {
  currentQaListTeam,
  ensureQaListsQueryDataForTeam,
  repoBackedQaListInput,
  triggerQaListRepoSync,
} from "./qa-list-top-level-state.js";
import { makeQaListDefaultIfFirst, updateDefaultQaListAfterDeletion } from "./qa-list-default-flow.js";
import {
  ensureQaListNotTombstoned,
  teamSupportsQaListRepos,
} from "./qa-list-repo-flow.js";
import {
  canManageQaListResourcesForTeam,
  canPermanentlyDeleteQaLists,
} from "./qa-list-shared.js";
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
import { anyQaListMutatingWriteIsActive } from "./qa-list-write-coordinator.js";
import { addLocalHardDeleteTombstone } from "./local-hard-delete-store.js";
import { upsertQaListMetadataRecord } from "./team-metadata-flow.js";

function qaListById(qaListId) {
  return state.qaLists.find((item) => item.id === qaListId) ?? null;
}

function qaListMetadataRecord(qaList, overrides = {}) {
  return {
    qaListId: qaList.id ?? qaList.qaListId,
    title: overrides.title ?? qaList.title,
    repoName: overrides.repoName ?? qaList.repoName,
    previousRepoNames: overrides.previousRepoNames ?? qaList.previousRepoNames ?? [],
    githubRepoId:
      Number.isFinite(overrides.githubRepoId)
        ? overrides.githubRepoId
        : Number.isFinite(qaList.repoId)
          ? qaList.repoId
          : null,
    githubNodeId:
      typeof overrides.githubNodeId === "string" && overrides.githubNodeId.trim()
        ? overrides.githubNodeId.trim()
        : typeof qaList.nodeId === "string" && qaList.nodeId.trim()
          ? qaList.nodeId.trim()
          : null,
    fullName:
      typeof overrides.fullName === "string" && overrides.fullName.trim()
        ? overrides.fullName.trim()
        : typeof qaList.fullName === "string" && qaList.fullName.trim()
          ? qaList.fullName.trim()
          : null,
    defaultBranch:
      typeof overrides.defaultBranch === "string" && overrides.defaultBranch.trim()
        ? overrides.defaultBranch.trim()
        : typeof qaList.defaultBranchName === "string" && qaList.defaultBranchName.trim()
          ? qaList.defaultBranchName.trim()
          : "main",
    lifecycleState:
      overrides.lifecycleState
      ?? (qaList.lifecycleState === "deleted" ? "deleted" : "active"),
    remoteState: overrides.remoteState ?? qaList.remoteState ?? "linked",
    recordState: overrides.recordState ?? qaList.recordState ?? "live",
    deletedAt: overrides.deletedAt ?? qaList.deletedAt ?? null,
    language: overrides.language ?? qaList.language ?? null,
    termCount:
      Number.isFinite(overrides.termCount)
        ? overrides.termCount
        : Number.isFinite(qaList.termCount)
          ? qaList.termCount
          : 0,
  };
}

async function commitQaListLifecycleMutation(team, mutation) {
  const qaList = qaListById(mutation.qaListId);
  if (!qaList) {
    throw new Error("Could not find the selected QA list.");
  }

  if (teamSupportsQaListRepos(team) && qaList.repoName) {
    return commitMetadataFirstTopLevelMutation({
      mutation,
      resource: qaList,
      resourceLabel: "qaList",
      writeMetadata: (record) => upsertQaListMetadataRecord(team, record, { requirePushSuccess: true }),
      buildRecord: (currentQaList, overrides = {}) =>
        qaListMetadataRecord(currentQaList, overrides),
      applyLocalMutation: async (currentQaList, currentMutation) => {
        if (currentMutation.type === "rename") {
          const summary = await invoke("rename_gtms_qa_list", {
            input: {
              ...repoBackedQaListInput(team, currentQaList),
              title: currentMutation.title,
            },
          });
          triggerQaListRepoSync(team, currentQaList);
          return summary;
        }

        if (currentMutation.type === "softDelete") {
          const summary = await invoke("soft_delete_gtms_qa_list", {
            input: repoBackedQaListInput(team, currentQaList),
          });
          triggerQaListRepoSync(team, currentQaList);
          return summary;
        }

        if (currentMutation.type === "restore") {
          const summary = await invoke("restore_gtms_qa_list", {
            input: repoBackedQaListInput(team, currentQaList),
          });
          triggerQaListRepoSync(team, currentQaList);
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

function qaListLifecycleActionBlockedMessage(team, { actionLabel, requireOwner = false } = {}) {
  if (!Number.isFinite(team?.installationId)) {
    return "This QA list action requires a GitHub App-connected team.";
  }
  if (state.offline?.isEnabled === true) {
    return `You cannot ${actionLabel} while offline.`;
  }
  if (requireOwner ? !canPermanentlyDeleteQaLists(team) : !canManageQaListResourcesForTeam(team)) {
    return `You do not have permission to ${actionLabel} in this team.`;
  }
  return "";
}

function qaListWriteBlockedMessage() {
  return "Wait for the current QA list refresh or write to finish.";
}

function qaListLifecycleWriteBlockedMessage() {
  return "Wait for the current QA list write to finish.";
}

function areQaListLifecycleWritesDisabled() {
  return areResourcePageWriteSubmissionsDisabled(state.qaListsPage);
}

function areQaListHeavyWritesDisabled() {
  return areResourcePageWritesDisabled(state.qaListsPage) || anyQaListMutatingWriteIsActive();
}

export function toggleDeletedQaLists(render) {
  state.showDeletedQaLists = !state.showDeletedQaLists;
  render();
}

export function openQaListRename(render, qaListId) {
  const qaList = qaListById(qaListId);
  const team = currentQaListTeam();
  if (areQaListLifecycleWritesDisabled()) {
    showNoticeBadge(qaListLifecycleWriteBlockedMessage(), render);
    return;
  }

  openTopLevelRenameModal({
    resource: qaList,
    isExpectedResource: (currentQaList) =>
      Boolean(currentQaList) && currentQaList.lifecycleState !== "deleted",
    getBlockedMessage: () =>
      qaListLifecycleActionBlockedMessage(team, { actionLabel: "rename QA lists" }),
    ensureNotTombstoned: (currentQaList) =>
      ensureQaListNotTombstoned(render, team, currentQaList),
    onMissing: () => {
      showNoticeBadge("Could not find the selected QA list.", render);
    },
    onBlocked: (blockedMessage) => {
      showNoticeBadge(blockedMessage, render);
    },
    setModalState: (nextState) => {
      state.qaListRename = nextState;
    },
    idField: "qaListId",
    nameField: "qaListName",
    currentName: qaList?.title ?? "",
    render,
  });
}

export function updateQaListRenameName(value) {
  updateEntityModalName(state.qaListRename, "qaListName", value);
}

export function cancelQaListRename(render) {
  cancelEntityModal(resetQaListRename, render);
}

export async function submitQaListRename(render) {
  const rename = state.qaListRename;
  const title = String(rename.qaListName ?? "").trim();
  if (!title) {
    state.qaListRename = { ...rename, error: "Enter a QA list name." };
    render();
    return;
  }

  const team = currentQaListTeam();
  const qaList = qaListById(rename.qaListId);
  const allowed = await guardTopLevelResourceAction({
    resource: qaList,
    isExpectedResource: (currentQaList) =>
      Boolean(currentQaList) && currentQaList.lifecycleState !== "deleted",
    getBlockedMessage: () =>
      qaListLifecycleActionBlockedMessage(team, { actionLabel: "rename QA lists" }),
    ensureNotTombstoned: (currentQaList) =>
      ensureQaListNotTombstoned(render, team, currentQaList),
    onMissing: () => {
      state.qaListRename.error = "Could not find the selected QA list.";
      render();
    },
    onBlocked: (blockedMessage) => {
      state.qaListRename.error = blockedMessage;
      render();
    },
    onTombstoned: () => {
      resetQaListRename();
      render();
    },
  });
  if (!allowed) {
    return;
  }
  if (areQaListLifecycleWritesDisabled()) {
    state.qaListRename.status = "idle";
    state.qaListRename.error = qaListLifecycleWriteBlockedMessage();
    render();
    return;
  }

  ensureQaListsQueryDataForTeam(team);
  try {
    await createMutationObserver(createQaListRenameMutationOptions({
      team,
      qaList,
      nextTitle: title,
      commitMutation: commitQaListLifecycleMutation,
      onOptimisticApplied: () => {
        if (state.qaListEditor.qaListId === rename.qaListId) {
          state.qaListEditor = {
            ...state.qaListEditor,
            title,
          };
        }
        resetQaListRename();
      },
      onSuccessApplied: (queryData) => {
        removeQaListEditorQuery(team, qaList);
        persistQaListsQueryDataForTeam(team, queryData);
      },
      onErrorApplied: (error) => {
        state.qaListRename = {
          ...rename,
          error: error?.message ?? "Could not rename this QA list.",
        };
      },
      render,
    })).mutate();
  } catch {}
}

export async function deleteQaList(render, qaListId) {
  const team = currentQaListTeam();
  const qaList = qaListById(qaListId);
  const allowed = await guardTopLevelResourceAction({
    resource: qaList,
    isExpectedResource: (currentQaList) =>
      Boolean(currentQaList) && currentQaList.lifecycleState !== "deleted",
    getBlockedMessage: () =>
      qaListLifecycleActionBlockedMessage(team, { actionLabel: "delete QA lists" }),
    ensureNotTombstoned: (currentQaList) =>
      ensureQaListNotTombstoned(render, team, currentQaList),
    onMissing: () => {
      showNoticeBadge("Could not find the selected QA list.", render);
    },
    onBlocked: (blockedMessage) => {
      showNoticeBadge(blockedMessage, render);
    },
  });
  if (!allowed) {
    return;
  }
  if (areQaListLifecycleWritesDisabled()) {
    showNoticeBadge(qaListLifecycleWriteBlockedMessage(), render);
    return;
  }
  const keepDeletedSectionOpen =
    state.showDeletedQaLists === true
    && state.qaLists.some((item) => item.lifecycleState === "deleted");

  ensureQaListsQueryDataForTeam(team);
  try {
    await createMutationObserver(createQaListSoftDeleteMutationOptions({
      team,
      qaList,
      commitMutation: commitQaListLifecycleMutation,
      onOptimisticApplied: () => {
        state.showDeletedQaLists = keepDeletedSectionOpen;
      },
      onSuccessApplied: (queryData) => {
        removeQaListEditorQuery(team, qaList);
        updateDefaultQaListAfterDeletion(team, qaList);
        persistQaListsQueryDataForTeam(team, queryData);
      },
      render,
    })).mutate();
  } catch {}
}

export async function restoreQaList(render, qaListId) {
  const team = currentQaListTeam();
  const restored = qaListById(qaListId);
  const allowed = await guardTopLevelResourceAction({
    resource: restored,
    isExpectedResource: (currentQaList) =>
      Boolean(currentQaList) && currentQaList.lifecycleState === "deleted",
    getBlockedMessage: () =>
      qaListLifecycleActionBlockedMessage(team, { actionLabel: "restore QA lists" }),
    ensureNotTombstoned: (currentQaList) =>
      ensureQaListNotTombstoned(render, team, currentQaList),
    onMissing: () => {
      showNoticeBadge("Could not find the selected deleted QA list.", render);
    },
    onBlocked: (blockedMessage) => {
      showNoticeBadge(blockedMessage, render);
    },
  });
  if (!allowed) {
    return;
  }
  if (areQaListLifecycleWritesDisabled()) {
    showNoticeBadge(qaListLifecycleWriteBlockedMessage(), render);
    return;
  }

  ensureQaListsQueryDataForTeam(team);
  try {
    await createMutationObserver(createQaListRestoreMutationOptions({
      team,
      qaList: restored,
      commitMutation: commitQaListLifecycleMutation,
      onSuccessApplied: (queryData) => {
        removeQaListEditorQuery(team, restored);
        makeQaListDefaultIfFirst(team, { ...restored, lifecycleState: "active" });
        persistQaListsQueryDataForTeam(team, queryData);
      },
      render,
    })).mutate();
  } catch {}
}

export function openQaListPermanentDeletion(render, qaListId) {
  const qaList = qaListById(qaListId);
  const team = currentQaListTeam();
  if (areQaListHeavyWritesDisabled()) {
    showNoticeBadge(qaListWriteBlockedMessage(), render);
    return;
  }

  void guardTopLevelResourceAction({
    resource: qaList,
    isExpectedResource: (currentQaList) =>
      Boolean(currentQaList) && currentQaList.lifecycleState === "deleted",
    getBlockedMessage: () => team ? "" : "Could not determine the selected team.",
    ensureNotTombstoned: (currentQaList) =>
      ensureQaListNotTombstoned(render, team, currentQaList),
    onMissing: () => {
      showNoticeBadge("Could not find the selected deleted QA list.", render);
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
        state.qaListPermanentDeletion = nextState;
      },
      entityId: qaListId,
      idField: "qaListId",
      nameField: "qaListName",
      confirmationField: "confirmationText",
      currentName: qaList.title,
    });
    render();
  });
}

export function updateQaListPermanentDeletionConfirmation(value) {
  updateEntityModalConfirmation(state.qaListPermanentDeletion, "confirmationText", value);
}

export function cancelQaListPermanentDeletion(render) {
  cancelEntityModal(resetQaListPermanentDeletion, render);
}

export async function confirmQaListPermanentDeletion(render) {
  const team = currentQaListTeam();
  const qaList = qaListById(state.qaListPermanentDeletion.qaListId);
  if (areQaListHeavyWritesDisabled()) {
    state.qaListPermanentDeletion.status = "idle";
    state.qaListPermanentDeletion.error = qaListWriteBlockedMessage();
    render();
    return;
  }

  const allowed = await guardPermanentDeleteConfirmation({
    resource: qaList,
    modalState: state.qaListPermanentDeletion,
    missingMessage: "Could not find the selected QA list.",
    getBlockedMessage: () => team ? "" : "Could not determine the selected team.",
    confirmationMessage: "Enter the QA list name exactly to delete it.",
    matchesConfirmation: () => entityConfirmationMatches(state.qaListPermanentDeletion, {
      nameField: "qaListName",
      confirmationField: "confirmationText",
    }),
    ensureNotTombstoned: (currentQaList) =>
      ensureQaListNotTombstoned(render, team, currentQaList),
    onTombstoned: () => {
      resetQaListPermanentDeletion();
      render();
    },
    render,
  });
  if (!allowed) {
    return;
  }

  state.qaListPermanentDeletion.status = "loading";
  state.qaListPermanentDeletion.error = "";
  render();

  const deletionState = { ...state.qaListPermanentDeletion };
  try {
    await createMutationObserver(createQaListPermanentDeleteMutationOptions({
      team,
      qaList,
      commitMutation: async () => {
        if (teamSupportsQaListRepos(team) && qaList?.repoName) {
          await invoke("purge_local_gtms_qa_list_repo", {
            input: repoBackedQaListInput(team, qaList),
          });
        }
        addLocalHardDeleteTombstone(team, "qaList", qaList);
      },
      onOptimisticApplied: () => {
        resetQaListPermanentDeletion();
      },
      onSuccessApplied: (queryData) => {
        removeQaListEditorQuery(team, qaList);
        if (state.selectedQaListId === qaList.id) {
          state.selectedQaListId = null;
        }
        updateDefaultQaListAfterDeletion(team, qaList);
        persistQaListsQueryDataForTeam(team, queryData);
      },
      onErrorApplied: (error) => {
        state.qaListPermanentDeletion = {
          ...deletionState,
          status: "idle",
          error: error?.message ?? "Could not permanently delete this QA list.",
        };
      },
      render,
    })).mutate();
  } catch {}
}
