import { invoke } from "./runtime.js";
import { resetGlossaryCreation, state } from "./state.js";
import { clearNoticeBadge, showNoticeBadge } from "./status-feedback.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { findIsoLanguageOption } from "../lib/language-options.js";
import { openGlossaryEditor } from "./glossary-editor-flow.js";
import {
  canCreateGlossaries,
  selectedTeam,
} from "./glossary-shared.js";
import { openLocalFilePicker } from "./local-file-picker.js";
import {
  createRemoteGlossaryRepoForTeam,
  getGlossarySyncIssueMessage,
  listLocalGlossarySummariesForTeam,
  listRemoteGlossaryReposForTeam,
  permanentlyDeleteRemoteGlossaryRepoForTeam,
  syncGlossaryReposForTeam,
} from "./glossary-repo-flow.js";
import { appendRepoNameSuffix, slugifyRepoName } from "./repo-names.js";
import {
  deleteGlossaryMetadataRecord,
  inspectAndMigrateLocalRepoBindings,
  refreshGlossaryMetadataRecords,
  upsertGlossaryMetadataRecord,
} from "./team-metadata-flow.js";
import {
  openEntityFormModal,
  updateEntityFormField,
} from "./resource-entity-modal.js";
import {
  clearResourceCreateProgress,
  guardResourceCreateStart,
  showResourceCreateProgress,
} from "./resource-create-flow.js";
import {
  areResourcePageWritesDisabled,
  submitResourcePageWrite,
} from "./resource-page-controller.js";
import { loadTeamGlossaries } from "./glossary-discovery-flow.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";

export const GLOSSARY_IMPORT_ACCEPT = ".tmx,text/xml,application/xml";

export function detectGlossaryImportFileType(fileName) {
  const normalized = String(fileName || "").trim().toLowerCase();
  if (normalized.endsWith(".tmx")) {
    return "tmx";
  }
  return null;
}

function readableImportFileLike(value) {
  return value && typeof value === "object" && typeof value.arrayBuffer === "function";
}

function droppedPathFileLike(value) {
  return value && typeof value === "object" && typeof value.dataBase64 === "string";
}

function importFileName(value, fallback = "file") {
  const name = typeof value?.name === "string" ? value.name.trim() : "";
  return name || fallback;
}

function decodeBase64ToBytes(dataBase64) {
  const normalized = typeof dataBase64 === "string" ? dataBase64.trim() : "";
  if (!normalized) {
    throw new Error("The file could not be read.");
  }

  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(normalized);
    return Array.from(binary, (character) => character.charCodeAt(0));
  }

  if (typeof Buffer === "function") {
    return Array.from(Buffer.from(normalized, "base64"));
  }

  throw new Error("Base64 decoding is unavailable.");
}

async function importFileBytes(file) {
  if (readableImportFileLike(file)) {
    return Array.from(new Uint8Array(await file.arrayBuffer()));
  }

  if (droppedPathFileLike(file)) {
    return decodeBase64ToBytes(file.dataBase64);
  }

  throw new Error("The file could not be read.");
}

function glossaryImportModalState(overrides = {}) {
  return {
    ...state.glossaryImport,
    ...overrides,
  };
}

function setGlossaryImportError(render, message) {
  state.glossaryImport = glossaryImportModalState({
    status: "error",
    error: message,
  });
  render();
}

const glossaryPageSyncController = {
  begin: beginPageSync,
  complete: completePageSync,
  fail: failPageSync,
};

function setGlossariesPageProgress(render, text) {
  showNoticeBadge(text, render, null);
}

function remoteGlossaryRepoUrl(remoteRepo) {
  return typeof remoteRepo?.fullName === "string" && remoteRepo.fullName.trim()
    ? `https://github.com/${remoteRepo.fullName.trim()}.git`
    : "";
}

async function prepareLocalGlossaryRepo(team, remoteRepo, glossaryId = null) {
  await invoke("prepare_local_gtms_glossary_repo", {
    input: {
      installationId: team.installationId,
      glossaryId,
      repoName: remoteRepo.name,
      remoteUrl: remoteGlossaryRepoUrl(remoteRepo),
      defaultBranchName: remoteRepo.defaultBranchName || "main",
    },
  });
}

function linkedGlossaryMetadataRecord(glossary, remoteRepo) {
  return {
    glossaryId: glossary.id ?? glossary.glossaryId,
    title: glossary.title,
    repoName: remoteRepo.name,
    lifecycleState: glossary.lifecycleState === "deleted" ? "softDeleted" : "active",
    previousRepoNames:
      remoteRepo.name !== glossary.repoName ? [glossary.repoName] : [],
    recordState: "live",
    githubRepoId: remoteRepo.repoId ?? null,
    githubNodeId: remoteRepo.nodeId ?? null,
    fullName: remoteRepo.fullName ?? null,
    defaultBranch: remoteRepo.defaultBranchName || "main",
    remoteState: "linked",
    sourceLanguage: glossary.sourceLanguage ?? null,
    targetLanguage: glossary.targetLanguage ?? null,
    termCount: Number.isFinite(glossary.termCount) ? glossary.termCount : 0,
  };
}

function normalizedText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizedLanguageCode(language) {
  return normalizedText(language?.code).toLowerCase();
}

function languageMatches(actual, expected) {
  return normalizedLanguageCode(actual) === normalizedLanguageCode(expected);
}

function importedGlossarySafetyError(detail) {
  const error = new Error(`Glossary import did not finish safely. ${detail}`);
  error.code = "GLOSSARY_IMPORT_UNSAFE";
  return error;
}

function findImportedRemoteRepo(remoteRepos, expectedRemoteRepo) {
  const expectedRepoName = normalizedText(expectedRemoteRepo?.name);
  const expectedFullName = normalizedText(expectedRemoteRepo?.fullName);
  const expectedRepoId = Number.isFinite(expectedRemoteRepo?.repoId) ? expectedRemoteRepo.repoId : null;

  return (Array.isArray(remoteRepos) ? remoteRepos : []).find((repo) => {
    if (expectedRepoId !== null && Number.isFinite(repo?.repoId) && repo.repoId === expectedRepoId) {
      return true;
    }
    if (expectedFullName && normalizedText(repo?.fullName) === expectedFullName) {
      return true;
    }
    return expectedRepoName && normalizedText(repo?.name) === expectedRepoName;
  }) ?? null;
}

function repairIssueMatchesImportedGlossary(issue, expected) {
  if (issue?.kind !== "glossary") {
    return false;
  }

  const glossaryId = normalizedText(expected.glossaryId);
  const repoName = normalizedText(expected.repoName);
  return (
    (glossaryId && normalizedText(issue.resourceId) === glossaryId)
    || (repoName && normalizedText(issue.repoName) === repoName)
    || (repoName && normalizedText(issue.expectedRepoName) === repoName)
  );
}

export async function verifyImportedGlossaryState(team, expected, operations = {}) {
  const glossaryId = normalizedText(expected?.glossaryId);
  const repoName = normalizedText(expected?.repoName);
  const title = normalizedText(expected?.title);
  if (!glossaryId || !repoName || !title) {
    throw importedGlossarySafetyError("The imported glossary identity could not be verified.");
  }

  const listLocal = operations.listLocalGlossarySummariesForTeam ?? listLocalGlossarySummariesForTeam;
  const listRemote = operations.listRemoteGlossaryReposForTeam ?? listRemoteGlossaryReposForTeam;
  const refreshMetadata = operations.refreshGlossaryMetadataRecords ?? refreshGlossaryMetadataRecords;
  const inspectRepairs = operations.inspectAndMigrateLocalRepoBindings ?? inspectAndMigrateLocalRepoBindings;

  const localGlossaries = await listLocal(team);
  const localGlossary = (Array.isArray(localGlossaries) ? localGlossaries : []).find((glossary) =>
    normalizedText(glossary?.glossaryId ?? glossary?.id) === glossaryId
    || normalizedText(glossary?.repoName) === repoName
  );
  if (!localGlossary) {
    throw importedGlossarySafetyError("The local glossary repo could not be found after import.");
  }
  if (normalizedText(localGlossary.title) !== title) {
    throw importedGlossarySafetyError("The local glossary title does not match the imported file.");
  }
  if (normalizedText(localGlossary.lifecycleState) && normalizedText(localGlossary.lifecycleState) !== "active") {
    throw importedGlossarySafetyError("The local glossary repo is not active after import.");
  }
  if (!languageMatches(localGlossary.sourceLanguage, expected.sourceLanguage)) {
    throw importedGlossarySafetyError("The local glossary source language does not match the imported file.");
  }
  if (!languageMatches(localGlossary.targetLanguage, expected.targetLanguage)) {
    throw importedGlossarySafetyError("The local glossary target language does not match the imported file.");
  }
  if (
    Number.isFinite(expected.termCount)
    && Number.isFinite(localGlossary.termCount)
    && localGlossary.termCount !== expected.termCount
  ) {
    throw importedGlossarySafetyError("The local glossary term count does not match the imported file.");
  }

  const remoteRepos = await listRemote(team);
  const remoteRepo = findImportedRemoteRepo(remoteRepos, expected.remoteRepo);
  if (!remoteRepo) {
    throw importedGlossarySafetyError("The remote glossary repo could not be found after import.");
  }
  if (normalizedText(remoteRepo.name) !== repoName) {
    throw importedGlossarySafetyError("The remote glossary repo name does not match the imported glossary.");
  }
  if (
    normalizedText(expected.remoteRepo?.fullName)
    && normalizedText(remoteRepo.fullName)
    && normalizedText(remoteRepo.fullName) !== normalizedText(expected.remoteRepo.fullName)
  ) {
    throw importedGlossarySafetyError("The remote glossary repo full name does not match the imported glossary.");
  }
  if (
    Number.isFinite(expected.remoteRepo?.repoId)
    && Number.isFinite(remoteRepo.repoId)
    && remoteRepo.repoId !== expected.remoteRepo.repoId
  ) {
    throw importedGlossarySafetyError("The remote glossary repo id does not match the imported glossary.");
  }

  const metadataRecords = await refreshMetadata(team);
  const metadataRecord = (Array.isArray(metadataRecords) ? metadataRecords : []).find((record) =>
    normalizedText(record?.id) === glossaryId
  );
  if (!metadataRecord || metadataRecord.recordState !== "live") {
    throw importedGlossarySafetyError("The team metadata record could not be found after import.");
  }
  if (normalizedText(metadataRecord.repoName) !== normalizedText(remoteRepo.name)) {
    throw importedGlossarySafetyError("The team metadata record points at a different glossary repo.");
  }
  if (
    normalizedText(metadataRecord.fullName)
    && normalizedText(remoteRepo.fullName)
    && normalizedText(metadataRecord.fullName) !== normalizedText(remoteRepo.fullName)
  ) {
    throw importedGlossarySafetyError("The team metadata record points at a different GitHub repo.");
  }
  if (
    Number.isFinite(metadataRecord.githubRepoId)
    && Number.isFinite(remoteRepo.repoId)
    && metadataRecord.githubRepoId !== remoteRepo.repoId
  ) {
    throw importedGlossarySafetyError("The team metadata record has a different GitHub repo id.");
  }
  if (normalizedText(metadataRecord.title) !== title) {
    throw importedGlossarySafetyError("The team metadata title does not match the imported file.");
  }
  if (!languageMatches(metadataRecord.sourceLanguage, expected.sourceLanguage)) {
    throw importedGlossarySafetyError("The team metadata source language does not match the imported file.");
  }
  if (!languageMatches(metadataRecord.targetLanguage, expected.targetLanguage)) {
    throw importedGlossarySafetyError("The team metadata target language does not match the imported file.");
  }

  const repairIssues = (await inspectRepairs(team))?.issues ?? [];
  const matchingRepairIssue = repairIssues.find((issue) => repairIssueMatchesImportedGlossary(issue, {
    glossaryId,
    repoName,
  }));
  if (matchingRepairIssue) {
    throw importedGlossarySafetyError(matchingRepairIssue.message || "The imported glossary still needs local repo repair.");
  }
}

async function rollbackStrictGlossaryCreate(team, glossaryId, localRepoName, remoteRepoName = "") {
  let rollbackError = null;

  if (remoteRepoName) {
    try {
      await permanentlyDeleteRemoteGlossaryRepoForTeam(team, remoteRepoName);
    } catch (error) {
      rollbackError = error;
    }
  }

  if (localRepoName) {
    try {
      await invoke("purge_local_gtms_glossary_repo", {
        input: {
          installationId: team.installationId,
          glossaryId,
          repoName: localRepoName,
        },
      });
    } catch (error) {
      rollbackError ??= error;
    }
  }

  try {
    await deleteGlossaryMetadataRecord(team, glossaryId, { requirePushSuccess: true });
  } catch (error) {
    rollbackError ??= error;
  }

  if (rollbackError) {
    throw rollbackError;
  }
}

async function createRemoteGlossaryRepoForAvailableName(team, baseRepoName) {
  const localGlossaries = await listLocalGlossarySummariesForTeam(team);
  const usedRepoNames = new Set(
    (Array.isArray(localGlossaries) ? localGlossaries : [])
      .map((glossary) => String(glossary?.repoName ?? "").trim())
      .filter(Boolean),
  );

  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const candidateRepoName = appendRepoNameSuffix(baseRepoName, attempt);
    if (usedRepoNames.has(candidateRepoName)) {
      continue;
    }

    try {
      const remoteRepo = await createRemoteGlossaryRepoForTeam(team, candidateRepoName);
      return {
        remoteRepo,
        repoName: candidateRepoName,
        collisionResolved: attempt > 1,
      };
    } catch (error) {
      const message = String(error?.message ?? error ?? "").toLowerCase();
      if (!message.includes("name already exists on this account")) {
        throw error;
      }
    }
  }

  throw new Error("Could not determine an available repo name.");
}

async function completeGlossaryCreateSynchronously(team, input, render) {
  const glossaryId = crypto.randomUUID();
  let remoteRepo = null;
  let localRepoName = "";

  try {
    showResourceCreateProgress(render, "Creating GitHub repository...");
    const remoteCreateResult = await createRemoteGlossaryRepoForAvailableName(team, input.repoName);
    remoteRepo = remoteCreateResult.remoteRepo;
    localRepoName = remoteCreateResult.repoName;

    showResourceCreateProgress(render, "Preparing local glossary repo...");
    await invoke("prepare_local_gtms_glossary_repo", {
      input: {
        installationId: team.installationId,
        glossaryId,
        repoName: localRepoName,
      },
    });
    showResourceCreateProgress(render, "Initializing local glossary repo...");
    const glossary = await invoke("initialize_gtms_glossary_repo", {
      input: {
        installationId: team.installationId,
        repoName: localRepoName,
        glossaryId,
        title: input.title,
        sourceLanguageCode: input.sourceLanguage.code,
        sourceLanguageName: input.sourceLanguage.name,
        targetLanguageCode: input.targetLanguage.code,
        targetLanguageName: input.targetLanguage.name,
      },
    });

    const linkedGlossary = {
      ...glossary,
      repoName: remoteRepo.name,
      remoteState: "linked",
      resolutionState: "",
    };
    showResourceCreateProgress(render, "Saving team metadata...");
    await upsertGlossaryMetadataRecord(
      team,
      linkedGlossaryMetadataRecord(linkedGlossary, remoteRepo),
      { requirePushSuccess: true },
    );
    showResourceCreateProgress(render, "Linking local glossary repo...");
    await prepareLocalGlossaryRepo(team, remoteRepo, glossaryId);

    showResourceCreateProgress(render, "Syncing glossary repo...");
    const snapshots = await syncGlossaryReposForTeam(team, [remoteRepo]);
    const syncIssue = getGlossarySyncIssueMessage(snapshots);
    if (syncIssue?.message) {
      throw new Error(syncIssue.message);
    }

    return {
      glossaryId,
      title: input.title,
      finalRepoName: remoteRepo.name,
      localRepoName,
      localNameCollisionResolved: remoteCreateResult.collisionResolved,
    };
  } catch (error) {
    if (localRepoName || remoteRepo?.name) {
      try {
        await rollbackStrictGlossaryCreate(team, glossaryId, localRepoName, remoteRepo?.name ?? "");
      } catch (rollbackError) {
        throw new Error(
          `${error?.message ?? String(error)} Automatic glossary create rollback also failed: ${
            rollbackError?.message ?? String(rollbackError)
          }`,
        );
      }
    }
    throw error;
  }
}

async function reloadGlossariesAfterWrite(render, team, options = {}) {
  await loadTeamGlossaries(render, team.id, {
    preserveVisibleData: false,
    suppressRecoveryWarning: options.suppressRecoveryWarning === true,
  });
  return state.glossaries;
}

export function openGlossaryCreation(render) {
  const team = selectedTeam();
  if (areResourcePageWritesDisabled(state.glossariesPage)) {
    showNoticeBadge("Wait for the current glossary refresh or write to finish.", render);
    return;
  }
  if (!guardResourceCreateStart({
    installationReady: () => Number.isFinite(team?.installationId),
    offlineBlocked: () => state.offline?.isEnabled === true,
    canCreate: () => canCreateGlossaries(team),
    installationMessage: "Creating a glossary requires a GitHub App-connected team.",
    offlineMessage: "You cannot create glossaries while offline.",
    permissionMessage: "You do not have permission to create glossaries in this team.",
    onBlocked: (message) => {
      showNoticeBadge(message, render);
    },
  })) {
    return;
  }

  openEntityFormModal({
    setState: (nextState) => {
      state.glossaryCreation = nextState;
    },
    fields: {
      title: "",
      sourceLanguageCode: "",
      targetLanguageCode: "",
    },
  });
  render();
}

export function cancelGlossaryCreation(render) {
  resetGlossaryCreation();
  render();
}

export function updateGlossaryCreationField(field, value) {
  if (!state.glossaryCreation?.isOpen) {
    return;
  }

  updateEntityFormField(state.glossaryCreation, field, value);
}

export async function submitGlossaryCreation(render) {
  const team = selectedTeam();
  const draft = state.glossaryCreation;
  if (!draft?.isOpen) {
    return;
  }
  if (areResourcePageWritesDisabled(state.glossariesPage)) {
    state.glossaryCreation.error = "Wait for the current glossary refresh or write to finish.";
    render();
    return;
  }
  if (!guardResourceCreateStart({
    installationReady: () => Number.isFinite(team?.installationId),
    offlineBlocked: () => state.offline?.isEnabled === true,
    canCreate: () => canCreateGlossaries(team),
    installationMessage: "Creating a glossary requires a GitHub App-connected team.",
    offlineMessage: "You cannot create glossaries while offline.",
    permissionMessage: "You do not have permission to create glossaries in this team.",
    onBlocked: (message) => {
      state.glossaryCreation.error = message;
      render();
    },
  })) {
    return;
  }

  const title = String(draft.title ?? "").trim();
  const repoName = slugifyRepoName(title);
  const sourceLanguageCode = String(draft.sourceLanguageCode ?? "").trim().toLowerCase();
  const targetLanguageCode = String(draft.targetLanguageCode ?? "").trim().toLowerCase();
  const sourceLanguage = findIsoLanguageOption(sourceLanguageCode);
  const targetLanguage = findIsoLanguageOption(targetLanguageCode);

  if (!title) {
    state.glossaryCreation.error = "Enter a glossary name.";
    render();
    return;
  }

  if (!repoName) {
    state.glossaryCreation.error = "Glossary names must contain at least one letter or number.";
    render();
    return;
  }

  if (!sourceLanguage) {
    state.glossaryCreation.error = "Select a source language.";
    render();
    return;
  }

  if (!targetLanguage) {
    state.glossaryCreation.error = "Select a target language.";
    render();
    return;
  }

  state.glossaryCreation.status = "loading";
  state.glossaryCreation.error = "";
  render();
  await submitResourcePageWrite({
    pageState: state.glossariesPage,
    syncController: glossaryPageSyncController,
    setProgress: (text) => setGlossariesPageProgress(render, text),
    clearProgress: clearNoticeBadge,
    render,
    onBlocked: async () => {
      state.glossaryCreation.status = "idle";
      state.glossaryCreation.error = "Wait for the current glossary refresh or write to finish.";
      render();
    },
    runMutation: async () =>
      completeGlossaryCreateSynchronously(team, {
        title,
        repoName,
        sourceLanguage,
        targetLanguage,
      }, render),
    refreshOptions: {
      loadData: async () => {
        showResourceCreateProgress(render, "Refreshing glossary list...");
        return reloadGlossariesAfterWrite(render, team, { suppressRecoveryWarning: true });
      },
    },
    onSuccess: async (result) => {
      clearResourceCreateProgress();
      resetGlossaryCreation();
      state.selectedGlossaryId = result.glossaryId;
      const refreshedGlossary = state.glossaries.find((item) => item.id === result.glossaryId) ?? null;
      showNoticeBadge(
        result.localNameCollisionResolved
          ? `Created glossary ${result.title} in local repo ${result.localRepoName} because that name was already used locally.`
          : `Created glossary ${result.title}`,
        render,
      );
      await openGlossaryEditor(render, result.glossaryId, {
        preferredGlossary: refreshedGlossary,
      });
    },
    onError: async (error) => {
      clearResourceCreateProgress();
      if (await handleSyncFailure(classifySyncError(error), { render })) {
        return;
      }
      state.glossaryCreation.status = "idle";
      state.glossaryCreation.error = error?.message ?? String(error);
    },
  });
}

function canOpenGlossaryImport(render, team) {
  if (areResourcePageWritesDisabled(state.glossariesPage)) {
    showNoticeBadge("Wait for the current glossary refresh or write to finish.", render);
    return false;
  }
  if (!Number.isFinite(team?.installationId)) {
    showNoticeBadge("Importing a glossary requires a GitHub App-connected team.", render);
    return false;
  }

  if (state.offline?.isEnabled === true) {
    showNoticeBadge("You cannot import glossaries while offline.", render);
    return false;
  }

  if (!canCreateGlossaries(team)) {
    showNoticeBadge("You do not have permission to import glossaries in this team.", render);
    return false;
  }

  return true;
}

export function openGlossaryImportModal(render) {
  if (state.glossaryImport.status === "importing") {
    return;
  }

  const team = selectedTeam();
  if (!canOpenGlossaryImport(render, team)) {
    return;
  }

  state.glossaryImport = {
    ...state.glossaryImport,
    isOpen: true,
    status: "idle",
    error: "",
  };
  render();
}

export function cancelGlossaryImportModal(render) {
  if (state.glossaryImport.status === "importing") {
    return;
  }

  state.glossaryImport = {
    ...state.glossaryImport,
    isOpen: false,
    status: "idle",
    error: "",
  };
  render();
}

export async function importGlossaryFromTmx(render) {
  openGlossaryImportModal(render);
}

export async function selectGlossaryImportFile(render) {
  if (state.glossaryImport.status === "importing" || !state.glossaryImport.isOpen) {
    return;
  }

  const selectedFile = await openLocalFilePicker({
    accept: GLOSSARY_IMPORT_ACCEPT,
  });
  if (!selectedFile) {
    return;
  }

  await importGlossaryFile(render, selectedFile);
}

export async function importGlossaryFile(render, selectedFile) {
  if (state.glossaryImport.status === "importing") {
    return;
  }

  const team = selectedTeam();
  if (!canOpenGlossaryImport(render, team)) {
    return;
  }

  const sourceFileName = importFileName(selectedFile);
  const fileType = detectGlossaryImportFileType(sourceFileName);
  if (fileType !== "tmx") {
    setGlossaryImportError(
      render,
      `Unsupported file type for ${sourceFileName}. TMX is the only supported glossary import format right now.`,
    );
    return;
  }

  state.glossaryImport = glossaryImportModalState({
    status: "importing",
    error: "",
  });
  render();

  await submitResourcePageWrite({
    pageState: state.glossariesPage,
    syncController: glossaryPageSyncController,
    setProgress: (text) => setGlossariesPageProgress(render, text),
    clearProgress: clearNoticeBadge,
    render,
    onBlocked: async () => {
      showNoticeBadge("Wait for the current glossary refresh or write to finish.", render);
    },
    runMutation: async () => {
      const glossaryId = crypto.randomUUID();
      const bytes = await importFileBytes(selectedFile);
      showResourceCreateProgress(render, "Reading TMX file...");
      const importPreview = await invoke("inspect_tmx_glossary_import", {
        input: {
          fileName: sourceFileName,
          bytes,
        },
      });
      const repoName = slugifyRepoName(sourceFileName.replace(/\.[^.]+$/, "").trim());
      if (!repoName) {
        throw new Error("Could not determine a glossary repo name from this import file.");
      }

      let remoteRepo = null;
      let localRepoName = "";
      try {
        showResourceCreateProgress(render, "Creating GitHub repository...");
        const remoteCreateResult = await createRemoteGlossaryRepoForAvailableName(team, repoName);
        remoteRepo = remoteCreateResult.remoteRepo;
        localRepoName = remoteCreateResult.repoName;

        showResourceCreateProgress(render, "Preparing local glossary repo...");
        await invoke("prepare_local_gtms_glossary_repo", {
          input: {
            installationId: team.installationId,
            glossaryId,
            repoName: localRepoName,
          },
        });
        showResourceCreateProgress(render, "Importing TMX into local glossary repo...");
        const glossary = await invoke("import_tmx_to_gtms_glossary_repo", {
          input: {
            installationId: team.installationId,
            repoName: localRepoName,
            glossaryId,
            fileName: sourceFileName,
            bytes,
          },
        });

        const linkedGlossary = {
          ...glossary,
          repoName: remoteRepo.name,
          remoteState: "linked",
          resolutionState: "",
        };
        showResourceCreateProgress(render, "Saving team metadata...");
        await upsertGlossaryMetadataRecord(
          team,
          linkedGlossaryMetadataRecord(linkedGlossary, remoteRepo),
          { requirePushSuccess: true },
        );
        showResourceCreateProgress(render, "Linking local glossary repo...");
        await prepareLocalGlossaryRepo(team, remoteRepo, glossaryId);

        showResourceCreateProgress(render, "Syncing glossary repo...");
        const snapshots = await syncGlossaryReposForTeam(team, [remoteRepo]);
        const syncIssue = getGlossarySyncIssueMessage(snapshots);
        if (syncIssue?.message) {
          throw new Error(syncIssue.message);
        }

        showResourceCreateProgress(render, "Verifying glossary import...");
        await verifyImportedGlossaryState(team, {
          glossaryId,
          repoName: remoteRepo.name,
          remoteRepo,
          title: glossary.title,
          sourceLanguage: glossary.sourceLanguage,
          targetLanguage: glossary.targetLanguage,
          termCount: Number.isFinite(glossary.termCount) ? glossary.termCount : 0,
        });

        return {
          glossaryId,
          title: glossary.title,
          termCount: Number.isFinite(glossary.termCount) ? glossary.termCount : 0,
          localRepoName,
          localNameCollisionResolved: remoteCreateResult.collisionResolved,
          fileName: sourceFileName,
        };
      } catch (error) {
        if (localRepoName || remoteRepo?.name) {
          try {
            await rollbackStrictGlossaryCreate(team, glossaryId, localRepoName, remoteRepo?.name ?? "");
          } catch (rollbackError) {
            throw new Error(
              `${error?.message ?? String(error)} Automatic glossary import rollback also failed: ${
                rollbackError?.message ?? String(rollbackError)
              }`,
            );
          }
        }
        if (error?.code === "GLOSSARY_IMPORT_UNSAFE") {
          throw new Error(`${error.message} The partially created glossary was rolled back.`);
        }
        throw error;
      }
    },
    refreshOptions: {
      loadData: async () => {
        showResourceCreateProgress(render, "Refreshing glossary list...");
        return reloadGlossariesAfterWrite(render, team, { suppressRecoveryWarning: true });
      },
    },
    onSuccess: async (result) => {
      clearResourceCreateProgress();
      state.glossaryImport = {
        ...state.glossaryImport,
        isOpen: false,
        status: "ready",
        error: "",
      };
      state.selectedGlossaryId = result.glossaryId;
      const refreshedGlossary = state.glossaries.find((item) => item.id === result.glossaryId) ?? null;
      showNoticeBadge(
        result.localNameCollisionResolved
          ? `Imported ${result.termCount} terms from ${result.fileName} into ${result.title} in local repo ${result.localRepoName} because that name was already used locally.`
          : `Imported ${result.termCount} terms from ${result.fileName} into ${result.title}`,
        render,
      );
      await openGlossaryEditor(render, result.glossaryId, { preferredGlossary: refreshedGlossary });
    },
    onError: async (error) => {
      clearResourceCreateProgress();
      state.glossaryImport = glossaryImportModalState({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      render();
      if (await handleSyncFailure(classifySyncError(error), { render })) {
        return;
      }
      showNoticeBadge(error?.message ?? String(error), render);
    },
  });
}

export async function handleDroppedGlossaryImportFile(render, file) {
  if (!state.glossaryImport.isOpen || state.glossaryImport.status === "importing") {
    return;
  }

  await importGlossaryFile(render, file);
}

export async function handleDroppedGlossaryImportPath(render, path) {
  const normalizedPath = typeof path === "string" ? path.trim() : "";
  if (!normalizedPath || !state.glossaryImport.isOpen || state.glossaryImport.status === "importing") {
    return;
  }

  try {
    const file = await invoke("read_local_dropped_file", { path: normalizedPath });
    await importGlossaryFile(render, {
      name: typeof file?.name === "string" ? file.name : "",
      type: typeof file?.mimeType === "string" ? file.mimeType : "",
      dataBase64: typeof file?.dataBase64 === "string" ? file.dataBase64 : "",
    });
  } catch (error) {
    setGlossaryImportError(render, error instanceof Error ? error.message : String(error));
  }
}
