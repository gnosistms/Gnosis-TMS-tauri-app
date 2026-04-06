import { invoke, waitForNextPaint } from "./runtime.js";
import { completePageSync, failPageSync, beginPageSync } from "./page-sync.js";
import { state } from "./state.js";
import {
  clearScopedSyncBadge,
  showNoticeBadge,
  showScopedSyncBadge,
} from "./status-feedback.js";

function openSpreadsheetPicker() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    input.style.display = "none";

    const cleanup = () => {
      input.removeEventListener("change", handleChange);
      input.removeEventListener("cancel", handleCancel);
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
    };

    const handleChange = () => {
      const file = input.files?.[0] ?? null;
      cleanup();
      resolve(file);
    };

    const handleCancel = () => {
      cleanup();
      resolve(null);
    };

    input.addEventListener("change", handleChange, { once: true });
    input.addEventListener("cancel", handleCancel, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

export async function importXlsxWorkbook(render) {
  if (state.projectImport.status === "importing") {
    return;
  }

  const selectedFile = await openSpreadsheetPicker();
  if (!selectedFile) {
    return;
  }

  state.projectImport = {
    status: "importing",
    error: "",
    result: state.projectImport.result,
  };
  beginPageSync();
  showScopedSyncBadge("projects", "Importing workbook...", render);
  render();
  await waitForNextPaint();

  try {
    const bytes = Array.from(new Uint8Array(await selectedFile.arrayBuffer()));
    const result = await invoke("import_xlsx_to_gtms", {
      input: {
        fileName: selectedFile.name,
        bytes,
      },
    });

    state.projectImport = {
      status: "ready",
      error: "",
      result,
    };
    clearScopedSyncBadge("projects", render);
    await completePageSync(render);
    showNoticeBadge(`Imported ${result.unitCount} rows from ${result.sourceFileName}`, render);
  } catch (error) {
    state.projectImport = {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      result: state.projectImport.result,
    };
    clearScopedSyncBadge("projects", render);
    failPageSync();
    render();
  }
}
