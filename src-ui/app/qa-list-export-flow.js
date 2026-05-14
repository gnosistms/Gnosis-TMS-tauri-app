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
  return normalized || "qa-list";
}

async function saveTmxFilePath(options) {
  const save = window.__TAURI__?.dialog?.save;
  if (typeof save !== "function") {
    throw new Error("The native file save dialog is not available.");
  }
  return save(options);
}

export async function downloadQaListAsTmx(render, qaListId, operations = {}) {
  const saveDialog = operations.saveDialog ?? saveTmxFilePath;
  const invokeCommand = operations.invoke ?? invoke;
  const team = selectedTeam();
  const qaList = state.qaLists.find((entry) => entry.id === qaListId) ?? null;
  if (!Number.isFinite(team?.installationId) || !qaList?.repoName) {
    showNoticeBadge("The QA list is not available for export.", render);
    return;
  }

  const defaultFileName = `${sanitizeTmxFileName(qaList.title || qaList.repoName)}.tmx`;
  const outputPath = await saveDialog({
    title: "Export QA list as TMX",
    defaultPath: defaultFileName,
    filters: [
      {
        name: "TMX QA list",
        extensions: ["tmx"],
      },
    ],
  });
  if (!outputPath) {
    return;
  }

  try {
    await invokeCommand("export_gtms_qa_list_to_tmx", {
      input: {
        installationId: team.installationId,
        repoName: qaList.repoName,
        qaListId: qaList.id,
        outputPath,
      },
    });
    showNoticeBadge(`Exported ${defaultFileName}.`, render);
  } catch (error) {
    showNoticeBadge(formatErrorForDisplay(error), render);
  }
}
