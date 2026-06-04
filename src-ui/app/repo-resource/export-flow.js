import { formatErrorForDisplay } from "../error-display.js";
import { invoke } from "../runtime.js";
import { showNoticeBadge } from "../status-feedback.js";
import { state } from "../state.js";
import { resourceId, selectedTeam } from "./resource-descriptor.js";

function sanitizeTmxFileName(value, fallback) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .trim();
  return normalized || fallback;
}

async function saveTmxFilePath(options) {
  const save = window.__TAURI__?.dialog?.save;
  if (typeof save !== "function") {
    throw new Error("The native file save dialog is not available.");
  }
  return save(options);
}

export function createRepoResourceTmxExport(config) {
  return async function downloadResourceAsTmx(render, id, operations = {}) {
    const saveDialog = operations.saveDialog ?? saveTmxFilePath;
    const invokeCommand = operations.invoke ?? invoke;
    const team = selectedTeam({ fallbackToFirst: true });
    const resource = (Array.isArray(state[config.collectionField]) ? state[config.collectionField] : [])
      .find((entry) => resourceId(entry, config) === id) ?? null;
    if (!Number.isFinite(team?.installationId) || !resource?.repoName) {
      showNoticeBadge(config.unavailableMessage, render);
      return;
    }

    const defaultFileName = `${sanitizeTmxFileName(
      resource.title || resource.repoName,
      config.defaultFileBase,
    )}.tmx`;
    const outputPath = await saveDialog({
      title: config.dialogTitle,
      defaultPath: defaultFileName,
      filters: [
        {
          name: config.filterName,
          extensions: ["tmx"],
        },
      ],
    });
    if (!outputPath) {
      return;
    }

    try {
      await invokeCommand(config.command, {
        input: {
          installationId: team.installationId,
          repoName: resource.repoName,
          [config.resourceIdField]: resourceId(resource, config),
          outputPath,
        },
      });
      showNoticeBadge(`Exported ${defaultFileName}.`, render);
    } catch (error) {
      showNoticeBadge(formatErrorForDisplay(error), render);
    }
  };
}
