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
  deleteRemoteQaListRepo,
  ensureQaListNotTombstoned,
  teamSupportsQaListRepos,
} from "./qa-list-repo-flow.js";
import {
  canManageQaLists,
  canPermanentlyDeleteQaLists,
} from "./qa-list-shared.js";
import {
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

function qaListById(qaListId) {
  return state.qaLists.find((item) => item.id === qaListId) ?? null;
}

async function commitQaListLifecycleMutation(team, mutation) {
  const qaList = qaListById(mutation.qaListId);
  if (!qaList) {
    throw new Error("Could not find the selected QA list.");
  }

  if (teamSupportsQaListRepos(team) && qaList.repoName) {
    if (mutation.type === "rename") {
      const summary = await invoke("rename_gtms_qa_list", {
        input: {
          ...repoBackedQaListInput(team, qaList),
          title: mutation.title,
        },
      });
      triggerQaListRepoSync(team, qaList);
      return summary;
    }

    if (mutation.type === "softDelete") {
      const summary = await invoke("soft_delete_gtms_qa_list", {
        input: repoBackedQaListInput(team, qaList),
      });
      triggerQaListRepoSync(team, qaList);
      return summary;
    }

    if (mutation.type === "restore") {
      const summary = await invoke("restore_gtms_qa_list", {
        input: repoBackedQaListInput(team, qaList),
      });
      triggerQaListRepoSync(team, qaList);
      return summary;
    }
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
  if (requireOwner ? !canPermanentlyDeleteQaLists(team) : !canManageQaLists(team)) {
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

  ensureQaListsQueryDataForTeam(team);
  try {
    await createMutationObserver(createQaListSoftDeleteMutationOptions({
      team,
      qaList,
      commitMutation: commitQaListLifecycleMutation,
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
    getBlockedMessage: () => qaListLifecycleActionBlockedMessage(team, {
      actionLabel: "permanently delete QA lists",
      requireOwner: true,
    }),
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
    getBlockedMessage: () => qaListLifecycleActionBlockedMessage(team, {
      actionLabel: "permanently delete QA lists",
      requireOwner: true,
    }),
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
          await deleteRemoteQaListRepo(team, qaList);
          await invoke("purge_local_gtms_qa_list_repo", {
            input: repoBackedQaListInput(team, qaList),
          });
        }
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
