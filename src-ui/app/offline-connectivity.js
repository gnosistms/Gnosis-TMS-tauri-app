import { invoke, waitForNextPaint } from "./runtime.js";
import { loadStoredTeamRecords } from "./team-storage.js";
import { state } from "./state.js";
import { clearNoticeBadge, showNoticeBadge } from "./status-feedback.js";

export function hasOfflineData() {
  return loadStoredTeamRecords().length > 0;
}

export async function checkInternetConnection() {
  const browserThinksOnline = navigator.onLine !== false;

  if (invoke) {
    try {
      const nativeCheck = await invoke("check_internet_connection");
      return nativeCheck || browserThinksOnline;
    } catch {
      return browserThinksOnline;
    }
  }

  return browserThinksOnline;
}

export async function initializeConnectivity(render, restoreOnlineSession) {
  state.offline.hasLocalData = hasOfflineData();
  const hasConnection = await checkInternetConnection();
  state.offline.checked = true;
  state.offline.hasConnection = hasConnection;
  state.offline.isEnabled = false;

  if (!hasConnection) {
    state.screen = "start";
    render();
    return;
  }

  await restoreOnlineSession();
}

export function enableOfflineMode(render) {
  const shouldOpenOfflineHome = state.screen === "start";
  state.offline.isEnabled = true;
  state.auth.status = "idle";
  state.auth.message = "";
  state.offline.reconnecting = false;
  if (shouldOpenOfflineHome) {
    state.screen = "teams";
  }
  state.selectedTeamId = state.selectedTeamId ?? state.teams[0]?.id ?? null;
  clearNoticeBadge();
  render();
}

export async function reconnectOnlineMode(render, restoreOnlineSession) {
  if (!state.offline.isEnabled || state.offline.reconnecting) {
    return;
  }

  state.offline.reconnecting = true;
  clearNoticeBadge();
  render();
  await waitForNextPaint();

  const hasConnection = await checkInternetConnection();
  state.offline.checked = true;
  state.offline.hasConnection = hasConnection;

  if (!hasConnection) {
    state.offline.reconnecting = false;
    showNoticeBadge("Failed to connect", render);
    return;
  }

  state.offline.isEnabled = false;
  state.offline.reconnecting = false;
  clearNoticeBadge();
  render();
  await restoreOnlineSession({ preserveCurrentScreen: true });
}
