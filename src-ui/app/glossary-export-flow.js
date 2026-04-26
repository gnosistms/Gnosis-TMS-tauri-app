import { formatErrorForDisplay } from "./error-display.js";
import { invoke } from "./runtime.js";
import { showNoticeBadge } from "./status-feedback.js";
import { state } from "./state.js";

function selectedTeam() {
  return state.teams.find((team) => team.id === state.selectedTeamId) ?? state.teams[0] ?? null;
}

function sanitizeTmxFileName(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .trim();
  return normalized || "glossary";
}

async function saveTmxFilePath(options) {
  const save = window.__TAURI__?.dialog?.save;
  if (typeof save !== "function") {
    throw new Error("The native file save dialog is not available.");
  }
  return save(options);
}

export async function downloadGlossaryAsTmx(render, glossaryId, operations = {}) {
  const saveDialog = operations.saveDialog ?? saveTmxFilePath;
  const invokeCommand = operations.invoke ?? invoke;
  const team = selectedTeam();
  const glossary = state.glossaries.find((entry) => entry.id === glossaryId) ?? null;
  if (!Number.isFinite(team?.installationId) || !glossary?.repoName) {
    showNoticeBadge("The glossary is not available for export.", render);
    return;
  }

  const defaultFileName = `${sanitizeTmxFileName(glossary.title || glossary.repoName)}.tmx`;
  const outputPath = await saveDialog({
    title: "Export glossary as TMX",
    defaultPath: defaultFileName,
    filters: [
      {
        name: "TMX glossary",
        extensions: ["tmx"],
      },
    ],
  });
  if (!outputPath) {
    return;
  }

  try {
    await invokeCommand("export_gtms_glossary_to_tmx", {
      input: {
        installationId: team.installationId,
        repoName: glossary.repoName,
        glossaryId: glossary.id,
        outputPath,
      },
    });
    showNoticeBadge(`Exported ${defaultFileName}.`, render);
  } catch (error) {
    showNoticeBadge(formatErrorForDisplay(error), render);
  }
}
