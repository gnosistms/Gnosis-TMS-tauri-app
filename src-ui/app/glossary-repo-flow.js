import { invoke } from "./runtime.js";
import { normalizeGlossarySummary, sortGlossaries } from "./glossary-shared.js";
import { loadStoredGlossariesForTeam, saveStoredGlossariesForTeam } from "./glossary-cache.js";
import { removeGlossaryFromState } from "./glossary-top-level-state.js";
import { requireAppUpdate } from "./updater-flow.js";
import {
  listGlossaryMetadataRecords,
  listLocalGlossaryMetadataRecords,
  upsertGlossaryMetadataRecord,
} from "./team-metadata-flow.js";
import { createRepoResourceRepoFlow } from "./repo-resource/repo-flow.js";

function glossaryLanguageFields(value) {
  return {
    sourceLanguage: value?.sourceLanguage ?? null,
    targetLanguage: value?.targetLanguage ?? null,
  };
}

export function teamSupportsGlossaryRepos(team) {
  return Boolean(invoke)
    && Number.isFinite(team?.installationId)
    && typeof team?.githubOrg === "string"
    && team.githubOrg.trim();
}

export function normalizeRemoteGlossaryRepo(repo) {
  if (!repo || typeof repo !== "object") {
    return null;
  }

  const name =
    typeof repo.name === "string" && repo.name.trim()
      ? repo.name.trim()
      : null;
  const fullName =
    typeof repo.fullName === "string" && repo.fullName.trim()
      ? repo.fullName.trim()
      : null;
  if (!name || !fullName) {
    return null;
  }

  return {
    glossaryId:
      typeof repo.glossaryId === "string" && repo.glossaryId.trim()
        ? repo.glossaryId.trim()
        : typeof repo.id === "string" && repo.id.trim()
          ? repo.id.trim()
          : null,
    repoId: Number.isFinite(repo.repoId) ? repo.repoId : null,
    nodeId:
      typeof repo.nodeId === "string" && repo.nodeId.trim()
        ? repo.nodeId.trim()
        : null,
    name,
    fullName,
    htmlUrl:
      typeof repo.htmlUrl === "string" && repo.htmlUrl.trim()
        ? repo.htmlUrl.trim()
        : "",
    private: repo.private !== false,
    description:
      typeof repo.description === "string" && repo.description.trim()
        ? repo.description.trim()
        : "",
    defaultBranchName:
      typeof repo.defaultBranchName === "string" && repo.defaultBranchName.trim()
        ? repo.defaultBranchName.trim()
        : "main",
    defaultBranchHeadOid:
      typeof repo.defaultBranchHeadOid === "string" && repo.defaultBranchHeadOid.trim()
        ? repo.defaultBranchHeadOid.trim()
        : null,
    lifecycleState:
      typeof repo.lifecycleState === "string" && repo.lifecycleState.trim()
        ? repo.lifecycleState.trim()
        : "",
    recordState:
      typeof repo.recordState === "string" && repo.recordState.trim()
        ? repo.recordState.trim()
        : "",
    remoteState:
      typeof repo.remoteState === "string" && repo.remoteState.trim()
        ? repo.remoteState.trim()
        : "",
  };
}

function openRequiredAppUpdatePromptFromGlossarySnapshots(snapshots, render = null) {
  const requiredSnapshot = (Array.isArray(snapshots) ? snapshots : []).find(
    (snapshot) => snapshot?.status === "updateRequired",
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

const glossaryRepoFlow = createRepoResourceRepoFlow({
  kind: "glossary",
  collectionField: "glossaries",
  pageField: "glossariesPage",
  resourceIdField: "glossaryId",
  repoListPayloadField: "glossaries",
  defaultRepoBaseName: "glossary",
  createRepoTitlePrefix: "glossary",
  normalizeSummary: normalizeGlossarySummary,
  sortSummaries: sortGlossaries,
  loadStoredForTeam: loadStoredGlossariesForTeam,
  saveStoredForTeam: saveStoredGlossariesForTeam,
  removeFromState: removeGlossaryFromState,
  teamSupportsRepos: (team) => Number.isFinite(team?.installationId),
  normalizeRemoteRepo: normalizeRemoteGlossaryRepo,
  metadataFieldsFromResource: glossaryLanguageFields,
  metadataFieldsFromRecord: glossaryLanguageFields,
  languageFieldsForMerge: (localGlossary, record) => ({
    sourceLanguage: localGlossary?.sourceLanguage ?? record.sourceLanguage ?? null,
    targetLanguage: localGlossary?.targetLanguage ?? record.targetLanguage ?? null,
  }),
  resourceHasRequiredMetadata: (glossary) =>
    Boolean(glossary.sourceLanguage && glossary.targetLanguage),
  listMetadataRecords: listGlossaryMetadataRecords,
  listLocalMetadataRecords: listLocalGlossaryMetadataRecords,
  upsertMetadataRecord: upsertGlossaryMetadataRecord,
  afterSyncSnapshots: openRequiredAppUpdatePromptFromGlossarySnapshots,
  formatMetadataWarning: (message) =>
    String(message ?? "").startsWith("Glossary metadata could not be loaded")
      ? String(message ?? "")
      : `Glossary metadata could not be loaded from the local team-metadata repo. ${message}`,
  commands: {
    listRemote: "list_gnosis_glossaries_for_installation",
    sync: "sync_gtms_glossary_repos",
    listLocal: "list_local_gtms_glossaries",
    createRemote: "create_gnosis_glossary_repo",
    rollbackRemote: "rollback_created_gnosis_glossary_repo",
    purgeLocal: "purge_local_gtms_glossary_repo",
  },
  messages: {
    resourceLabel: "glossary",
    resourceLabelLower: "glossary",
    pluralLabelLower: "glossary repos",
    waitForRefresh: "Wait for the current glossary refresh or write to finish.",
    bindingRepaired: "The glossary repo binding was repaired.",
    rebuildingLocal: "Rebuilding the local glossary repo from metadata and GitHub...",
    unknownBrokerError: "Unknown glossary broker error.",
    newRepoMetadataError: "Could not determine the new glossary repo metadata.",
    noAvailableRepoName: "Could not determine an available glossary repo name.",
  },
  buildMetadataRecord(glossary, overrides = {}) {
    return {
      glossaryId: glossary.id ?? glossary.glossaryId,
      title: glossary.title,
      repoName: glossary.repoName,
      previousRepoNames: glossary.previousRepoNames ?? [],
      githubRepoId: glossary.repoId ?? null,
      githubNodeId: glossary.nodeId ?? null,
      fullName: glossary.fullName ?? null,
      defaultBranch: glossary.defaultBranchName ?? "main",
      lifecycleState: glossary.lifecycleState === "deleted" ? "deleted" : "active",
      remoteState: glossary.remoteState ?? "linked",
      recordState: glossary.recordState ?? "live",
      deletedAt: glossary.deletedAt ?? null,
      sourceLanguage: glossary.sourceLanguage ?? null,
      targetLanguage: glossary.targetLanguage ?? null,
      termCount: Number.isFinite(glossary.termCount) ? glossary.termCount : 0,
      ...overrides,
    };
  },
});

export function glossaryRepoDescriptor(glossary) {
  return glossaryRepoFlow.repoDescriptor(glossary);
}

export function getGlossarySyncIssueMessage(syncSnapshots) {
  return glossaryRepoFlow.getSyncIssueMessage(syncSnapshots);
}

export function listRemoteGlossaryReposForTeam(team) {
  return glossaryRepoFlow.listRemoteReposForTeam(team);
}

export function syncGlossaryReposForTeam(team, remoteRepos) {
  return glossaryRepoFlow.syncReposForTeam(team, remoteRepos);
}

export function listLocalGlossariesForTeam(team) {
  return glossaryRepoFlow.listLocalForTeam(team);
}

export function ensureGlossaryNotTombstoned(render, team, glossary, options = {}) {
  return glossaryRepoFlow.ensureNotTombstoned(render, team, glossary, options);
}

export function loadRepoBackedGlossariesForTeam(team, options = {}) {
  return glossaryRepoFlow.loadRepoBackedForTeam(team, options);
}

export function createRemoteGlossaryRepoWithName(team, repoName) {
  return glossaryRepoFlow.createRemoteRepoWithName(team, repoName);
}

export function permanentlyDeleteRemoteGlossaryRepoForTeam(team, repoName) {
  return glossaryRepoFlow.permanentlyDeleteRemoteRepoForTeam(team, repoName);
}

export function repairGlossaryRepoBinding(render, team, glossaryId) {
  return glossaryRepoFlow.repairRepoBinding(render, team, glossaryId);
}

export function rebuildGlossaryLocalRepo(render, team, glossaryId) {
  return glossaryRepoFlow.rebuildLocalRepo(render, team, glossaryId);
}

export function syncSingleGlossaryForTeam(team, glossary) {
  const descriptor = glossaryRepoDescriptor(glossary);
  return glossaryRepoFlow.syncSingleForTeam(team, descriptor
    ? {
        ...glossary,
        id: descriptor.glossaryId,
        glossaryId: descriptor.glossaryId,
        repoName: descriptor.repoName,
        fullName: descriptor.fullName,
        repoId: descriptor.repoId,
        defaultBranchName: descriptor.defaultBranchName,
        defaultBranchHeadOid: descriptor.defaultBranchHeadOid,
        lifecycleState: descriptor.lifecycleState,
        recordState: descriptor.recordState,
        remoteState: descriptor.remoteState,
      }
    : glossary);
}
