import { invoke } from "./runtime.js";
import { showNoticeBadge } from "./status-feedback.js";
import { state } from "./state.js";

const APP_UPDATE_REQUIRED_PREFIX = "APP_UPDATE_REQUIRED:";

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

  try {
    document.activeElement?.blur?.();
  } catch {}

  state.appUpdate = {
    ...state.appUpdate,
    status:
      state.appUpdate.status === "installing" || state.appUpdate.status === "restarting"
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
  };
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
  if (!updatesSupported()) {
    return;
  }

  const silent = options.silent === true;
  const dismissedVersion = state.appUpdate.dismissedVersion ?? null;
  const requiredUpdateActive = state.appUpdate.required === true;
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
    };
    render();

    if (requiredUpdateActive === true) {
      showNoticeBadge(state.appUpdate.message || updateMessage(state.appUpdate.version), render, null);
    } else if (update.available === true) {
      showNoticeBadge(updateMessage(update.version), render, null);
    } else if (!silent) {
      showNoticeBadge(message || upToDateMessage(update.currentVersion), render, 2200);
    }
  } catch (error) {
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
  if (!updatesSupported()) {
    return;
  }

  state.appUpdate.status = "installing";
  state.appUpdate.error = "";
  if (state.appUpdate.required !== true) {
    state.appUpdate.message = "";
  }
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
  if (state.appUpdate.required === true) {
    return;
  }
  state.appUpdate.promptVisible = false;
  state.appUpdate.error = "";
  state.appUpdate.dismissedVersion = state.appUpdate.version ?? null;
  render();
}
