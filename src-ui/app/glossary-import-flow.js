import { invoke } from "./runtime.js";
import { resetGlossaryCreation, state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { findIsoLanguageOption } from "../lib/language-options.js";
import { openGlossaryEditor } from "./glossary-editor-flow.js";
import {
  canCreateGlossaries,
  canPermanentlyDeleteGlossaries,
  selectedTeam,
} from "./glossary-shared.js";
import { openLocalFilePicker } from "./local-file-picker.js";
import {
  createUniqueRemoteGlossaryRepoForTeam,
  getGlossarySyncIssueMessage,
  listLocalGlossarySummariesForTeam,
  listRemoteGlossaryReposForTeam,
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
  guardResourceCreateStart,
  runLocalFirstCreate,
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

async function reserveLocalGlossaryRepoName(team, baseRepoName) {
  const localGlossaries = await listLocalGlossarySummariesForTeam(team);
  const usedRepoNames = new Set(
    (Array.isArray(localGlossaries) ? localGlossaries : [])
      .map((glossary) => String(glossary?.repoName ?? "").trim())
      .filter(Boolean),
  );

  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const candidateRepoName = appendRepoNameSuffix(baseRepoName, attempt);
    if (!usedRepoNames.has(candidateRepoName)) {
      return {
        repoName: candidateRepoName,
        collisionResolved: attempt > 1,
      };
    }
  }

  throw new Error("Could not determine an available local glossary repo name.");
}

function updateCurrentGlossaryRepoName(glossaryId, repoName) {
  if (state.selectedGlossaryId !== glossaryId || state.glossaryEditor?.glossaryId !== glossaryId) {
    return;
  }

  state.glossaryEditor = {
    ...state.glossaryEditor,
    repoName,
  };
}

function currentGlossarySnapshot(glossary) {
  const glossaryId = glossary?.id ?? glossary?.glossaryId ?? null;
  const repoName = glossary?.repoName ?? null;
  return (
    state.glossaries.find((item) => item?.id === glossaryId)
    ?? state.glossaries.find((item) => item?.repoName === repoName)
    ?? glossary
  );
}

function pendingGlossaryMetadataRecord(glossary) {
  return {
    glossaryId: glossary.id ?? glossary.glossaryId,
    title: glossary.title,
    repoName: glossary.repoName,
    lifecycleState: glossary.lifecycleState === "deleted" ? "softDeleted" : "active",
    remoteState: "pendingCreate",
    recordState: "live",
    defaultBranch: "main",
    sourceLanguage: glossary.sourceLanguage ?? null,
    targetLanguage: glossary.targetLanguage ?? null,
    termCount: Number.isFinite(glossary.termCount) ? glossary.termCount : 0,
  };
}

async function rollbackPendingGlossaryMetadataOnLocalFailure(team, glossaryId, error) {
  try {
    await deleteGlossaryMetadataRecord(team, glossaryId);
  } catch (rollbackError) {
    throw new Error(
      `${error?.message ?? String(error)} The pending glossary metadata intent was committed locally first, and the automatic metadata rollback also failed: ${
        rollbackError?.message ?? String(rollbackError)
      }`,
    );
  }
}

function linkedGlossaryMetadataRecord(glossary, remoteRepo) {
  return {
    ...pendingGlossaryMetadataRecord(glossary),
    repoName: remoteRepo.name,
    previousRepoNames:
      remoteRepo.name !== glossary.repoName ? [glossary.repoName] : [],
    githubRepoId: remoteRepo.repoId ?? null,
    githubNodeId: remoteRepo.nodeId ?? null,
    fullName: remoteRepo.fullName ?? null,
    defaultBranch: remoteRepo.defaultBranchName || "main",
    remoteState: "linked",
  };
}

function findMatchingRemoteGlossaryForPendingCreate(glossary, remoteRepos) {
  if (!glossary || !Array.isArray(remoteRepos)) {
    return null;
  }

  if (Number.isFinite(glossary.repoId)) {
    const byRepoId = remoteRepos.find((remoteRepo) => remoteRepo?.repoId === glossary.repoId);
    if (byRepoId) {
      return byRepoId;
    }
  }

  if (typeof glossary.nodeId === "string" && glossary.nodeId.trim()) {
    const byNodeId = remoteRepos.find((remoteRepo) =>
      typeof remoteRepo?.nodeId === "string" && remoteRepo.nodeId.trim() === glossary.nodeId.trim(),
    );
    if (byNodeId) {
      return byNodeId;
    }
  }

  if (typeof glossary.fullName === "string" && glossary.fullName.trim()) {
    const byFullName = remoteRepos.find((remoteRepo) =>
      typeof remoteRepo?.fullName === "string" && remoteRepo.fullName.trim() === glossary.fullName.trim(),
    );
    if (byFullName) {
      return byFullName;
    }
  }

  if (typeof glossary.repoName === "string" && glossary.repoName.trim()) {
    return remoteRepos.find((remoteRepo) =>
      typeof remoteRepo?.name === "string" && remoteRepo.name.trim() === glossary.repoName.trim(),
    ) ?? null;
  }

  return null;
}

async function finalizePendingGlossarySetup(render, team, glossary, remoteRepo) {
  const currentGlossary = currentGlossarySnapshot(glossary);
  const glossaryId = currentGlossary?.id ?? currentGlossary?.glossaryId ?? null;

  if (
    remoteRepo?.name
    && currentGlossary?.repoName
    && remoteRepo.name !== currentGlossary.repoName
  ) {
    await invoke("rename_local_gtms_glossary_repo", {
      input: {
        installationId: team.installationId,
        glossaryId,
        fromRepoName: currentGlossary.repoName,
        toRepoName: remoteRepo.name,
      },
    });
  }

  const linkedGlossary = {
    ...currentGlossary,
    repoName: remoteRepo.name,
    remoteState: "linked",
    resolutionState: "",
    repoId: remoteRepo?.repoId ?? null,
    fullName: remoteRepo?.fullName ?? "",
    htmlUrl: remoteRepo?.htmlUrl ?? "",
    defaultBranchName: remoteRepo?.defaultBranchName ?? "main",
    defaultBranchHeadOid: remoteRepo?.defaultBranchHeadOid ?? null,
  };
  updateCurrentGlossaryRepoName(glossaryId, remoteRepo.name);
  render();

  await upsertGlossaryMetadataRecord(
    team,
    linkedGlossaryMetadataRecord(currentGlossarySnapshot(linkedGlossary), remoteRepo),
  );
  await prepareLocalGlossaryRepo(team, remoteRepo, glossaryId);

  const snapshots = await syncGlossaryReposForTeam(team, [remoteRepo]);
  const syncIssue = getGlossarySyncIssueMessage(snapshots);
  if (syncIssue?.message) {
    showNoticeBadge(syncIssue.message, render, 3200);
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

async function completeGlossaryCreateSynchronously(team, input) {
  const glossaryId = crypto.randomUUID();
  let localRepoName = "";
  let remoteRepo = null;

  try {
    const createResult = await runLocalFirstCreate({
      reserveLocalRepo: async () => reserveLocalGlossaryRepoName(team, input.repoName),
      commitPendingMetadata: (nextLocalRepoName) =>
        upsertGlossaryMetadataRecord(team, pendingGlossaryMetadataRecord({
          id: glossaryId,
          repoName: nextLocalRepoName,
          title: input.title,
          sourceLanguage: input.sourceLanguage,
          targetLanguage: input.targetLanguage,
          termCount: 0,
        }), { requirePushSuccess: true }),
      initializeLocalResource: async (nextLocalRepoName) => {
        await invoke("prepare_local_gtms_glossary_repo", {
          input: {
            installationId: team.installationId,
            glossaryId,
            repoName: nextLocalRepoName,
          },
        });
        return invoke("initialize_gtms_glossary_repo", {
          input: {
            installationId: team.installationId,
            repoName: nextLocalRepoName,
            glossaryId,
            title: input.title,
            sourceLanguageCode: input.sourceLanguage.code,
            sourceLanguageName: input.sourceLanguage.name,
            targetLanguageCode: input.targetLanguage.code,
            targetLanguageName: input.targetLanguage.name,
          },
        });
      },
      purgeLocalRepo: (nextLocalRepoName) => invoke("purge_local_gtms_glossary_repo", {
        input: {
          installationId: team.installationId,
          glossaryId,
          repoName: nextLocalRepoName,
        },
      }),
      rollbackPendingMetadata: (error) =>
        rollbackPendingGlossaryMetadataOnLocalFailure(team, glossaryId, error),
    });

    const glossary = createResult.createdResource;
    localRepoName = createResult.localRepoName;
    const remoteCreateResult = await createUniqueRemoteGlossaryRepoForTeam(team, input.repoName);
    remoteRepo = remoteCreateResult.remoteRepo;

    if (remoteRepo.name !== localRepoName) {
      await invoke("rename_local_gtms_glossary_repo", {
        input: {
          installationId: team.installationId,
          glossaryId,
          fromRepoName: localRepoName,
          toRepoName: remoteRepo.name,
        },
      });
      localRepoName = remoteRepo.name;
    }

    const linkedGlossary = {
      ...glossary,
      repoName: remoteRepo.name,
      remoteState: "linked",
      resolutionState: "",
    };
    await upsertGlossaryMetadataRecord(
      team,
      linkedGlossaryMetadataRecord(linkedGlossary, remoteRepo),
      { requirePushSuccess: true },
    );
    await prepareLocalGlossaryRepo(team, remoteRepo, glossaryId);

    const snapshots = await syncGlossaryReposForTeam(team, [remoteRepo]);
    const syncIssue = getGlossarySyncIssueMessage(snapshots);
    if (syncIssue?.message) {
      throw new Error(syncIssue.message);
    }

    return {
      glossaryId,
      title: input.title,
      finalRepoName: remoteRepo.name,
      localRepoName: createResult.localRepoName,
      localNameCollisionResolved: createResult.localNameCollisionResolved,
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

async function reloadGlossariesAfterWrite(render, team) {
  await loadTeamGlossaries(render, team.id, { preserveVisibleData: false });
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

export async function resumePendingGlossarySetup(render, glossaryId) {
  const team = selectedTeam();
  const glossary =
    currentGlossarySnapshot(state.glossaries.find((item) => item.id === glossaryId) ?? null);
  if (!glossary) {
    showNoticeBadge("Could not find the selected glossary.", render);
    return;
  }
  if (
    glossary?.remoteState !== "pendingCreate"
    && glossary?.resolutionState !== "pendingCreate"
  ) {
    showNoticeBadge("This glossary no longer needs setup.", render);
    return;
  }
  if (!Number.isFinite(team?.installationId)) {
    showNoticeBadge("Could not determine the selected team.", render);
    return;
  }
  if (state.offline?.isEnabled === true) {
    showNoticeBadge("You cannot resume glossary setup while offline.", render);
    return;
  }
  if (!canPermanentlyDeleteGlossaries(team)) {
    showNoticeBadge("You do not have permission to resume glossary setup in this team.", render);
    return;
  }

  await submitResourcePageWrite({
    pageState: state.glossariesPage,
    render,
    onBlocked: async () => {
      showNoticeBadge("Wait for the current glossary refresh or write to finish.", render);
    },
    runMutation: async () => {
      const remoteRepos = await listRemoteGlossaryReposForTeam(team);
      const matchedRemoteRepo = findMatchingRemoteGlossaryForPendingCreate(glossary, remoteRepos);
      if (matchedRemoteRepo) {
        await finalizePendingGlossarySetup(render, team, glossary, matchedRemoteRepo);
        return;
      }
      const createResult = await createUniqueRemoteGlossaryRepoForTeam(team, glossary.repoName);
      await finalizePendingGlossarySetup(render, team, glossary, createResult.remoteRepo);
    },
    refreshOptions: {
      loadData: async () => reloadGlossariesAfterWrite(render, team),
    },
    onSuccess: async () => {
      showNoticeBadge(`Finished setting up ${glossary.title}.`, render);
    },
    onError: async (error) => {
      showNoticeBadge(error?.message ?? String(error), render);
    },
  });
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
      }),
    refreshOptions: {
      loadData: async () => reloadGlossariesAfterWrite(render, team),
    },
    onSuccess: async (result) => {
      resetGlossaryCreation();
      state.selectedGlossaryId = result.glossaryId;
      const refreshedGlossary = state.glossaries.find((item) => item.id === result.glossaryId) ?? null;
      showNoticeBadge(
        result.localNameCollisionResolved
          ? `Created glossary ${result.title} in local repo ${result.localRepoName} because that name was already used locally.`
          : `Created glossary ${result.title}.`,
        render,
      );
      await openGlossaryEditor(render, result.glossaryId, {
        preferredGlossary: refreshedGlossary,
      });
    },
    onError: async (error) => {
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
    render,
    onBlocked: async () => {
      showNoticeBadge("Wait for the current glossary refresh or write to finish.", render);
    },
    runMutation: async () => {
      const glossaryId = crypto.randomUUID();
      const bytes = Array.from(new Uint8Array(await selectedFile.arrayBuffer()));
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

      let localRepoName = "";
      let remoteRepo = null;
      try {
        const createResult = await runLocalFirstCreate({
          reserveLocalRepo: async () => reserveLocalGlossaryRepoName(team, repoName),
          commitPendingMetadata: (nextLocalRepoName) =>
            upsertGlossaryMetadataRecord(team, pendingGlossaryMetadataRecord({
              id: glossaryId,
              repoName: nextLocalRepoName,
              title: importPreview.title,
              sourceLanguage: importPreview.sourceLanguage ?? null,
              targetLanguage: importPreview.targetLanguage ?? null,
              termCount: Number.isFinite(importPreview.termCount) ? importPreview.termCount : 0,
            }), { requirePushSuccess: true }),
          initializeLocalResource: async (nextLocalRepoName) => {
            await invoke("prepare_local_gtms_glossary_repo", {
              input: {
                installationId: team.installationId,
                glossaryId,
                repoName: nextLocalRepoName,
              },
            });
            return invoke("import_tmx_to_gtms_glossary_repo", {
              input: {
                installationId: team.installationId,
                repoName: nextLocalRepoName,
                glossaryId,
                fileName: selectedFile.name,
                bytes,
              },
            });
          },
          purgeLocalRepo: (nextLocalRepoName) => invoke("purge_local_gtms_glossary_repo", {
            input: {
              installationId: team.installationId,
              glossaryId,
              repoName: nextLocalRepoName,
            },
          }),
          rollbackPendingMetadata: (error) =>
            rollbackPendingGlossaryMetadataOnLocalFailure(team, glossaryId, error),
        });

        localRepoName = createResult.localRepoName;
        const glossary = createResult.createdResource;
        const remoteCreateResult = await createUniqueRemoteGlossaryRepoForTeam(team, repoName);
        remoteRepo = remoteCreateResult.remoteRepo;

        if (remoteRepo.name !== localRepoName) {
          await invoke("rename_local_gtms_glossary_repo", {
            input: {
              installationId: team.installationId,
              glossaryId,
              fromRepoName: localRepoName,
              toRepoName: remoteRepo.name,
            },
          });
          localRepoName = remoteRepo.name;
        }

        const linkedGlossary = {
          ...glossary,
          repoName: remoteRepo.name,
          remoteState: "linked",
          resolutionState: "",
        };
        await upsertGlossaryMetadataRecord(
          team,
          linkedGlossaryMetadataRecord(linkedGlossary, remoteRepo),
          { requirePushSuccess: true },
        );
        await prepareLocalGlossaryRepo(team, remoteRepo, glossaryId);

        const snapshots = await syncGlossaryReposForTeam(team, [remoteRepo]);
        const syncIssue = getGlossarySyncIssueMessage(snapshots);
        if (syncIssue?.message) {
          throw new Error(syncIssue.message);
        }

        return {
          glossaryId,
          title: glossary.title,
          termCount: Number.isFinite(glossary.termCount) ? glossary.termCount : 0,
          localRepoName: createResult.localRepoName,
          localNameCollisionResolved: createResult.localNameCollisionResolved,
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
      loadData: async () => reloadGlossariesAfterWrite(render, team),
    },
    onSuccess: async (result) => {
      state.selectedGlossaryId = result.glossaryId;
      const refreshedGlossary = state.glossaries.find((item) => item.id === result.glossaryId) ?? null;
      showNoticeBadge(
        result.localNameCollisionResolved
          ? `Imported ${result.termCount} terms from ${result.fileName} into ${result.title} in local repo ${result.localRepoName} because that name was already used locally.`
          : `Imported ${result.termCount} terms from ${result.fileName} into ${result.title}.`,
        render,
      );
      await openGlossaryEditor(render, result.glossaryId, { preferredGlossary: refreshedGlossary });
    },
    onError: async (error) => {
      showNoticeBadge(error?.message ?? String(error), render);
    },
  });
}
