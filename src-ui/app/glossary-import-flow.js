import { invoke, waitForNextPaint } from "./runtime.js";
import { beginPageSync, failPageSync } from "./page-sync.js";
import { resetGlossaryCreation, state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { findIsoLanguageOption } from "../lib/language-options.js";
import { openGlossaryEditor } from "./glossary-editor-flow.js";
import { saveStoredGlossariesForTeam } from "./glossary-cache.js";
import {
  canCreateGlossaries,
  canManageGlossaries,
  canPermanentlyDeleteGlossaries,
  selectedTeam,
  upsertGlossarySummary,
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
  autoResumePendingResources,
  resumePendingResourceSetup,
} from "./resource-pending-create.js";

function detectGlossaryImportFileType(fileName) {
  const normalized = String(fileName || "").trim().toLowerCase();
  if (normalized.endsWith(".tmx")) {
    return "tmx";
  }
  return null;
}

function commitLocalGlossarySummary(team, glossary, remoteRepo = null) {
  const normalizedGlossary = upsertGlossarySummary({
    ...glossary,
    repoId: remoteRepo?.repoId ?? null,
    fullName: remoteRepo?.fullName ?? "",
    htmlUrl: remoteRepo?.htmlUrl ?? "",
    defaultBranchName: remoteRepo?.defaultBranchName ?? "main",
    defaultBranchHeadOid: remoteRepo?.defaultBranchHeadOid ?? null,
  });

  if (!normalizedGlossary) {
    return null;
  }

  saveStoredGlossariesForTeam(team, state.glossaries);
  return normalizedGlossary;
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

function markGlossarySyncInFlight(glossaryId) {
  if (typeof glossaryId !== "string" || !glossaryId.trim()) {
    return;
  }

  state.glossarySyncInFlightIds = new Set([
    ...state.glossarySyncInFlightIds,
    glossaryId,
  ]);
}

function clearGlossarySyncInFlight(glossaryId) {
  if (typeof glossaryId !== "string" || !glossaryId.trim()) {
    return;
  }

  const nextIds = new Set(state.glossarySyncInFlightIds);
  nextIds.delete(glossaryId);
  state.glossarySyncInFlightIds = nextIds;
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

function markGlossaryAsLocalOnly(team, glossary, render) {
  const localOnlyGlossary = commitLocalGlossarySummary(team, {
    ...glossary,
    remoteState: "linked",
    resolutionState: "unregisteredLocal",
  }, null) ?? {
    ...glossary,
    remoteState: "linked",
    resolutionState: "unregisteredLocal",
  };
  updateCurrentGlossaryRepoName(localOnlyGlossary.id ?? localOnlyGlossary.glossaryId, localOnlyGlossary.repoName);
  render();
  return localOnlyGlossary;
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

  const linkedGlossary = commitLocalGlossarySummary(team, {
    ...currentGlossary,
    repoName: remoteRepo.name,
    remoteState: "linked",
    resolutionState: "",
  }, remoteRepo) ?? {
    ...currentGlossary,
    repoName: remoteRepo.name,
    remoteState: "linked",
    resolutionState: "",
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

function syncGlossaryInBackground(render, team, glossary, preferredBaseRepoName) {
  void (async () => {
    const glossaryId = glossary?.id ?? glossary?.glossaryId ?? null;
    markGlossarySyncInFlight(glossaryId);
    try {
      await upsertGlossaryMetadataRecord(team, pendingGlossaryMetadataRecord(currentGlossarySnapshot(glossary)));
    } catch (error) {
      markGlossaryAsLocalOnly(team, currentGlossarySnapshot(glossary), render);
      clearGlossarySyncInFlight(glossaryId);
      showNoticeBadge(
        `The glossary stays local-only because its team metadata record could not be created: ${
          error?.message ?? String(error)
        }`,
        render,
      );
      return;
    }

    const createResult = await createUniqueRemoteGlossaryRepoForTeam(team, preferredBaseRepoName);
    const remoteRepo = createResult.remoteRepo;
    let syncedGlossary = currentGlossarySnapshot(glossary);

    if (remoteRepo.name !== syncedGlossary.repoName) {
      await invoke("rename_local_gtms_glossary_repo", {
        input: {
          installationId: team.installationId,
          glossaryId,
          fromRepoName: syncedGlossary.repoName,
          toRepoName: remoteRepo.name,
        },
      });

      const renamedBaseGlossary = currentGlossarySnapshot(syncedGlossary);
      syncedGlossary = commitLocalGlossarySummary(team, {
        ...renamedBaseGlossary,
        repoName: remoteRepo.name,
        remoteState: "linked",
        resolutionState: "",
      }, remoteRepo) ?? {
        ...renamedBaseGlossary,
        repoName: remoteRepo.name,
        remoteState: "linked",
        resolutionState: "",
      };
      updateCurrentGlossaryRepoName(syncedGlossary.id ?? glossary.glossaryId, remoteRepo.name);
      render();
    } else {
      syncedGlossary = commitLocalGlossarySummary(team, {
        ...currentGlossarySnapshot(syncedGlossary),
        remoteState: "linked",
        resolutionState: "",
      }, remoteRepo) ?? currentGlossarySnapshot(syncedGlossary);
      render();
    }

    try {
      await upsertGlossaryMetadataRecord(
        team,
        linkedGlossaryMetadataRecord(currentGlossarySnapshot(syncedGlossary), remoteRepo),
      );
    } catch (error) {
      try {
        await permanentlyDeleteRemoteGlossaryRepoForTeam(team, remoteRepo.name);
      } catch (rollbackError) {
        markGlossaryAsLocalOnly(team, currentGlossarySnapshot(syncedGlossary), render);
        clearGlossarySyncInFlight(glossaryId);
        showNoticeBadge(
          `The glossary repo was created, but its metadata could not be finalized or rolled back automatically: ${
            rollbackError?.message ?? String(rollbackError)
          }`,
          render,
        );
        return;
      }
      try {
        const latestGlossary = currentGlossarySnapshot(syncedGlossary);
        await deleteGlossaryMetadataRecord(team, latestGlossary.id ?? latestGlossary.glossaryId);
      } catch {
        // Leave the local-only glossary visible even if cleanup metadata could not be removed.
      }
      markGlossaryAsLocalOnly(team, currentGlossarySnapshot(syncedGlossary), render);
      clearGlossarySyncInFlight(glossaryId);
      showNoticeBadge(
        `The glossary stays local-only because its team metadata record could not be finalized: ${
          error?.message ?? String(error)
        }`,
        render,
      );
      return;
    }

    await prepareLocalGlossaryRepo(team, remoteRepo, glossaryId);
    const snapshots = await syncGlossaryReposForTeam(team, [remoteRepo]);
    const syncIssue = getGlossarySyncIssueMessage(snapshots);
    if (syncIssue?.message) {
      showNoticeBadge(syncIssue.message, render);
      render();
    } else if (createResult.collisionResolved === true) {
      const latestGlossary = currentGlossarySnapshot(syncedGlossary);
      showNoticeBadge(
        `Saved ${latestGlossary.title} to repo ${remoteRepo.name} because that repo name was already taken.`,
        render,
      );
    }
    clearGlossarySyncInFlight(glossaryId);
  })().catch((error) => {
    const glossaryId = glossary?.id ?? glossary?.glossaryId ?? null;
    clearGlossarySyncInFlight(glossaryId);
    showNoticeBadge(
      `The glossary could not sync to GitHub automatically: ${error?.message ?? String(error)}`,
      render,
    );
    render();
  });
}

export function openGlossaryCreation(render) {
  const team = selectedTeam();
  if (!Number.isFinite(team?.installationId)) {
    showNoticeBadge("Creating a glossary requires a GitHub App-connected team.", render);
    return;
  }

  if (state.offline?.isEnabled === true) {
    showNoticeBadge("You cannot create glossaries while offline.", render);
    return;
  }

  if (!canCreateGlossaries(team)) {
    showNoticeBadge("You do not have permission to create glossaries in this team.", render);
    return;
  }

  state.glossaryCreation = {
    isOpen: true,
    status: "idle",
    error: "",
    title: "",
    sourceLanguageCode: "",
    targetLanguageCode: "",
  };
  render();
}

async function resumePendingGlossarySetupInternal(render, glossaryId, options = {}) {
  const team = selectedTeam();
  const showStartNotice = options.showStartNotice !== false;
  const showSuccessNotice = options.showSuccessNotice !== false;
  const showErrorNotice = options.showErrorNotice !== false;
  await resumePendingResourceSetup({
    render,
    resourceId: glossaryId,
    resourceLabel: "glossary",
    showStartNotice,
    showSuccessNotice,
    showErrorNotice,
    getResource: (nextGlossaryId) =>
      currentGlossarySnapshot(
        state.glossaries.find((item) => item.id === nextGlossaryId) ?? null,
      ),
    ensureResumeAllowed: () => {
      if (!Number.isFinite(team?.installationId)) {
        showNoticeBadge("Could not determine the selected team.", render);
        return false;
      }

      if (state.offline?.isEnabled === true) {
        showNoticeBadge("You cannot resume glossary setup while offline.", render);
        return false;
      }

      if (!canPermanentlyDeleteGlossaries(team)) {
        showNoticeBadge("You do not have permission to resume glossary setup in this team.", render);
        return false;
      }

      return true;
    },
    isPendingCreate: (glossary) =>
      glossary?.remoteState === "pendingCreate" || glossary?.resolutionState === "pendingCreate",
    isInFlight: (glossary) => state.glossarySyncInFlightIds.has(glossary.id),
    markInFlight: (glossary) => markGlossarySyncInFlight(glossary.id),
    clearInFlight: (glossary) => clearGlossarySyncInFlight(glossary.id),
    listRemoteResources: async () => listRemoteGlossaryReposForTeam(team),
    findMatchingRemoteResource: (glossary, remoteRepos) =>
      findMatchingRemoteGlossaryForPendingCreate(
        currentGlossarySnapshot(glossary),
        remoteRepos,
      ),
    syncInBackground: async (glossary) => {
      syncGlossaryInBackground(
        render,
        team,
        currentGlossarySnapshot(glossary),
        currentGlossarySnapshot(glossary)?.repoName ?? "",
      );
    },
    finalizePendingSetup: (glossary, matchedRemoteRepo) =>
      finalizePendingGlossarySetup(render, team, glossary, matchedRemoteRepo),
  });
}

export async function resumePendingGlossarySetup(render, glossaryId) {
  await resumePendingGlossarySetupInternal(render, glossaryId);
}

export async function autoResumePendingGlossarySetup(render, glossaries) {
  await autoResumePendingResources({
    resources: glossaries,
    getResourceId: (glossary) => glossary?.id ?? "",
    isPendingCreate: (glossary) =>
      glossary?.remoteState === "pendingCreate" || glossary?.resolutionState === "pendingCreate",
    isInFlight: (glossary) => state.glossarySyncInFlightIds.has(glossary.id),
    resumePendingSetup: (glossaryId, options = {}) =>
      resumePendingGlossarySetupInternal(render, glossaryId, options),
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

  state.glossaryCreation[field] = value;
  if (state.glossaryCreation.error) {
    state.glossaryCreation.error = "";
  }
}

export async function submitGlossaryCreation(render) {
  const team = selectedTeam();
  const draft = state.glossaryCreation;
  if (!draft?.isOpen) {
    return;
  }

  if (!Number.isFinite(team?.installationId)) {
    state.glossaryCreation.error = "Creating a glossary requires a GitHub App-connected team.";
    render();
    return;
  }

  if (state.offline?.isEnabled === true) {
    state.glossaryCreation.error = "You cannot create glossaries while offline.";
    render();
    return;
  }

  if (!canCreateGlossaries(team)) {
    state.glossaryCreation.error = "You do not have permission to create glossaries in this team.";
    render();
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
  await waitForNextPaint();

  let localRepoName = "";
  let glossary = null;
  let localNameCollisionResolved = false;
  const glossaryId = crypto.randomUUID();
  let metadataIntentCommitted = false;
  try {
    const localRepoReservation = await reserveLocalGlossaryRepoName(team, repoName);
    localRepoName = localRepoReservation.repoName;
    localNameCollisionResolved = localRepoReservation.collisionResolved === true;
    await upsertGlossaryMetadataRecord(team, pendingGlossaryMetadataRecord({
      id: glossaryId,
      repoName: localRepoName,
      title,
      sourceLanguage,
      targetLanguage,
      termCount: 0,
    }));
    metadataIntentCommitted = true;
    await invoke("prepare_local_gtms_glossary_repo", {
      input: {
        installationId: team.installationId,
        glossaryId,
        repoName: localRepoName,
      },
    });
    glossary = await invoke("initialize_gtms_glossary_repo", {
      input: {
        installationId: team.installationId,
        repoName: localRepoName,
        glossaryId,
        title,
        sourceLanguageCode: sourceLanguage.code,
        sourceLanguageName: sourceLanguage.name,
        targetLanguageCode: targetLanguage.code,
        targetLanguageName: targetLanguage.name,
      },
    });
  } catch (error) {
    if (localRepoName && !glossary) {
      try {
        await invoke("purge_local_gtms_glossary_repo", {
          input: {
            installationId: team.installationId,
            glossaryId,
            repoName: localRepoName,
          },
        });
      } catch {
        // Ignore local cleanup failures while surfacing the primary creation error.
      }
    }
    if (metadataIntentCommitted && !glossary) {
      try {
        await rollbackPendingGlossaryMetadataOnLocalFailure(team, glossaryId, error);
      } catch (metadataRollbackError) {
        error = metadataRollbackError;
      }
    }
    state.glossaryCreation.status = "idle";
    state.glossaryCreation.error = error?.message ?? String(error);
    render();
    return;
  }

  resetGlossaryCreation();
  const committedGlossary = commitLocalGlossarySummary(team, {
    ...glossary,
    remoteState: "pendingCreate",
    resolutionState: "pendingCreate",
  }, null);
  state.selectedGlossaryId = glossary.glossaryId;

  try {
    await openGlossaryEditor(render, glossary.glossaryId, { preferredGlossary: committedGlossary ?? glossary });
    syncGlossaryInBackground(render, team, committedGlossary ?? glossary, repoName);
    showNoticeBadge(
      localNameCollisionResolved
        ? `Created glossary ${glossary.title} in local repo ${localRepoName} because that name was already used locally.`
        : `Created glossary ${glossary.title}.`,
      render,
    );
  } catch (error) {
    showNoticeBadge(
      `Created glossary ${glossary.title}, but the app could not refresh automatically: ${error?.message ?? String(error)}`,
      render,
    );
    render();
  }
}

export async function importGlossaryFromTmx(render) {
  const team = selectedTeam();
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

  beginPageSync();
  render();
  await waitForNextPaint();

  let localRepoName = "";
  let glossary = null;
  let localNameCollisionResolved = false;
  const glossaryId = crypto.randomUUID();
  let metadataIntentCommitted = false;
  try {
    const bytes = Array.from(new Uint8Array(await selectedFile.arrayBuffer()));
    const importPreview = await invoke("inspect_tmx_glossary_import", {
      input: {
        fileName: selectedFile.name,
        bytes,
      },
    });
    const repoName = slugifyRepoName(
      selectedFile.name.replace(/\.[^.]+$/, "").trim(),
    );
    if (!repoName) {
      throw new Error("Could not determine a glossary repo name from this import file.");
    }

    const localRepoReservation = await reserveLocalGlossaryRepoName(team, repoName);
    localRepoName = localRepoReservation.repoName;
    localNameCollisionResolved = localRepoReservation.collisionResolved === true;
    await upsertGlossaryMetadataRecord(team, pendingGlossaryMetadataRecord({
      id: glossaryId,
      repoName: localRepoName,
      title: importPreview.title,
      sourceLanguage: importPreview.sourceLanguage ?? null,
      targetLanguage: importPreview.targetLanguage ?? null,
      termCount: Number.isFinite(importPreview.termCount) ? importPreview.termCount : 0,
    }));
    metadataIntentCommitted = true;
    await invoke("prepare_local_gtms_glossary_repo", {
      input: {
        installationId: team.installationId,
        glossaryId,
        repoName: localRepoName,
      },
    });
    glossary = await invoke("import_tmx_to_gtms_glossary_repo", {
      input: {
        installationId: team.installationId,
        repoName: localRepoName,
        glossaryId,
        fileName: selectedFile.name,
        bytes,
      },
    });
  } catch (error) {
    if (localRepoName && !glossary) {
      try {
        await invoke("purge_local_gtms_glossary_repo", {
          input: {
            installationId: team.installationId,
            glossaryId,
            repoName: localRepoName,
          },
        });
      } catch {
        // Ignore local cleanup failures while surfacing the primary import error.
      }
    }
    if (metadataIntentCommitted && !glossary) {
      try {
        await rollbackPendingGlossaryMetadataOnLocalFailure(team, glossaryId, error);
      } catch (metadataRollbackError) {
        error = metadataRollbackError;
      }
    }
    failPageSync();
    showNoticeBadge(error?.message ?? String(error), render);
    render();
    return;
  }

  const committedGlossary = commitLocalGlossarySummary(team, {
    ...glossary,
    remoteState: "pendingCreate",
    resolutionState: "pendingCreate",
  }, null);
  state.selectedGlossaryId = glossary.glossaryId;

  try {
    await openGlossaryEditor(render, glossary.glossaryId, { preferredGlossary: committedGlossary ?? glossary });
    syncGlossaryInBackground(
      render,
      team,
      committedGlossary ?? glossary,
      slugifyRepoName(selectedFile.name.replace(/\.[^.]+$/, "").trim()),
    );
    showNoticeBadge(
      localNameCollisionResolved
        ? `Imported ${glossary.termCount} terms from ${selectedFile.name} into ${glossary.title} in local repo ${localRepoName} because that name was already used locally.`
        : `Imported ${glossary.termCount} terms from ${selectedFile.name} into ${glossary.title}.`,
      render,
    );
  } catch (error) {
    failPageSync();
    showNoticeBadge(
      `Imported ${glossary.termCount} terms from ${selectedFile.name} into ${glossary.title}, but the app could not refresh automatically: ${error?.message ?? String(error)}`,
      render,
    );
    render();
  }
}
