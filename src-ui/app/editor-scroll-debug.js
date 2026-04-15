import { invoke } from "./runtime.js";

const EDITOR_SCROLL_DEBUG_BATCH_SIZE = 24;
const EDITOR_SCROLL_DEBUG_FLUSH_DELAY_MS = 800;
const WINDOWS_EDITOR_SCROLL_DEBUG_PATH_HINT = "%AppData%\\com.gnosis.tms\\logs\\editor-scroll-debug.jsonl";
const MACOS_EDITOR_SCROLL_DEBUG_PATH_HINT =
  "~/Library/Application Support/com.gnosis.tms/logs/editor-scroll-debug.jsonl";

let queuedLines = [];
let flushTimerId = 0;
let activeFlushPromise = null;

function platformName() {
  if (typeof navigator !== "object") {
    return "";
  }

  return navigator.userAgentData?.platform ?? navigator.platform ?? "";
}

function shouldLogEditorScrollDebug() {
  return typeof invoke === "function" && /win|mac/i.test(platformName());
}

function normalizeDebugValue(value, depth = 0) {
  if (value === null) {
    return null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === "string") {
    return value.length > 240 ? `${value.slice(0, 237)}...` : value;
  }

  if (Array.isArray(value)) {
    if (depth >= 2) {
      return `[array:${value.length}]`;
    }

    return value.slice(0, 12).map((entry) => normalizeDebugValue(entry, depth + 1));
  }

  if (typeof value === "object") {
    if (depth >= 2) {
      return "[object]";
    }

    const normalized = {};
    for (const [key, entry] of Object.entries(value).slice(0, 16)) {
      normalized[key] = normalizeDebugValue(entry, depth + 1);
    }
    return normalized;
  }

  return String(value);
}

function scheduleEditorScrollDebugFlush() {
  if (flushTimerId || queuedLines.length === 0) {
    return;
  }

  flushTimerId = window.setTimeout(() => {
    flushTimerId = 0;
    void flushEditorScrollDebugLog();
  }, EDITOR_SCROLL_DEBUG_FLUSH_DELAY_MS);
}

export function editorScrollDebugPathHint() {
  return /mac/i.test(platformName())
    ? MACOS_EDITOR_SCROLL_DEBUG_PATH_HINT
    : WINDOWS_EDITOR_SCROLL_DEBUG_PATH_HINT;
}

export function logEditorScrollDebug(event, detail = {}) {
  if (!shouldLogEditorScrollDebug() || typeof event !== "string" || !event.trim()) {
    return;
  }

  queuedLines.push(JSON.stringify({
    ts: new Date().toISOString(),
    event: event.trim(),
    detail: normalizeDebugValue(detail),
  }));

  if (queuedLines.length >= EDITOR_SCROLL_DEBUG_BATCH_SIZE) {
    void flushEditorScrollDebugLog();
    return;
  }

  scheduleEditorScrollDebugFlush();
}

export async function flushEditorScrollDebugLog() {
  if (!shouldLogEditorScrollDebug()) {
    queuedLines = [];
    return;
  }

  if (activeFlushPromise) {
    return activeFlushPromise;
  }

  if (flushTimerId) {
    window.clearTimeout(flushTimerId);
    flushTimerId = 0;
  }

  const lines = queuedLines.splice(0, EDITOR_SCROLL_DEBUG_BATCH_SIZE);
  if (lines.length === 0) {
    return;
  }

  activeFlushPromise = (async () => {
    try {
      await invoke("append_editor_scroll_debug_log", { lines });
    } catch {
      // Ignore debug logging failures so they never interfere with editing.
    } finally {
      activeFlushPromise = null;
      if (queuedLines.length > 0) {
        scheduleEditorScrollDebugFlush();
      }
    }
  })();

  return activeFlushPromise;
}

if (typeof window === "object") {
  window.addEventListener("beforeunload", () => {
    if (queuedLines.length > 0) {
      void flushEditorScrollDebugLog();
    }
  });
}
