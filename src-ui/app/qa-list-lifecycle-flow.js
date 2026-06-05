import {
  resetQaListPermanentDeletion,
  resetQaListRename,
  state,
} from "./state.js";
import {
  createQaListPermanentDeleteMutationOptions,
  createQaListRenameMutationOptions,
  createQaListRestoreMutationOptions,
  createQaListSoftDeleteMutationOptions,
  persistQaListsQueryDataForTeam,
} from "./qa-list-query.js";
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
import { anyQaListMutatingWriteIsActive } from "./qa-list-write-coordinator.js";
import { upsertQaListMetadataRecord } from "./team-metadata-flow.js";
import { createRepoResourceLifecycleFlow } from "./repo-resource/lifecycle-flow.js";

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

const qaListLifecycleFlow = createRepoResourceLifecycleFlow({
  collectionField: "qaLists",
  selectedIdField: "selectedQaListId",
  pageField: "qaListsPage",
  editorField: "qaListEditor",
  renameField: "qaListRename",
  permanentDeletionField: "qaListPermanentDeletion",
  showDeletedField: "showDeletedQaLists",
  resourceIdField: "qaListId",
  nameField: "qaListName",
  resourceLabel: "qaList",
  tombstoneKind: "qaList",
  currentTeam: currentQaListTeam,
  ensureQueryDataForTeam: ensureQaListsQueryDataForTeam,
  persistQueryDataForTeam: persistQaListsQueryDataForTeam,
  resetRename: resetQaListRename,
  resetPermanentDeletion: resetQaListPermanentDeletion,
  createRenameMutationOptions: ({ resource, ...options }) =>
    createQaListRenameMutationOptions({ ...options, qaList: resource }),
  createSoftDeleteMutationOptions: ({ resource, ...options }) =>
    createQaListSoftDeleteMutationOptions({ ...options, qaList: resource }),
  createRestoreMutationOptions: ({ resource, ...options }) =>
    createQaListRestoreMutationOptions({ ...options, qaList: resource }),
  createPermanentDeleteMutationOptions: ({ resource, ...options }) =>
    createQaListPermanentDeleteMutationOptions({ ...options, qaList: resource }),
  removeEditorQuery: removeQaListEditorQuery,
  makeDefaultIfFirst: (team, qaList) => makeQaListDefaultIfFirst(team, {
    ...qaList,
    lifecycleState: "active",
  }),
  updateDefaultAfterDeletion: updateDefaultQaListAfterDeletion,
  teamSupportsRepos: teamSupportsQaListRepos,
  repoBackedInput: repoBackedQaListInput,
  triggerRepoSync: triggerQaListRepoSync,
  writeMetadata: (team, record) => upsertQaListMetadataRecord(team, record, { requirePushSuccess: true }),
  buildMetadataRecord: qaListMetadataRecord,
  getActionBlockedMessage: qaListLifecycleActionBlockedMessage,
  ensureNotTombstoned: ensureQaListNotTombstoned,
  anyMutatingWriteIsActive: anyQaListMutatingWriteIsActive,
  commands: {
    rename: "rename_gtms_qa_list",
    softDelete: "soft_delete_gtms_qa_list",
    restore: "restore_gtms_qa_list",
    purge: "purge_local_gtms_qa_list_repo",
  },
  messages: {
    missing: "Could not find the selected QA list.",
    missingDeleted: "Could not find the selected deleted QA list.",
    emptyRename: "Enter a QA list name.",
    renameFallbackError: "Could not rename this QA list.",
    permanentDeleteFallbackError: "Could not permanently delete this QA list.",
    permanentConfirmation: "Enter the QA list name exactly to delete it.",
    writeBlocked: "Wait for the current QA list refresh or write to finish.",
    lifecycleWriteBlocked: "Wait for the current QA list write to finish.",
    renameActionLabel: "rename QA lists",
    deleteActionLabel: "delete QA lists",
    restoreActionLabel: "restore QA lists",
  },
});

export function toggleDeletedQaLists(render) {
  return qaListLifecycleFlow.toggleDeleted(render);
}

export function openQaListRename(render, qaListId) {
  return qaListLifecycleFlow.openRename(render, qaListId);
}

export function updateQaListRenameName(value) {
  return qaListLifecycleFlow.updateRenameName(value);
}

export function cancelQaListRename(render) {
  return qaListLifecycleFlow.cancelRename(render);
}

export function submitQaListRename(render) {
  return qaListLifecycleFlow.submitRename(render);
}

export function deleteQaList(render, qaListId) {
  return qaListLifecycleFlow.deleteResource(render, qaListId);
}

export function restoreQaList(render, qaListId) {
  return qaListLifecycleFlow.restoreResource(render, qaListId);
}

export function openQaListPermanentDeletion(render, qaListId) {
  return qaListLifecycleFlow.openPermanentDeletion(render, qaListId);
}

export function updateQaListPermanentDeletionConfirmation(value) {
  return qaListLifecycleFlow.updatePermanentDeletionConfirmation(value);
}

export function cancelQaListPermanentDeletion(render) {
  return qaListLifecycleFlow.cancelPermanentDeletion(render);
}

export function confirmQaListPermanentDeletion(render) {
  return qaListLifecycleFlow.confirmPermanentDeletion(render);
}
