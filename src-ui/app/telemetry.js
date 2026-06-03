// Telemetry orchestrator (Sentry). See plans/telemetry-plan.md.
//
// Design constraints baked in here:
// - The Sentry SDK is imported DYNAMICALLY inside initTelemetry only, so importing this
//   module (e.g. transitively via runtime.js) never pulls @sentry/browser into the
//   `node --test` graph or the app's startup cost before consent is resolved.
// - Crash handlers install early and BUFFER until the send gate opens (first-run crash
//   exception). Routine command failures are only sent when the gate is already open.
// - Everything is fire-and-forget and wrapped so telemetry can never block or fail a
//   command, and never throws out of an error handler.

import { scrubString, scrubEvent, COMMAND_ERROR_MAX_LENGTH } from "./telemetry-scrub.js";
import {
  isTelemetrySendAllowed,
  isDisclosureShown,
  isTelemetryEnabled,
  resolveInstallId,
} from "./telemetry-consent.js";

const CRASH_BUFFER_LIMIT = 20;

let sentry = null; // the imported @sentry/browser namespace
let initialized = false;
let handlersInstalled = false;
const crashBuffer = []; // items captured before the send gate opened

function safe(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function gateOpen() {
  return safe(() => isTelemetrySendAllowed()) === true;
}

function emitCrash(item) {
  if (!sentry || !gateOpen()) {
    return false;
  }
  safe(() => {
    if (item.error instanceof Error) {
      sentry.captureException(item.error, {
        tags: { source: "first-run-crash", crash_kind: item.kind },
      });
    } else {
      sentry.captureMessage(scrubString(String(item.message ?? "crash")), "fatal");
    }
  });
  return true;
}

function bufferCrash(item) {
  crashBuffer.push(item);
  while (crashBuffer.length > CRASH_BUFFER_LIMIT) {
    crashBuffer.shift(); // drop oldest; keep the buffer bounded
  }
}

function routeCrash(item) {
  if (!emitCrash(item)) {
    bufferCrash(item);
  }
}

/**
 * Install global crash handlers as early as possible — before consent is resolved — so
 * first-run crashes are captured. Captured crashes are buffered and only transmitted
 * once the send gate opens (see refreshTelemetryState).
 */
export function installTelemetryCrashHandlers() {
  if (handlersInstalled || typeof window === "undefined") {
    return;
  }
  handlersInstalled = true;

  window.addEventListener("error", (event) => {
    safe(() => routeCrash({
      kind: "error",
      error: event?.error instanceof Error ? event.error : null,
      message: event?.message ?? event?.error?.message ?? "uncaught error",
    }));
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    safe(() => routeCrash({
      kind: "unhandledrejection",
      error: reason instanceof Error ? reason : null,
      message: reason instanceof Error ? reason.message : String(reason ?? "unhandled rejection"),
    }));
  });
}

function resolveDsn() {
  // Injected by Vite `define`; absent under `node --test` (typeof guard avoids a throw).
  return typeof __GNOSIS_SENTRY_DSN__ !== "undefined" ? String(__GNOSIS_SENTRY_DSN__).trim() : "";
}

function resolveRelease() {
  const version =
    typeof __GNOSIS_APP_VERSION__ !== "undefined" ? String(__GNOSIS_APP_VERSION__).trim() : "";
  return version ? `gnosis-tms@${version}` : undefined;
}

function resolveEnvironment() {
  return import.meta.env?.DEV === true ? "development" : "production";
}

/**
 * Initialize telemetry. No-ops cleanly when no DSN is configured (so this can ship
 * before the Sentry project exists) or when the SDK cannot be loaded. Safe to call once
 * after persistent storage is ready.
 */
export async function initTelemetry() {
  if (initialized) {
    return;
  }

  const dsn = resolveDsn();
  const installId = safe(() => resolveInstallId());
  if (!dsn) {
    // No destination configured — keep handlers buffering is pointless; drop the buffer
    // so it can't grow, but leave handlers installed (cheap) in case init runs later.
    crashBuffer.length = 0;
    return;
  }

  try {
    sentry = await import("@sentry/browser");
  } catch {
    sentry = null;
    crashBuffer.length = 0;
    return;
  }

  safe(() => sentry.init({
    dsn,
    release: resolveRelease(),
    environment: resolveEnvironment(),
    sendDefaultPii: false,
    autoSessionTracking: false,
    // Disable ALL default integrations: no auto breadcrumbs (console/dom/fetch/xhr/history),
    // no httpContext (URLs/headers), no auto global handlers (we capture crashes ourselves).
    defaultIntegrations: false,
    integrations: [],
    beforeBreadcrumb: () => null, // belt-and-suspenders: never record an auto breadcrumb
    beforeSend: scrubEvent,
  }));

  if (installId) {
    safe(() => sentry.setTag("install_id", installId));
  }

  initialized = true;
  refreshTelemetryState();
}

/**
 * Reconcile buffered crashes with the current consent state. Call after init, after the
 * disclosure is shown, and after the consent toggle changes.
 * - gate open  → flush buffered crashes
 * - disclosure shown but disabled (explicit opt-out) → discard buffered crashes + stop sending
 */
export function refreshTelemetryState() {
  const explicitlyOptedOut = safe(() => isDisclosureShown() && !isTelemetryEnabled()) === true;
  if (!initialized || !sentry) {
    if (explicitlyOptedOut) {
      crashBuffer.length = 0; // discard buffered first-run crashes before SDK init
    }
    return;
  }

  if (gateOpen()) {
    const pending = crashBuffer.splice(0, crashBuffer.length);
    for (const item of pending) {
      emitCrash(item);
    }
    return;
  }

  if (explicitlyOptedOut) {
    crashBuffer.length = 0; // discard — an explicit opt-out always wins
    safe(() => sentry.close?.());
  }
}

/**
 * Report a failed Tauri command. Routine telemetry: only sent when the gate is already
 * open. The command name is a tag; the error is scrubbed and length-capped. The payload
 * is never sent.
 */
export function reportCommandFailure(command, error) {
  if (!sentry || !gateOpen()) {
    return;
  }
  safe(() => {
    const message = scrubString(
      `${command}: ${error?.message ?? error ?? "unknown error"}`,
      COMMAND_ERROR_MAX_LENGTH,
    );
    sentry.captureMessage(message, {
      level: "error",
      tags: { source: "command-failure", command: String(command ?? "unknown") },
    });
  });
}
