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
  permanentlyDeleteRemoteGlossaryRepoForTeam,
  syncGlossaryReposForTeam,
} from "./glossary-repo-flow.js";
import { appendRepoNameSuffix, slugifyRepoName } from "./repo-names.js";
import {
  deleteGlossaryMetadataRecord,
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

function detectGlossaryImportFileType(fileName) {
  const normalized = String(fileName || "").trim().toLowerCase();
  if (normalized.endsWith(".tmx")) {
    return "tmx";
  }
  return null;
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
      state.glossaryCreation.status = "idle";
      state.glossaryCreation.error = error?.message ?? String(error);
    },
  });
}

export async function importGlossaryFromTmx(render) {
  const team = selectedTeam();
  if (areResourcePageWritesDisabled(state.glossariesPage)) {
    showNoticeBadge("Wait for the current glossary refresh or write to finish.", render);
    return;
  }
  if (!Number.isFinite(team?.installationId)) {
    showNoticeBadge("Importing a glossary requires a GitHub App-connected team.", render);
    return;
  }

  if (state.offline?.isEnabled === true) {
    showNoticeBadge("You cannot import glossaries while offline.", render);
    return;
  }

  if (!canCreateGlossaries(team)) {
    showNoticeBadge("You do not have permission to import glossaries in this team.", render);
    return;
  }

  const selectedFile = await openLocalFilePicker({
    accept: ".tmx,text/xml,application/xml",
  });
  if (!selectedFile) {
    return;
  }

  const fileType = detectGlossaryImportFileType(selectedFile.name);
  if (fileType !== "tmx") {
    showNoticeBadge(
      `Unsupported file type for ${selectedFile.name}. TMX is the only supported glossary import format right now.`,
      render,
    );
    return;
  }

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
      const bytes = Array.from(new Uint8Array(await selectedFile.arrayBuffer()));
      showResourceCreateProgress(render, "Reading TMX file...");
      const importPreview = await invoke("inspect_tmx_glossary_import", {
        input: {
          fileName: selectedFile.name,
          bytes,
        },
      });
      const repoName = slugifyRepoName(selectedFile.name.replace(/\.[^.]+$/, "").trim());
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
            fileName: selectedFile.name,
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

        return {
          glossaryId,
          title: glossary.title,
          termCount: Number.isFinite(glossary.termCount) ? glossary.termCount : 0,
          localRepoName,
          localNameCollisionResolved: remoteCreateResult.collisionResolved,
          fileName: selectedFile.name,
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
      showNoticeBadge(error?.message ?? String(error), render);
    },
  });
}
