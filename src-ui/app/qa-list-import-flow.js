import { findIsoLanguageOption, normalizeSupportedLanguageCode } from "../lib/language-options.js";
import { appendRepoNameSuffix, slugifyRepoName } from "./repo-names.js";
import { invoke } from "./runtime.js";
import {
  resetQaListCreation,
  state,
} from "./state.js";
import { clearNoticeBadge, showNoticeBadge } from "./status-feedback.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import {
  createRemoteQaListRepo,
  createRemoteQaListRepoWithName,
  deleteRemoteQaListRepo,
  listLocalQaListsForTeam,
  listRemoteQaListReposForTeam,
  prepareLocalQaListRepo,
  teamSupportsQaListRepos,
} from "./qa-list-repo-flow.js";
import {
  canCreateQaLists,
  normalizeQaList,
} from "./qa-list-shared.js";
import {
  createQaResourceId,
  currentQaListTeam,
  qaListCreationRollbackMessage,
  selectedQaListTeamMatches,
  syncSingleQaListOrThrow,
  upsertQaListForTeam,
} from "./qa-list-top-level-state.js";
import { makeQaListDefaultIfFirst } from "./qa-list-default-flow.js";
import { loadTeamQaLists } from "./qa-list-discovery-flow.js";
import {
  guardResourceCreateStart,
  showResourceCreateProgress,
} from "./resource-create-flow.js";
import {
  areResourcePageWritesDisabled,
} from "./resource-page-controller.js";
import {
  openEntityFormModal,
  updateEntityFormField,
} from "./resource-entity-modal.js";
import {
  createRepoResourceImportFlow,
  importFileBytes,
  importFileName,
} from "./repo-resource/import-flow.js";

export const QA_LIST_IMPORT_ACCEPT = ".tmx,text/xml,application/xml";

export function detectQaListImportFileType(fileName) {
  const normalized = String(fileName || "").trim().toLowerCase();
  if (normalized.endsWith(".tmx")) {
    return "tmx";
  }
  return null;
}

function qaListImportModalState(overrides = {}) {
  return {
    ...state.qaListImport,
    ...overrides,
  };
}

function setQaListImportError(render, message) {
  state.qaListImport = qaListImportModalState({
    status: "error",
    error: message,
  });
  render();
}

const qaListsPageSyncController = {
  begin: beginPageSync,
  complete: completePageSync,
  fail: failPageSync,
};

function setQaListsPageProgress(render, text) {
  showNoticeBadge(text, render, null);
}

function remoteQaListRepoUrl(remoteRepo) {
  return typeof remoteRepo?.fullName === "string" && remoteRepo.fullName.trim()
    ? `https://github.com/${remoteRepo.fullName.trim()}.git`
    : "";
}

async function prepareLinkedLocalQaListRepo(team, remoteRepo, qaListId = null) {
  await prepareLocalQaListRepo(team, {
    ...remoteRepo,
    fullName: remoteRepo?.fullName ?? "",
    remoteUrl: remoteQaListRepoUrl(remoteRepo),
  }, qaListId);
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

function importedQaListSafetyError(detail) {
  const error = new Error(`QA list import did not finish safely. ${detail}`);
  error.code = "QA_LIST_IMPORT_UNSAFE";
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

export async function verifyImportedQaListState(team, expected, operations = {}) {
  const qaListId = normalizedText(expected?.qaListId);
  const repoName = normalizedText(expected?.repoName);
  const title = normalizedText(expected?.title);
  if (!qaListId || !repoName || !title) {
    throw importedQaListSafetyError("The imported QA list identity could not be verified.");
  }

  const listLocal = operations.listLocalQaListsForTeam ?? listLocalQaListsForTeam;
  const listRemote = operations.listRemoteQaListReposForTeam ?? listRemoteQaListReposForTeam;
  const localQaLists = await listLocal(team);
  const localQaList = (Array.isArray(localQaLists) ? localQaLists : []).find((qaList) =>
    normalizedText(qaList?.qaListId ?? qaList?.id) === qaListId
    || normalizedText(qaList?.repoName) === repoName
  );
  if (!localQaList) {
    throw importedQaListSafetyError("The local QA list repo could not be found after import.");
  }
  if (normalizedText(localQaList.title) !== title) {
    throw importedQaListSafetyError("The local QA list title does not match the imported file.");
  }
  if (normalizedText(localQaList.lifecycleState) && normalizedText(localQaList.lifecycleState) !== "active") {
    throw importedQaListSafetyError("The local QA list repo is not active after import.");
  }
  if (!languageMatches(localQaList.language, expected.language)) {
    throw importedQaListSafetyError("The local QA list language does not match the imported file.");
  }
  if (
    Number.isFinite(expected.termCount)
    && Number.isFinite(localQaList.termCount)
    && localQaList.termCount !== expected.termCount
  ) {
    throw importedQaListSafetyError("The local QA list term count does not match the imported file.");
  }

  const remoteRepos = await listRemote(team);
  const remoteRepo = findImportedRemoteRepo(remoteRepos, expected.remoteRepo);
  if (!remoteRepo) {
    throw importedQaListSafetyError("The remote QA list repo could not be found after import.");
  }
  if (normalizedText(remoteRepo.name) !== repoName) {
    throw importedQaListSafetyError("The remote QA list repo name does not match the imported QA list.");
  }
}

async function rollbackStrictQaListCreate(team, qaListId, localRepoName, remoteRepoName = "") {
  let rollbackError = null;

  if (remoteRepoName) {
    try {
      await deleteRemoteQaListRepo(team, { repoName: remoteRepoName });
    } catch (error) {
      rollbackError = error;
    }
  }

  if (localRepoName) {
    try {
      await invoke("purge_local_gtms_qa_list_repo", {
        input: {
          installationId: team.installationId,
          qaListId,
          repoName: localRepoName,
        },
      });
    } catch (error) {
      rollbackError ??= error;
    }
  }

  if (rollbackError) {
    throw rollbackError;
  }
}

async function createRemoteQaListRepoForAvailableName(team, baseRepoName) {
  const localQaLists = await listLocalQaListsForTeam(team);
  const usedRepoNames = new Set(
    (Array.isArray(localQaLists) ? localQaLists : [])
      .map((qaList) => String(qaList?.repoName ?? "").trim())
      .filter(Boolean),
  );

  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const candidateRepoName = appendRepoNameSuffix(baseRepoName, attempt);
    if (usedRepoNames.has(candidateRepoName)) {
      continue;
    }

    try {
      const remoteRepo = await createRemoteQaListRepoWithName(team, candidateRepoName);
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

async function completeQaListCreateSynchronously(team, input, render) {
  const qaListId = globalThis.crypto?.randomUUID?.() ?? createQaResourceId("qa-list");
  let remoteRepo = null;
  let localRepoName = "";

  try {
    showResourceCreateProgress(render, "Creating GitHub repository...");
    const remoteCreateResult = await createRemoteQaListRepoForAvailableName(team, input.repoName);
    remoteRepo = remoteCreateResult.remoteRepo;
    localRepoName = remoteCreateResult.repoName;

    showResourceCreateProgress(render, "Preparing local QA list repo...");
    await prepareLocalQaListRepo(team, remoteRepo, qaListId);
    showResourceCreateProgress(render, "Initializing local QA list repo...");
    const qaList = await invoke("initialize_gtms_qa_list_repo", {
      input: {
        installationId: team.installationId,
        repoName: localRepoName,
        qaListId,
        title: input.title,
        languageCode: input.language.code,
        languageName: input.language.name,
      },
    });

    const linkedQaList = normalizeQaList({
      ...qaList,
      repoName: remoteRepo.name,
      repoId: remoteRepo.repoId ?? null,
      nodeId: remoteRepo.nodeId ?? null,
      fullName: remoteRepo.fullName ?? null,
      htmlUrl: remoteRepo.htmlUrl ?? "",
      defaultBranchName: remoteRepo.defaultBranchName ?? "main",
      defaultBranchHeadOid: remoteRepo.defaultBranchHeadOid ?? null,
      remoteState: "linked",
      resolutionState: "",
    });

    showResourceCreateProgress(render, "Linking local QA list repo...");
    await prepareLinkedLocalQaListRepo(team, remoteRepo, qaListId);

    showResourceCreateProgress(render, "Syncing QA list repo...");
    await syncSingleQaListOrThrow(team, linkedQaList);

    return {
      qaListId,
      title: input.title,
      finalRepoName: remoteRepo.name,
      localRepoName,
      localNameCollisionResolved: remoteCreateResult.collisionResolved,
      qaList: linkedQaList,
    };
  } catch (error) {
    if (localRepoName || remoteRepo?.name) {
      try {
        await rollbackStrictQaListCreate(team, qaListId, localRepoName, remoteRepo?.name ?? "");
      } catch (rollbackError) {
        throw new Error(qaListCreationRollbackMessage(error, rollbackError));
      }
    }
    throw error;
  }
}

async function reloadQaListsAfterWrite(render, team) {
  await loadTeamQaLists(render, team.id, {
    preserveVisibleData: false,
  });
  return state.qaLists;
}

const qaListImportFlow = createRepoResourceImportFlow({
  accept: QA_LIST_IMPORT_ACCEPT,
  pageState: () => state.qaListsPage,
  syncController: qaListsPageSyncController,
  setProgress: setQaListsPageProgress,
  clearProgress: clearNoticeBadge,
  isImportModalOpen: () => state.qaListImport.isOpen,
  isImporting: () => state.qaListImport.status === "importing",
  importFile: importQaListFile,
  setImportError: setQaListImportError,
  selectedTeamMatches: selectedQaListTeamMatches,
  upsertForTeam: upsertQaListForTeam,
  resultResourceField: "qaList",
});

export function openQaListCreation(render) {
  const team = currentQaListTeam();
  if (areResourcePageWritesDisabled(state.qaListsPage)) {
    showNoticeBadge("Wait for the current QA list refresh or write to finish.", render);
    return;
  }
  if (!guardResourceCreateStart({
    installationReady: () => Number.isFinite(team?.installationId) && teamSupportsQaListRepos(team),
    offlineBlocked: () => state.offline?.isEnabled === true,
    canCreate: () => canCreateQaLists(team),
    installationMessage: "Creating a QA list requires a GitHub App-connected team.",
    offlineMessage: "You cannot create QA lists while offline.",
    permissionMessage: "You do not have permission to create QA lists in this team.",
    onBlocked: (message) => {
      showNoticeBadge(message, render);
    },
  })) {
    return;
  }

  openEntityFormModal({
    setState: (nextState) => {
      state.qaListCreation = nextState;
    },
    fields: {
      title: "",
      languageCode: "",
    },
  });
  render();
}

export function cancelQaListCreation(render) {
  resetQaListCreation();
  render();
}

export function updateQaListCreationField(field, value) {
  if (!state.qaListCreation?.isOpen || (field !== "title" && field !== "languageCode")) {
    return;
  }

  updateEntityFormField(state.qaListCreation, field, value);
}

export async function submitQaListCreation(render) {
  const team = currentQaListTeam();
  const draft = state.qaListCreation;
  if (!draft?.isOpen) {
    return;
  }
  if (areResourcePageWritesDisabled(state.qaListsPage)) {
    state.qaListCreation.error = "Wait for the current QA list refresh or write to finish.";
    render();
    return;
  }
  if (!guardResourceCreateStart({
    installationReady: () => Number.isFinite(team?.installationId) && teamSupportsQaListRepos(team),
    offlineBlocked: () => state.offline?.isEnabled === true,
    canCreate: () => canCreateQaLists(team),
    installationMessage: "Creating a QA list requires a GitHub App-connected team.",
    offlineMessage: "You cannot create QA lists while offline.",
    permissionMessage: "You do not have permission to create QA lists in this team.",
    onBlocked: (message) => {
      state.qaListCreation.error = message;
      render();
    },
  })) {
    return;
  }

  const title = String(draft.title ?? "").trim();
  const repoName = slugifyRepoName(`qa-list-${title}`);
  const languageCode = normalizeSupportedLanguageCode(draft.languageCode);
  const language = findIsoLanguageOption(languageCode);

  if (!title) {
    state.qaListCreation.error = "Enter a QA list name.";
    render();
    return;
  }
  if (!repoName) {
    state.qaListCreation.error = "QA list names must contain at least one letter or number.";
    render();
    return;
  }
  if (!language) {
    state.qaListCreation.error = "Choose a language.";
    render();
    return;
  }

  state.qaListCreation.status = "loading";
  state.qaListCreation.error = "";
  render();
  await qaListImportFlow.submitImportWrite(render, {
    onBlocked: async () => {
      state.qaListCreation.status = "idle";
      state.qaListCreation.error = "Wait for the current QA list refresh or write to finish.";
      render();
    },
    runMutation: async () =>
      completeQaListCreateSynchronously(team, {
        title,
        repoName,
        language,
      }, render),
    refreshProgressText: "Refreshing QA list...",
    loadData: async () => reloadQaListsAfterWrite(render, team),
    onSuccess: async (result) => {
      resetQaListCreation();
      if (qaListImportFlow.upsertCreatedResourceForTeam(team, result)) {
        makeQaListDefaultIfFirst(team, result.qaList);
      }
      showNoticeBadge(
        result.localNameCollisionResolved
          ? `Created QA list ${result.title} in local repo ${result.localRepoName} because that name was already used locally.`
          : `Created QA list ${result.title}`,
        render,
      );
    },
    onError: async (error) => {
      state.qaListCreation.status = "idle";
      state.qaListCreation.error = error?.message ?? String(error);
    },
  });
}

function canOpenQaListImport(render, team) {
  if (areResourcePageWritesDisabled(state.qaListsPage)) {
    showNoticeBadge("Wait for the current QA list refresh or write to finish.", render);
    return false;
  }
  if (!Number.isFinite(team?.installationId) || !teamSupportsQaListRepos(team)) {
    showNoticeBadge("Importing a QA list requires a GitHub App-connected team.", render);
    return false;
  }
  if (state.offline?.isEnabled === true) {
    showNoticeBadge("You cannot import QA lists while offline.", render);
    return false;
  }
  if (!canCreateQaLists(team)) {
    showNoticeBadge("You do not have permission to import QA lists in this team.", render);
    return false;
  }

  return true;
}

export function openQaListImportModal(render) {
  if (state.qaListImport.status === "importing") {
    return;
  }

  const team = currentQaListTeam();
  if (!canOpenQaListImport(render, team)) {
    return;
  }

  state.qaListImport = {
    ...state.qaListImport,
    isOpen: true,
    status: "idle",
    error: "",
  };
  render();
}

export function cancelQaListImportModal(render) {
  if (state.qaListImport.status === "importing") {
    return;
  }

  state.qaListImport = {
    ...state.qaListImport,
    isOpen: false,
    status: "idle",
    error: "",
  };
  render();
}

export async function importQaListFromTmx(render) {
  openQaListImportModal(render);
}

export async function selectQaListImportFile(render) {
  if (state.qaListImport.status === "importing" || !state.qaListImport.isOpen) {
    return;
  }

  await qaListImportFlow.selectImportFile(render);
}

export async function importQaListFile(render, selectedFile) {
  if (state.qaListImport.status === "importing") {
    return;
  }

  const team = currentQaListTeam();
  if (!canOpenQaListImport(render, team)) {
    return;
  }

  const sourceFileName = importFileName(selectedFile);
  const fileType = detectQaListImportFileType(sourceFileName);
  if (fileType !== "tmx") {
    setQaListImportError(
      render,
      `Unsupported file type for ${sourceFileName}. TMX is the only supported QA list import format right now.`,
    );
    return;
  }

  state.qaListImport = qaListImportModalState({
    status: "importing",
    error: "",
  });
  render();

  await qaListImportFlow.submitImportWrite(render, {
    onBlocked: async () => {
      showNoticeBadge("Wait for the current QA list refresh or write to finish.", render);
    },
    runMutation: async () => {
      const qaListId = globalThis.crypto?.randomUUID?.() ?? createQaResourceId("qa-list");
      const bytes = await importFileBytes(selectedFile);
      showResourceCreateProgress(render, "Reading TMX file...");
      const importPreview = await invoke("inspect_tmx_qa_list_import", {
        input: {
          fileName: sourceFileName,
          bytes,
        },
      });
      const repoName = slugifyRepoName(`qa-list-${sourceFileName.replace(/\.[^.]+$/, "").trim()}`);
      if (!repoName) {
        throw new Error("Could not determine a QA list repo name from this import file.");
      }

      let remoteRepo = null;
      let localRepoName = "";
      try {
        showResourceCreateProgress(render, "Creating GitHub repository...");
        const remoteCreateResult = await createRemoteQaListRepoForAvailableName(team, repoName);
        remoteRepo = remoteCreateResult.remoteRepo;
        localRepoName = remoteCreateResult.repoName;

        showResourceCreateProgress(render, "Preparing local QA list repo...");
        await prepareLocalQaListRepo(team, remoteRepo, qaListId);
        showResourceCreateProgress(render, "Importing TMX into local QA list repo...");
        const qaList = await invoke("import_tmx_to_gtms_qa_list_repo", {
          input: {
            installationId: team.installationId,
            repoName: localRepoName,
            qaListId,
            fileName: sourceFileName,
            bytes,
          },
        });

        const linkedQaList = normalizeQaList({
          ...qaList,
          repoName: remoteRepo.name,
          repoId: remoteRepo.repoId ?? null,
          nodeId: remoteRepo.nodeId ?? null,
          fullName: remoteRepo.fullName ?? null,
          htmlUrl: remoteRepo.htmlUrl ?? "",
          defaultBranchName: remoteRepo.defaultBranchName ?? "main",
          defaultBranchHeadOid: remoteRepo.defaultBranchHeadOid ?? null,
          remoteState: "linked",
          resolutionState: "",
        });
        showResourceCreateProgress(render, "Linking local QA list repo...");
        await prepareLinkedLocalQaListRepo(team, remoteRepo, qaListId);

        showResourceCreateProgress(render, "Syncing QA list repo...");
        await syncSingleQaListOrThrow(team, linkedQaList);

        showResourceCreateProgress(render, "Verifying QA list import...");
        await verifyImportedQaListState(team, {
          qaListId,
          repoName: remoteRepo.name,
          remoteRepo,
          title: linkedQaList.title,
          language: linkedQaList.language ?? importPreview.language,
          termCount: Number.isFinite(linkedQaList.termCount) ? linkedQaList.termCount : 0,
        });

        return {
          qaListId,
          title: linkedQaList.title,
          termCount: Number.isFinite(linkedQaList.termCount) ? linkedQaList.termCount : 0,
          localRepoName,
          localNameCollisionResolved: remoteCreateResult.collisionResolved,
          fileName: sourceFileName,
          qaList: linkedQaList,
        };
      } catch (error) {
        if (localRepoName || remoteRepo?.name) {
          try {
            await rollbackStrictQaListCreate(team, qaListId, localRepoName, remoteRepo?.name ?? "");
          } catch (rollbackError) {
            throw new Error(qaListCreationRollbackMessage(error, rollbackError));
          }
        }
        if (error?.code === "QA_LIST_IMPORT_UNSAFE") {
          throw new Error(`${error.message} The partially created QA list was rolled back.`);
        }
        throw error;
      }
    },
    refreshProgressText: "Refreshing QA list...",
    loadData: async () => reloadQaListsAfterWrite(render, team),
    onSuccess: async (result) => {
      state.qaListImport = {
        ...state.qaListImport,
        isOpen: false,
        status: "ready",
        error: "",
      };
      if (qaListImportFlow.upsertCreatedResourceForTeam(team, result)) {
        makeQaListDefaultIfFirst(team, result.qaList);
      }
      showNoticeBadge(
        result.localNameCollisionResolved
          ? `Imported ${result.termCount} QA terms from ${result.fileName} into ${result.title} in local repo ${result.localRepoName} because that name was already used locally.`
          : `Imported ${result.termCount} QA terms from ${result.fileName} into ${result.title}`,
        render,
      );
    },
    onError: async (error) => {
      state.qaListImport = qaListImportModalState({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      render();
      showNoticeBadge(error?.message ?? String(error), render);
    },
  });
}


export async function handleDroppedQaListImportFile(render, file) {
  if (!state.qaListImport.isOpen || state.qaListImport.status === "importing") {
    return;
  }

  await importQaListFile(render, file);
}

export async function handleDroppedQaListImportPath(render, path) {
  const normalizedPath = typeof path === "string" ? path.trim() : "";
  if (!normalizedPath || !state.qaListImport.isOpen || state.qaListImport.status === "importing") {
    return;
  }

  try {
    const file = await invoke("read_local_dropped_file", { path: normalizedPath });
    await importQaListFile(render, {
      name: typeof file?.name === "string" ? file.name : "",
      type: typeof file?.mimeType === "string" ? file.mimeType : "",
      dataBase64: typeof file?.dataBase64 === "string" ? file.dataBase64 : "",
    });
  } catch (error) {
    setQaListImportError(render, error instanceof Error ? error.message : String(error));
  }
}
