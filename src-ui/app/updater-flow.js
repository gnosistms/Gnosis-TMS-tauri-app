import { invoke, listen } from "./runtime.js";
import { showNoticeBadge } from "./status-feedback.js";
import { state } from "./state.js";
import { confirmsKnownUpdateInstalled, storeKnownAppUpdate } from "./app-update-storage.js";

const APP_UPDATE_REQUIRED_PREFIX = "APP_UPDATE_REQUIRED:";
const APP_UPDATE_DOWNLOAD_PROGRESS_EVENT = "app-update-download-progress";
export const APP_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

let updateProgressListenerPromise = null;
let updateCheckIntervalId = null;
let latestUpdateCheckId = 0;
let prepareForUpdateInstall = async () => {
  throw new Error("The app is not ready to restart. Please try again.");
};

export function configureAppUpdateInstallation(prepare) {
  prepareForUpdateInstall = prepare;
}

function updateBusy() {
  return ["installing", "preparing", "restarting"].includes(state.appUpdate.status);
}

function updatesSupported() {
  return typeof invoke === "function";
}

function updateMessage(version) {
  return version ? `Update ${version} available` : "Update available";
}

function upToDateMessage(currentVersion) {
  return currentVersion ? `Gnosis TMS ${currentVersion} is up to date` : "Gnosis TMS is up to date";
}

function checkingForUpdatesMessage() {
  return "Checking for updates...";
}

function requestedUpdateVersion() {
  const version = String(state.appUpdate.version ?? "").trim();
  return version || null;
}

export function applyAppUpdateDownloadProgress(payload, render) {
  if (state.appUpdate.available !== true || state.appUpdate.status !== "installing") {
    return false;
  }

  const downloadedBytes = payload?.downloadedBytes;
  const totalBytes = payload?.totalBytes;
  const percent = payload?.percentage;
  state.appUpdate.downloadedBytes = Number.isFinite(downloadedBytes)
    ? Math.max(0, downloadedBytes)
    : state.appUpdate.downloadedBytes;
  state.appUpdate.totalBytes = Number.isFinite(totalBytes) && totalBytes > 0
    ? totalBytes
    : null;
  state.appUpdate.downloadPercent = Number.isFinite(percent)
    ? Math.max(0, Math.min(100, Math.round(percent)))
    : null;
  render?.({ scope: "app-update-progress" });
  return true;
}

export async function registerAppUpdateProgressListener(render, listenForEvent = listen) {
  if (updateProgressListenerPromise || typeof listenForEvent !== "function") {
    return updateProgressListenerPromise;
  }

  updateProgressListenerPromise = Promise.resolve(
    listenForEvent(APP_UPDATE_DOWNLOAD_PROGRESS_EVENT, (event) => {
      applyAppUpdateDownloadProgress(event?.payload, render);
    }),
  ).catch((error) => {
    updateProgressListenerPromise = null;
    throw error;
  });
  return updateProgressListenerPromise;
}

export function startAppUpdateChecks(render, options = {}) {
  void checkForAppUpdate(render, { silent: true });

  if (updateCheckIntervalId !== null) {
    return updateCheckIntervalId;
  }

  const schedule = options.schedule
    ?? (typeof window !== "undefined" && typeof window.setInterval === "function"
      ? window.setInterval.bind(window)
      : null);
  if (typeof schedule !== "function") {
    return null;
  }

  updateCheckIntervalId = schedule(() => {
    if (["checking", "installing", "restarting"].includes(state.appUpdate.status)) {
      return;
    }
    void checkForAppUpdate(render, { silent: true, prompt: false });
  }, APP_UPDATE_CHECK_INTERVAL_MS);
  return updateCheckIntervalId;
}

function normalizeRequiredAppUpdate(requirement) {
  if (!requirement || typeof requirement !== "object") {
    return null;
  }

  const requiredVersion =
    typeof requirement.requiredVersion === "string" && requirement.requiredVersion.trim()
      ? requirement.requiredVersion.trim()
      : null;
  const currentVersion =
    typeof requirement.currentVersion === "string" && requirement.currentVersion.trim()
      ? requirement.currentVersion.trim()
      : null;
  const message =
    typeof requirement.message === "string" && requirement.message.trim()
      ? requirement.message.trim()
      : "";
  if (!requiredVersion || !currentVersion) {
    return null;
  }

  return {
    requiredVersion,
    currentVersion,
    message,
  };
}

export function parseRequiredAppUpdateFromError(error) {
  const message = String(error?.message ?? error ?? "").trim();
  if (!message.startsWith(APP_UPDATE_REQUIRED_PREFIX)) {
    return null;
  }

  try {
    return normalizeRequiredAppUpdate(JSON.parse(message.slice(APP_UPDATE_REQUIRED_PREFIX.length)));
  } catch {
    return null;
  }
}

export function requireAppUpdate(requirement, render) {
  const normalized = normalizeRequiredAppUpdate(requirement);
  if (!normalized) {
    return false;
  }

  latestUpdateCheckId += 1;

  try {
    document.activeElement?.blur?.();
  } catch {}

  state.appUpdate = {
    ...state.appUpdate,
    status:
      updateBusy() || state.appUpdate.status === "downloaded"
        ? state.appUpdate.status
        : "available",
    error: "",
    message: normalized.message,
    available: true,
    required: true,
    version: normalized.requiredVersion,
    currentVersion: normalized.currentVersion,
    promptVisible: true,
    dismissedVersion: null,
    downloadPercent: null,
    downloadedBytes: 0,
    totalBytes: null,
  };
  storeKnownAppUpdate(state.appUpdate);
  render?.();
  return true;
}

function shouldShowUpdatePrompt(update, options, dismissedVersion) {
  if (update.available !== true || options.prompt === false) {
    return false;
  }

  if (options.forcePrompt === true || options.silent !== true) {
    return true;
  }

  return update.version !== dismissedVersion;
}

export async function checkForAppUpdate(render, options = {}) {
  if (!updatesSupported() || updateBusy() || state.appUpdate.status === "downloaded") {
    return;
  }

  const silent = options.silent === true;
  const checkId = ++latestUpdateCheckId;
  const dismissedVersion = state.appUpdate.dismissedVersion ?? null;
  state.appUpdate.status = "checking";
  if (!silent) {
    state.appUpdate.error = "";
    showNoticeBadge(checkingForUpdatesMessage(), render, null);
    render();
  }

  try {
    const update = await invoke("check_for_app_update");
    if (checkId !== latestUpdateCheckId) {
      return;
    }
    const requiredUpdateActive = state.appUpdate.required === true
      && !confirmsKnownUpdateInstalled(update, state.appUpdate);
    const promptVisible = shouldShowUpdatePrompt(update, options, dismissedVersion);
    const version = update.version ?? null;
    const message =
      typeof update.message === "string" && update.message.trim()
        ? update.message.trim()
        : "";
    if (update.available !== true && state.appUpdate.available
        && !confirmsKnownUpdateInstalled(update, state.appUpdate)) {
      state.appUpdate.status = "available";
      if (!requiredUpdateActive) state.appUpdate.message = message;
      render();
      if (!silent) showNoticeBadge(message || "The known update has not been installed yet.", render, 3200);
      return;
    }
    state.appUpdate = {
      status: update.available ? "available" : "idle",
      error: "",
      message: requiredUpdateActive === true ? state.appUpdate.message : message,
      available: requiredUpdateActive === true ? true : update.available === true,
      required: requiredUpdateActive,
      version: requiredUpdateActive === true ? state.appUpdate.version : version,
      currentVersion:
        requiredUpdateActive === true
          ? state.appUpdate.currentVersion ?? update.currentVersion ?? null
          : update.currentVersion ?? null,
      body: update.body ?? null,
      promptVisible: requiredUpdateActive === true ? true : promptVisible,
      dismissedVersion:
        requiredUpdateActive === true
          ? null
          : update.available === true && version === dismissedVersion && promptVisible !== true
          ? dismissedVersion
          : null,
      downloadPercent: null,
      downloadedBytes: 0,
      totalBytes: null,
    };
    storeKnownAppUpdate(state.appUpdate);
    render();

    if (requiredUpdateActive === true) {
      showNoticeBadge(state.appUpdate.message || updateMessage(state.appUpdate.version), render, null);
    } else if (update.available === true) {
      showNoticeBadge(updateMessage(update.version), render, null);
    } else if (!silent) {
      showNoticeBadge(message || upToDateMessage(update.currentVersion), render, 2200);
    }
  } catch (error) {
    if (checkId !== latestUpdateCheckId) {
      return;
    }
    state.appUpdate.status = "error";
    state.appUpdate.error = error?.message ?? String(error);
    if (state.appUpdate.required !== true) {
      state.appUpdate.message = "";
    }
    render();
    if (!silent) {
      showNoticeBadge(state.appUpdate.error || "Could not check for updates.", render, 3200);
    }
  }
}

export async function installAppUpdate(render) {
  if (!updatesSupported() || updateBusy()) {
    return;
  }

  if (state.appUpdate.status === "downloaded") {
    latestUpdateCheckId += 1;
    state.appUpdate.status = "preparing";
    state.appUpdate.promptVisible = true;
    state.appUpdate.error = "";
    try {
      document.activeElement?.blur?.();
      render();
      await prepareForUpdateInstall(render);
      state.appUpdate.status = "restarting";
      render();
      await invoke("install_app_update", { requestedVersion: requestedUpdateVersion() });
    } catch (error) {
      // The native payload is retained on install failure, so this is retryable.
      state.appUpdate.error = error?.message ?? String(error);
      state.appUpdate.status = state.appUpdate.error.startsWith("APP_UPDATE_DOWNLOAD_REQUIRED:")
        ? "installError" : "downloaded";
      state.appUpdate.error = state.appUpdate.error.replace(/^APP_UPDATE_DOWNLOAD_REQUIRED:/, "");
      render();
    }
    return;
  }

  latestUpdateCheckId += 1;
  state.appUpdate.status = "installing";
  state.appUpdate.error = "";
  if (state.appUpdate.required !== true) {
    state.appUpdate.message = "";
  }
  state.appUpdate.promptVisible = state.appUpdate.required === true;
  state.appUpdate.dismissedVersion = null;
  state.appUpdate.downloadPercent = 0;
  state.appUpdate.downloadedBytes = 0;
  state.appUpdate.totalBytes = null;
  render();

  try {
    await invoke("download_app_update", { requestedVersion: requestedUpdateVersion() });
    state.appUpdate.status = "downloaded";
    state.appUpdate.downloadPercent = 100;
    render();
  } catch (error) {
    state.appUpdate.status = "installError";
    state.appUpdate.error = error?.message ?? String(error);
    state.appUpdate.promptVisible = true;
    state.appUpdate.downloadPercent = null;
    render();
  }
}

export function dismissAppUpdatePrompt(render) {
  if (state.appUpdate.required === true) {
    return;
  }
  state.appUpdate.promptVisible = false;
  state.appUpdate.error = "";
  state.appUpdate.dismissedVersion = state.appUpdate.version ?? null;
  storeKnownAppUpdate(state.appUpdate);
  render();
}
