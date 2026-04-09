import { invoke, waitForNextPaint } from "./runtime.js";
import { beginPageSync, failPageSync } from "./page-sync.js";
import { resetGlossaryCreation, state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { findIsoLanguageOption } from "../lib/language-options.js";
import { loadTeamGlossaries } from "./glossary-discovery-flow.js";
import { openGlossaryEditor } from "./glossary-editor-flow.js";
import { canManageGlossaries, selectedTeam } from "./glossary-shared.js";
import { openLocalFilePicker } from "./local-file-picker.js";

function detectGlossaryImportFileType(fileName) {
  const normalized = String(fileName || "").trim().toLowerCase();
  if (normalized.endsWith(".tmx")) {
    return "tmx";
  }
  return null;
}

export function openGlossaryCreation(render) {
  const team = selectedTeam();
  if (!Number.isFinite(team?.installationId)) {
    showNoticeBadge("Creating a glossary requires a GitHub App-connected team.", render);
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

  if (!canManageGlossaries(team)) {
    state.glossaryCreation.error = "You do not have permission to create glossaries in this team.";
    render();
    return;
  }

  const title = String(draft.title ?? "").trim();
  const sourceLanguageCode = String(draft.sourceLanguageCode ?? "").trim().toLowerCase();
  const targetLanguageCode = String(draft.targetLanguageCode ?? "").trim().toLowerCase();
  const sourceLanguage = findIsoLanguageOption(sourceLanguageCode);
  const targetLanguage = findIsoLanguageOption(targetLanguageCode);

  if (!title) {
    state.glossaryCreation.error = "Enter a glossary name.";
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

  try {
    const glossary = await invoke("create_local_gtms_glossary", {
      input: {
        installationId: team.installationId,
        title,
        sourceLanguageCode: sourceLanguage.code,
        sourceLanguageName: sourceLanguage.name,
        targetLanguageCode: targetLanguage.code,
        targetLanguageName: targetLanguage.name,
      },
    });
    resetGlossaryCreation();
    state.selectedGlossaryId = glossary.glossaryId;
    await loadTeamGlossaries(render, team.id);
    await openGlossaryEditor(render, glossary.glossaryId);
    showNoticeBadge(`Created glossary ${glossary.title}.`, render);
  } catch (error) {
    state.glossaryCreation.status = "idle";
    state.glossaryCreation.error = error?.message ?? String(error);
    render();
  }
}

export async function importGlossaryFromTmx(render) {
  const team = selectedTeam();
  if (!Number.isFinite(team?.installationId)) {
    showNoticeBadge("Importing a glossary requires a GitHub App-connected team.", render);
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

  try {
    const bytes = Array.from(new Uint8Array(await selectedFile.arrayBuffer()));
    const glossary = await invoke("import_tmx_to_local_gtms_glossary", {
      input: {
        installationId: team.installationId,
        fileName: selectedFile.name,
        bytes,
      },
    });

    state.selectedGlossaryId = glossary.glossaryId;
    await loadTeamGlossaries(render, team.id);
    await openGlossaryEditor(render, glossary.glossaryId);
    showNoticeBadge(
      `Imported ${glossary.termCount} terms from ${selectedFile.name} into ${glossary.title}.`,
      render,
    );
  } catch (error) {
    failPageSync();
    showNoticeBadge(error?.message ?? String(error), render);
    render();
  }
}
