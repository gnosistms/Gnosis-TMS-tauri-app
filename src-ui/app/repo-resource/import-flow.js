import { enforceImportFileSizeLimit } from "../import-file-limit.js";
import { openLocalFilePicker } from "../local-file-picker.js";
import { clearResourceCreateProgress } from "../resource-create-flow.js";
import { submitResourcePageWrite } from "../resource-page-controller.js";

function readableImportFileLike(value) {
  return value && typeof value === "object" && typeof value.arrayBuffer === "function";
}

function droppedPathFileLike(value) {
  return value && typeof value === "object" && typeof value.dataBase64 === "string";
}

export function importFileName(value, fallback = "file") {
  const name = typeof value?.name === "string" ? value.name.trim() : "";
  return name || fallback;
}

export function decodeBase64ToBytes(dataBase64) {
  const normalized = typeof dataBase64 === "string" ? dataBase64.trim() : "";
  if (!normalized) {
    throw new Error("The file could not be read.");
  }

  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(normalized);
    return Array.from(binary, (character) => character.charCodeAt(0));
  }

  if (typeof Buffer === "function") {
    return Array.from(Buffer.from(normalized, "base64"));
  }

  throw new Error("Base64 decoding is unavailable.");
}

export async function importFileBytes(file) {
  if (readableImportFileLike(file)) {
    enforceImportFileSizeLimit(file.size, importFileName(file));
    return Array.from(new Uint8Array(await file.arrayBuffer()));
  }

  if (droppedPathFileLike(file)) {
    return decodeBase64ToBytes(file.dataBase64);
  }

  throw new Error("The file could not be read.");
}

export function createRepoResourceImportFlow(descriptor) {
  const {
    accept,
    pageState,
    syncController,
    setProgress,
    clearProgress,
    isImportModalOpen,
    isImporting,
    importFile,
    setImportError,
    selectedTeamMatches,
    upsertForTeam,
    resultResourceField,
  } = descriptor;

  async function selectImportFile(render) {
    if (isImporting?.() || !isImportModalOpen?.()) {
      return;
    }

    const selectedFile = await (descriptor.openFilePicker ?? openLocalFilePicker)({ accept });
    if (!selectedFile) {
      return;
    }

    await importFile(render, selectedFile);
  }

  function upsertCreatedResourceForTeam(team, result, render = null) {
    const resource = result?.[resultResourceField];
    if (selectedTeamMatches?.(team) && resource) {
      upsertForTeam(team, resource, render, { preserveCreate: true });
      return true;
    }
    return false;
  }

  async function submitImportWrite(render, options = {}) {
    return await submitResourcePageWrite({
      pageState: pageState(),
      syncController,
      setProgress: (text) => setProgress(render, text),
      clearProgress,
      render,
      onBlocked: options.onBlocked,
      runMutation: options.runMutation,
      refreshOptions: {
        progressLabels: {
          refreshing: options.refreshProgressText,
        },
        loadData: async () => {
          return await options.loadData?.();
        },
      },
      onSuccess: async (result) => {
        clearResourceCreateProgress();
        await options.onSuccess?.(result);
      },
      onError: async (error) => {
        clearResourceCreateProgress();
        await options.onError?.(error);
      },
    });
  }

  return {
    importFileBytes,
    importFileName,
    selectImportFile,
    submitImportWrite,
    upsertCreatedResourceForTeam,
  };
}
