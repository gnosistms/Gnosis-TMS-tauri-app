import { state } from "./state.js";
import { readDevRuntimeFlags } from "./dev-runtime-flags.js";

export const app = document.querySelector("#app");

const tauri = window.__TAURI__ ?? {};
const rawInvoke = tauri.core?.invoke?.bind(tauri.core);

export const listen = tauri.event?.listen?.bind(tauri.event);

const TAURI_DRAG_DROP_EVENTS = [
  ["tauri://drag-enter", "enter"],
  ["tauri://drag-over", "over"],
  ["tauri://drag-drop", "drop"],
  ["tauri://drag-leave", "leave"],
];

function normalizeTauriDragDropPayload(event, type) {
  const payload = event?.payload ?? {};
  return {
    ...event,
    payload: {
      type,
      paths: Array.isArray(payload.paths) ? payload.paths : [],
      position: payload.position ?? null,
    },
  };
}

export async function onCurrentWebviewDragDrop(handler) {
  if (typeof listen === "function") {
    const unlisteners = await Promise.all(
      TAURI_DRAG_DROP_EVENTS.map(([eventName, type]) => (
        listen(eventName, (event) => {
          handler(normalizeTauriDragDropPayload(event, type));
        })
      )),
    );

    return () => {
      for (const unlisten of unlisteners) {
        if (typeof unlisten === "function") {
          unlisten();
        }
      }
    };
  }

  const getCurrentWebview = tauri.webview?.getCurrentWebview;
  if (typeof getCurrentWebview === "function") {
    try {
      const currentWebview = getCurrentWebview();
      if (typeof currentWebview?.onDragDropEvent === "function") {
        return currentWebview.onDragDropEvent(handler);
      }
    } catch {
      return null;
    }
  }

  return null;
}

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

export function convertLocalFileSrc(filePath) {
  const normalizedPath = typeof filePath === "string" ? filePath.trim() : "";
  if (!normalizedPath) {
    return "";
  }

  const convertFileSrc = window.__TAURI_INTERNALS__?.convertFileSrc;
  if (typeof convertFileSrc === "function") {
    return convertFileSrc(normalizedPath, "asset");
  }

  return normalizedPath;
}

export function waitForNextPaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

export async function initializeWindowPresentation() {
  const documentElement = document.documentElement;
  const isMac = isMacPlatform();
  const isWindows = isWindowsPlatform();

  documentElement.classList.toggle("app-platform--mac", isMac);
  documentElement.classList.toggle("app-platform--windows", isWindows);

  if (!isMac) {
    documentElement.classList.remove("app-window--mac-fullscreen");
    return;
  }

  const syncPresentation = async () => {
    const isFullscreen = await readIsFullscreen();
    documentElement.classList.toggle("app-window--mac-fullscreen", isFullscreen);
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

function platformName() {
  const platformOverride = readDevRuntimeFlags().platformOverride;
  if (platformOverride === "windows") {
    return "Windows";
  }

  if (platformOverride === "mac") {
    return "Mac";
  }

  return (
    navigator.userAgentData?.platform
    ?? navigator.platform
    ?? ""
  );
}

export function isMacPlatform() {
  return /mac/i.test(platformName());
}

export function isWindowsPlatform() {
  return /win/i.test(platformName());
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
