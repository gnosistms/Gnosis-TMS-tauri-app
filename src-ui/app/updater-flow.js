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

export async function checkForAppUpdate(render, options = {}) {
  if (!updatesSupported()) {
    return;
  }

  const silent = options.silent === true;
  state.appUpdate.status = "checking";
  if (!silent) {
    state.appUpdate.error = "";
    render();
  }

  try {
    const update = await invoke("check_for_app_update");
    state.appUpdate = {
      status: update.available ? "available" : "idle",
      error: "",
      available: update.available === true,
      version: update.version ?? null,
      currentVersion: update.currentVersion ?? null,
      body: update.body ?? null,
    };
    render();

    if (update.available === true) {
      showNoticeBadge(updateMessage(update.version), render, null);
    } else if (!silent) {
      showNoticeBadge(upToDateMessage(update.currentVersion), render, 2200);
    }
  } catch (error) {
    state.appUpdate.status = "error";
    state.appUpdate.error = error?.message ?? String(error);
    render();
  }
}

export async function installAppUpdate(render) {
  state.appUpdate.status = "installing";
  state.appUpdate.error = "";
  render();

  try {
    await invoke("install_app_update");
    state.appUpdate.status = "restarting";
    render();
  } catch (error) {
    state.appUpdate.status = "available";
    state.appUpdate.error = error?.message ?? String(error);
    render();
  }
}
