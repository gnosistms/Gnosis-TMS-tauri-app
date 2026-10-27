import { invoke } from "./runtime.js";
import { showNoticeBadge } from "./status-feedback.js";

let isSaving = false;

export async function downloadProjectImportSample(render, operations = {}) {
  if (isSaving) return;
  isSaving = true;
  try {
    const saveDialog = operations.saveDialog ?? globalThis.window?.__TAURI__?.dialog?.save;
    if (typeof saveDialog !== "function") {
      throw new Error("The native file save dialog is not available.");
    }
    const outputPath = await saveDialog({
      title: "Save Gnosis TMS import sample",
      defaultPath: "Gnosis TMS Import Sample.xlsx",
      filters: [{ name: "Excel workbook", extensions: ["xlsx"] }],
    });
    if (!outputPath) return;
    await (operations.invokeCommand ?? invoke)("save_project_import_sample", { outputPath });
    showNoticeBadge("Import sample saved.", render);
  } catch (error) {
    showNoticeBadge(error instanceof Error ? error.message : String(error), render, 6000);
  } finally {
    isSaving = false;
  }
}
