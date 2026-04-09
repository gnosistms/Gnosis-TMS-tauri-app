import { invoke, waitForNextPaint } from "./runtime.js";
import { beginPageSync, failPageSync } from "./page-sync.js";
import { resetGlossaryCreation, state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { findIsoLanguageOption } from "../lib/language-options.js";
import { openGlossaryEditor } from "./glossary-editor-flow.js";
import { saveStoredGlossariesForTeam } from "./glossary-cache.js";
import { canManageGlossaries, selectedTeam, upsertGlossarySummary } from "./glossary-shared.js";
import { openLocalFilePicker } from "./local-file-picker.js";
import {
  createUniqueRemoteGlossaryRepoForTeam,
  getGlossarySyncIssueMessage,
  listLocalGlossarySummariesForTeam,
  permanentlyDeleteRemoteGlossaryRepoForTeam,
  syncGlossaryReposForTeam,
} from "./glossary-repo-flow.js";
import { appendRepoNameSuffix, slugifyRepoName } from "./repo-names.js";
import { upsertGlossaryMetadataRecord } from "./team-metadata-flow.js";

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

async function prepareLocalGlossaryRepo(team, remoteRepo) {
  await invoke("prepare_local_gtms_glossary_repo", {
    input: {
      installationId: team.installationId,
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

function syncGlossaryInBackground(render, team, glossary, preferredBaseRepoName) {
  void (async () => {
    try {
      await upsertGlossaryMetadataRecord(team, pendingGlossaryMetadataRecord(glossary));
    } catch (error) {
      showNoticeBadge(
        `The glossary metadata record could not be written yet: ${error?.message ?? String(error)}`,
        render,
      );
      render();
    }

    const createResult = await createUniqueRemoteGlossaryRepoForTeam(team, preferredBaseRepoName);
    const remoteRepo = createResult.remoteRepo;
    let syncedGlossary = glossary;

    if (remoteRepo.name !== glossary.repoName) {
      await invoke("rename_local_gtms_glossary_repo", {
        input: {
          installationId: team.installationId,
          fromRepoName: glossary.repoName,
          toRepoName: remoteRepo.name,
        },
      });

      syncedGlossary = commitLocalGlossarySummary(team, {
        ...glossary,
        repoName: remoteRepo.name,
        remoteState: "linked",
        resolutionState: "",
      }, remoteRepo) ?? {
        ...glossary,
        repoName: remoteRepo.name,
        remoteState: "linked",
        resolutionState: "",
      };
      updateCurrentGlossaryRepoName(glossary.glossaryId, remoteRepo.name);
      render();
    } else {
      commitLocalGlossarySummary(team, {
        ...glossary,
        remoteState: "linked",
        resolutionState: "",
      }, remoteRepo);
    }

    try {
      await upsertGlossaryMetadataRecord(team, linkedGlossaryMetadataRecord(syncedGlossary, remoteRepo));
    } catch (error) {
      showNoticeBadge(
        `The glossary metadata record could not be finalized yet: ${error?.message ?? String(error)}`,
        render,
      );
      render();
    }

    await prepareLocalGlossaryRepo(team, remoteRepo);
    const snapshots = await syncGlossaryReposForTeam(team, [remoteRepo]);
    const syncIssue = getGlossarySyncIssueMessage(snapshots);
    if (syncIssue?.message) {
      showNoticeBadge(syncIssue.message, render);
      render();
    } else if (createResult.collisionResolved === true) {
      showNoticeBadge(
        `Saved ${syncedGlossary.title} to repo ${remoteRepo.name} because that repo name was already taken.`,
        render,
      );
    }
  })().catch((error) => {
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

  if (!canManageGlossaries(team)) {
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

  if (!canManageGlossaries(team)) {
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
  try {
    const localRepoReservation = await reserveLocalGlossaryRepoName(team, repoName);
    localRepoName = localRepoReservation.repoName;
    localNameCollisionResolved = localRepoReservation.collisionResolved === true;
    await invoke("prepare_local_gtms_glossary_repo", {
      input: {
        installationId: team.installationId,
        repoName: localRepoName,
      },
    });
    glossary = await invoke("initialize_gtms_glossary_repo", {
      input: {
        installationId: team.installationId,
        repoName: localRepoName,
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
            repoName: localRepoName,
          },
        });
      } catch {
        // Ignore local cleanup failures while surfacing the primary creation error.
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

  if (!canManageGlossaries(team)) {
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
  try {
    const bytes = Array.from(new Uint8Array(await selectedFile.arrayBuffer()));
    const repoName = slugifyRepoName(
      selectedFile.name.replace(/\.[^.]+$/, "").trim(),
    );
    if (!repoName) {
      throw new Error("Could not determine a glossary repo name from this import file.");
    }

    const localRepoReservation = await reserveLocalGlossaryRepoName(team, repoName);
    localRepoName = localRepoReservation.repoName;
    localNameCollisionResolved = localRepoReservation.collisionResolved === true;
    await invoke("prepare_local_gtms_glossary_repo", {
      input: {
        installationId: team.installationId,
        repoName: localRepoName,
      },
    });
    glossary = await invoke("import_tmx_to_gtms_glossary_repo", {
      input: {
        installationId: team.installationId,
        repoName: localRepoName,
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
            repoName: localRepoName,
          },
        });
      } catch {
        // Ignore local cleanup failures while surfacing the primary import error.
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
