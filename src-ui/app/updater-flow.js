import { invoke } from "./runtime.js";
import { showNoticeBadge } from "./status-feedback.js";
import { state } from "./state.js";

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
  if (!updatesSupported()) {
    return;
  }

  const silent = options.silent === true;
  const dismissedVersion = state.appUpdate.dismissedVersion ?? null;
  state.appUpdate.status = "checking";
  if (!silent) {
    state.appUpdate.error = "";
    showNoticeBadge(checkingForUpdatesMessage(), render, null);
    render();
  }

  try {
    const update = await invoke("check_for_app_update");
    const promptVisible = shouldShowUpdatePrompt(update, options, dismissedVersion);
    const version = update.version ?? null;
    const message =
      typeof update.message === "string" && update.message.trim()
        ? update.message.trim()
        : "";
    state.appUpdate = {
      status: update.available ? "available" : "idle",
      error: "",
      message,
      available: update.available === true,
      version,
      currentVersion: update.currentVersion ?? null,
      body: update.body ?? null,
      promptVisible,
      dismissedVersion:
        update.available === true && version === dismissedVersion && promptVisible !== true
          ? dismissedVersion
          : null,
    };
    render();

    if (update.available === true) {
      showNoticeBadge(updateMessage(update.version), render, null);
    } else if (!silent) {
      showNoticeBadge(message || upToDateMessage(update.currentVersion), render, 2200);
    }
  } catch (error) {
    state.appUpdate.status = "error";
    state.appUpdate.error = error?.message ?? String(error);
    state.appUpdate.message = "";
    render();
    if (!silent) {
      showNoticeBadge(state.appUpdate.error || "Could not check for updates.", render, 3200);
    }
  }
}

export async function installAppUpdate(render) {
  if (!updatesSupported()) {
    return;
  }

  state.appUpdate.status = "installing";
  state.appUpdate.error = "";
  state.appUpdate.message = "";
  state.appUpdate.promptVisible = true;
  state.appUpdate.dismissedVersion = null;
  render();

  try {
    await invoke("install_app_update");
    state.appUpdate.status = "restarting";
    render();
  } catch (error) {
    state.appUpdate.status = "available";
    state.appUpdate.error = error?.message ?? String(error);
    state.appUpdate.promptVisible = true;
    render();
  }
}

export function dismissAppUpdatePrompt(render) {
  state.appUpdate.promptVisible = false;
  state.appUpdate.error = "";
  state.appUpdate.dismissedVersion = state.appUpdate.version ?? null;
  render();
}
