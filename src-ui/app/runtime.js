export const app = document.querySelector("#app");

const tauri = window.__TAURI__ ?? {};
const rawInvoke = tauri.core?.invoke?.bind(tauri.core);

export const listen = tauri.event?.listen?.bind(tauri.event);

let pendingBrokerSessionRefresh = null;

export const invoke = rawInvoke
  ? async function invoke(command, payload = {}) {
      try {
        return await rawInvoke(command, payload);
      } catch (error) {
        if (!shouldAttemptBrokerSessionRefresh(command, payload, error)) {
          throw error;
        }

        const currentSessionToken = extractBrokerSessionToken(payload);
        const refreshedSession = await refreshBrokerSession(currentSessionToken).catch(() => null);
        if (!refreshedSession?.sessionToken) {
          throw new Error("AUTH_REQUIRED:Your GitHub session expired. Please log in with GitHub again to continue.");
        }

        return rawInvoke(command, updatePayloadSessionToken(payload, refreshedSession.sessionToken));
      }
    }
  : null;

export function openExternalUrl(url) {
  const opener = window.__TAURI__?.opener;
  if (opener?.openUrl) {
    opener.openUrl(url);
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

export function waitForNextPaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

export async function initializeWindowPresentation() {
  if (!isMacPlatform()) {
    document.documentElement.classList.remove("app-window--mac-fullscreen");
    return;
  }

  const syncPresentation = async () => {
    const isFullscreen = await readIsFullscreen();
    document.documentElement.classList.toggle("app-window--mac-fullscreen", isFullscreen);
  };

  await syncPresentation();
  window.addEventListener("resize", () => {
    void syncPresentation();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void syncPresentation();
    }
  });
}

function shouldAttemptBrokerSessionRefresh(command, payload, error) {
  if (!rawInvoke) {
    return false;
  }

  if (
    command === "refresh_broker_auth_session"
    || command === "save_broker_auth_session"
    || command === "load_broker_auth_session"
    || command === "clear_broker_auth_session"
    || command === "begin_broker_auth"
  ) {
    return false;
  }

  if (!extractBrokerSessionToken(payload)) {
    return false;
  }

  const message = String(error?.message ?? error ?? "").trim().toLowerCase();
  return (
    message.startsWith("auth_required:")
    || message.includes("your github session expired")
    || message.includes("bad credentials")
    || message.includes("github api 401")
    || message === "unauthorized"
  );
}

function extractBrokerSessionToken(payload) {
  if (payload && typeof payload === "object" && typeof payload.sessionToken === "string") {
    const sessionToken = payload.sessionToken.trim();
    return sessionToken || null;
  }

  return null;
}

function updatePayloadSessionToken(payload, sessionToken) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  if (!("sessionToken" in payload)) {
    return payload;
  }

  return {
    ...payload,
    sessionToken,
  };
}

async function refreshBrokerSession(sessionToken) {
  if (pendingBrokerSessionRefresh) {
    return pendingBrokerSessionRefresh;
  }

  pendingBrokerSessionRefresh = (async () => {
    const refreshedSession = await rawInvoke("refresh_broker_auth_session", { sessionToken });
    if (!refreshedSession?.sessionToken || !refreshedSession?.login) {
      throw new Error("GitHub session refresh failed.");
    }

    const { state } = await import("./state.js");
    if (
      !state.auth.session
      || state.auth.session.sessionToken === sessionToken
    ) {
      state.auth = {
        ...state.auth,
        session: refreshedSession,
      };
    }

    try {
      await rawInvoke("save_broker_auth_session", { session: refreshedSession });
    } catch {
      // Ignore local persistence failures and continue with the refreshed in-memory session.
    }

    return refreshedSession;
  })();

  try {
    return await pendingBrokerSessionRefresh;
  } finally {
    pendingBrokerSessionRefresh = null;
  }
}

function isMacPlatform() {
  const platform =
    navigator.userAgentData?.platform
    ?? navigator.platform
    ?? "";
  return /mac/i.test(platform);
}

async function readIsFullscreen() {
  if (!rawInvoke) {
    return false;
  }

  const label = window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
  if (typeof label !== "string" || !label.trim()) {
    return false;
  }

  try {
    return (await rawInvoke("plugin:window|is_fullscreen", { label })) === true;
  } catch {
    return false;
  }
}
