import {
  resetGlossaryPermanentDeletion,
  resetGlossaryRename,
  state,
} from "./state.js";
import {
  createGlossaryPermanentDeleteMutationOptions,
  createGlossaryRenameMutationOptions,
  createGlossaryRestoreMutationOptions,
  createGlossarySoftDeleteMutationOptions,
  persistGlossariesQueryDataForTeam,
} from "./glossary-query.js";
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
import { anyGlossaryMutatingWriteIsActive } from "./glossary-write-coordinator.js";
import { upsertGlossaryMetadataRecord } from "./team-metadata-flow.js";
import { createRepoResourceLifecycleFlow } from "./repo-resource/lifecycle-flow.js";

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

const glossaryLifecycleFlow = createRepoResourceLifecycleFlow({
  collectionField: "glossaries",
  selectedIdField: "selectedGlossaryId",
  pageField: "glossariesPage",
  editorField: "glossaryEditor",
  renameField: "glossaryRename",
  permanentDeletionField: "glossaryPermanentDeletion",
  showDeletedField: "showDeletedGlossaries",
  resourceIdField: "glossaryId",
  nameField: "glossaryName",
  resourceLabel: "glossary",
  tombstoneKind: "glossary",
  currentTeam: currentGlossaryTeam,
  ensureQueryDataForTeam: ensureGlossariesQueryDataForTeam,
  persistQueryDataForTeam: persistGlossariesQueryDataForTeam,
  resetRename: resetGlossaryRename,
  resetPermanentDeletion: resetGlossaryPermanentDeletion,
  createRenameMutationOptions: ({ resource, ...options }) =>
    createGlossaryRenameMutationOptions({ ...options, glossary: resource }),
  createSoftDeleteMutationOptions: ({ resource, ...options }) =>
    createGlossarySoftDeleteMutationOptions({ ...options, glossary: resource }),
  createRestoreMutationOptions: ({ resource, ...options }) =>
    createGlossaryRestoreMutationOptions({ ...options, glossary: resource }),
  createPermanentDeleteMutationOptions: ({ resource, ...options }) =>
    createGlossaryPermanentDeleteMutationOptions({ ...options, glossary: resource }),
  removeEditorQuery: removeGlossaryEditorQuery,
  makeDefaultIfFirst: (team, glossary) => makeGlossaryDefaultIfFirst(team, glossary?.id),
  updateDefaultAfterDeletion: (team, glossary) => updateDefaultGlossaryAfterDeletion(team, glossary?.id),
  teamSupportsRepos: teamSupportsGlossaryRepos,
  repoBackedInput: repoBackedGlossaryInput,
  triggerRepoSync: triggerGlossaryRepoSync,
  writeMetadata: (team, record) => upsertGlossaryMetadataRecord(team, record, { requirePushSuccess: true }),
  buildMetadataRecord: glossaryMetadataRecord,
  getActionBlockedMessage: glossaryLifecycleActionBlockedMessage,
  ensureNotTombstoned: ensureGlossaryNotTombstoned,
  anyMutatingWriteIsActive: anyGlossaryMutatingWriteIsActive,
  commands: {
    rename: "rename_gtms_glossary",
    softDelete: "soft_delete_gtms_glossary",
    restore: "restore_gtms_glossary",
    purge: "purge_local_gtms_glossary_repo",
  },
  messages: {
    missing: "Could not find the selected glossary.",
    missingDeleted: "Could not find the selected deleted glossary.",
    emptyRename: "Enter a glossary name.",
    renameFallbackError: "Could not rename this glossary.",
    permanentDeleteFallbackError: "Could not permanently delete this glossary.",
    permanentConfirmation: "Enter the glossary name exactly to delete it.",
    writeBlocked: "Wait for the current glossary refresh or write to finish.",
    lifecycleWriteBlocked: "Wait for the current glossary write to finish.",
    renameActionLabel: "rename glossaries",
    deleteActionLabel: "delete glossaries",
    restoreActionLabel: "restore glossaries",
  },
  renameErrorState: ({ error, resource, title }) => ({
    isOpen: true,
    glossaryId: resource.id,
    glossaryName: title,
    status: "idle",
    error: error?.message ?? String(error),
  }),
});

export function toggleDeletedGlossaries(render) {
  return glossaryLifecycleFlow.toggleDeleted(render);
}

export function openGlossaryRename(render, glossaryId) {
  return glossaryLifecycleFlow.openRename(render, glossaryId);
}

export function updateGlossaryRenameName(value) {
  return glossaryLifecycleFlow.updateRenameName(value);
}

export function cancelGlossaryRename(render) {
  return glossaryLifecycleFlow.cancelRename(render);
}

export function submitGlossaryRename(render) {
  return glossaryLifecycleFlow.submitRename(render);
}

export function deleteGlossary(render, glossaryId) {
  return glossaryLifecycleFlow.deleteResource(render, glossaryId);
}

export function restoreGlossary(render, glossaryId) {
  return glossaryLifecycleFlow.restoreResource(render, glossaryId);
}

export function openGlossaryPermanentDeletion(render, glossaryId) {
  return glossaryLifecycleFlow.openPermanentDeletion(render, glossaryId);
}

export function updateGlossaryPermanentDeletionConfirmation(value) {
  return glossaryLifecycleFlow.updatePermanentDeletionConfirmation(value);
}

export function cancelGlossaryPermanentDeletion(render) {
  return glossaryLifecycleFlow.cancelPermanentDeletion(render);
}

export function confirmGlossaryPermanentDeletion(render) {
  return glossaryLifecycleFlow.confirmPermanentDeletion(render);
}
