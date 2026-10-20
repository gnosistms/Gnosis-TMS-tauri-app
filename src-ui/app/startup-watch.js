// Reports a slow or stuck startup to Sentry: from launch until the team list is ready.
// See plans/slow-startup-report-plan.md.
//
// At most two warnings per launch, grouped as one Sentry issue: "waiting" once the user
// has waited STARTUP_REPORT_AFTER_MS (sent while it happens, so it arrives even if they
// quit), and "finished" when such a wait ends. Payloads hold timings, command names and
// state labels only. Keys avoid the scrubber's sensitive substrings (auth, session,
// token...), otherwise scrubEvent would redact them.

import { state } from "./state.js";
import { readInvokeActivity, stopInvokeActivityRecording } from "./invoke-activity.js";
import { readPersistentValue, writePersistentValue } from "./persistent-store.js";
import { isMacPlatform, isWindowsPlatform } from "./runtime.js";
import { reportSlowStartup } from "./telemetry.js";

export const STARTUP_REPORT_AFTER_MS = 30_000;
export const STARTUP_WATCH_MAX_MS = 10 * 60_000;
const STARTUP_WATCH_TICK_MS = 1_000;
const SLOW_CALL_MS = 250;
const MAX_REPORTED_CALLS = 40;
const MAX_STARTUP_STEPS = 20;
const LAST_LAUNCHED_VERSION_KEY = "last-launched-app-version";

const startupSteps = [];
let launchVersions = { appVersion: currentAppVersion(), previousVersion: null, known: false };
let activeWatch = null;

function currentTimeMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function currentAppVersion() {
  return typeof __GNOSIS_APP_VERSION__ !== "undefined" ? String(__GNOSIS_APP_VERSION__).trim() : "";
}

function platformLabel() {
  if (isWindowsPlatform()) {
    return "windows";
  }
  if (isMacPlatform()) {
    return "mac";
  }
  return /linux/i.test(globalThis.navigator?.platform ?? "") ? "linux" : "other";
}

/** Mark a bootstrap step as done (time since the page started loading). */
export function noteStartupStep(step) {
  if (startupSteps.length < MAX_STARTUP_STEPS) {
    startupSteps.push({ step: String(step), atMs: Math.round(currentTimeMs()) });
  }
}

/**
 * Read which version ran on this install before, then record this one. Needs the
 * persistent store; writes only when the version changed.
 */
export function rememberLaunchedVersion() {
  const appVersion = currentAppVersion();
  const previous = readPersistentValue(LAST_LAUNCHED_VERSION_KEY);
  launchVersions = {
    appVersion,
    previousVersion: typeof previous === "string" && previous ? previous : null,
    known: true,
  };
  if (appVersion && previous !== appVersion) {
    writePersistentValue(LAST_LAUNCHED_VERSION_KEY, appVersion);
  }
}

function hasStep(steps, step) {
  return steps.some((entry) => entry.step === step);
}

/**
 * What the user is waiting for during startup, or null when they are no longer waiting
 * (team list ready or failed, start/offline screen, or they opened a team).
 */
export function describeStartupStage(appState, steps = []) {
  if (!hasStep(steps, "storage_ready")) {
    return "storage";
  }
  if (!hasStep(steps, "app_state_loaded")) {
    return "app_state";
  }
  if (!hasStep(steps, "window_ready")) {
    return "window";
  }
  if (!hasStep(steps, "saved_login_loaded")) {
    return "loading_saved_login";
  }
  const offline = appState?.offline ?? {};
  if (!offline.checked) {
    return "internet_check";
  }
  if (!offline.hasConnection || offline.isEnabled) {
    return null;
  }
  const signInStatus = appState?.auth?.status;
  if (signInStatus === "booting" || signInStatus === "restoring") {
    return "checking_login";
  }
  if (
    appState?.screen === "teams"
    && (appState?.orgDiscovery?.status === "loading" || appState?.teamsPage?.isRefreshing === true)
  ) {
    return Array.isArray(appState?.teams) && appState.teams.length > 0
      ? "team_list_refresh"
      : "team_list";
  }
  return null;
}

function describeStartupOutcome(appState) {
  const offline = appState?.offline ?? {};
  if (offline.checked && (!offline.hasConnection || offline.isEnabled)) {
    return "offline";
  }
  if (appState?.screen === "start") {
    return "start_screen";
  }
  if (appState?.screen === "teams") {
    return appState?.orgDiscovery?.status === "error" ? "team_list_error" : "team_list_ready";
  }
  return "other_screen";
}

function afterUpdateLabel(versions) {
  if (!versions?.known || !versions.previousVersion || !versions.appVersion) {
    return "unknown";
  }
  return versions.previousVersion === versions.appVersion ? "no" : "yes";
}

function describeView(appState) {
  return {
    screen: String(appState?.screen ?? ""),
    signInStatus: String(appState?.auth?.status ?? ""),
    internetChecked: appState?.offline?.checked === true,
    online: appState?.offline?.hasConnection === true,
    offlineMode: appState?.offline?.isEnabled === true,
    teamListStatus: String(appState?.orgDiscovery?.status ?? ""),
    teamListRefreshing: appState?.teamsPage?.isRefreshing === true,
    teamCount: Array.isArray(appState?.teams) ? appState.teams.length : 0,
  };
}

export function buildSlowStartupReport({
  phase,
  stage,
  outcome = null,
  elapsedMs,
  appState,
  activity = { calls: [], droppedCallCount: 0 },
  steps = [],
  versions = launchVersions,
  platform = "other",
  longestTickGapMs = 0,
}) {
  const round = (value) => Math.round(Number(value) || 0);
  const calls = Array.isArray(activity?.calls) ? activity.calls : [];
  const waitingCalls = calls
    .filter((call) => call.endMs === null)
    .slice(0, MAX_REPORTED_CALLS)
    .map((call) => ({
      command: call.command,
      startMs: round(call.startMs),
      waitedMs: round(elapsedMs - call.startMs),
    }));
  const slowCalls = calls
    .filter((call) => call.endMs !== null && (call.endMs - call.startMs >= SLOW_CALL_MS || call.errorType))
    .slice(0, MAX_REPORTED_CALLS)
    .map((call) => ({
      command: call.command,
      startMs: round(call.startMs),
      tookMs: round(call.endMs - call.startMs),
      ...(call.errorType ? { errorType: call.errorType } : {}),
    }));
  const seconds = Math.round(elapsedMs / 1000);
  const message = phase === "waiting"
    ? `Startup still waiting after ${seconds} s (${stage})`
    : `Startup took ${seconds} s (${stage}, ended: ${outcome})`;

  return {
    message,
    tags: {
      phase,
      stage,
      platform,
      after_update: afterUpdateLabel(versions),
      ...(outcome ? { outcome } : {}),
    },
    extra: {
      phase,
      stage,
      ...(outcome ? { outcome } : {}),
      elapsedMs: round(elapsedMs),
      appVersion: versions?.appVersion || "",
      previousVersion: versions?.previousVersion ?? null,
      view: describeView(appState),
      steps: steps.map((entry) => ({ step: entry.step, atMs: round(entry.atMs) })),
      waitingCalls,
      slowCalls,
      callCount: calls.length + (Number(activity?.droppedCallCount) || 0),
      longestTickGapMs: round(longestTickGapMs),
    },
  };
}

/**
 * The watch itself, with its clock and inputs injectable for tests. `tick()` returns
 * whether it is still watching.
 */
export function createStartupWatch({
  now = currentTimeMs,
  readAppState = () => state,
  readActivity = readInvokeActivity,
  readSteps = () => startupSteps,
  readVersions = () => launchVersions,
  platform = platformLabel,
  report = reportSlowStartup,
  onFinish = () => {},
} = {}) {
  let finished = false;
  let waitingReported = false;
  let lastStage = null;
  let lastTickMs = null;
  let longestTickGapMs = 0;

  function finish() {
    if (finished) {
      return;
    }
    finished = true;
    onFinish();
  }

  function sendReport(phase, stage, outcome, elapsedMs, appState) {
    report(buildSlowStartupReport({
      phase,
      stage,
      outcome,
      elapsedMs,
      appState,
      activity: readActivity(),
      steps: readSteps(),
      versions: readVersions(),
      platform: platform(),
      longestTickGapMs,
    }));
  }

  function tick() {
    if (finished) {
      return false;
    }
    const elapsedMs = now();
    if (lastTickMs !== null) {
      longestTickGapMs = Math.max(longestTickGapMs, elapsedMs - lastTickMs);
    }
    lastTickMs = elapsedMs;

    const appState = readAppState();
    const stage = describeStartupStage(appState, readSteps());
    if (stage === null) {
      if (waitingReported || elapsedMs >= STARTUP_REPORT_AFTER_MS) {
        sendReport("finished", lastStage ?? "unknown", describeStartupOutcome(appState), elapsedMs, appState);
      }
      finish();
      return false;
    }

    lastStage = stage;
    if (!waitingReported && elapsedMs >= STARTUP_REPORT_AFTER_MS) {
      waitingReported = true;
      sendReport("waiting", stage, null, elapsedMs, appState);
    }
    if (elapsedMs >= STARTUP_WATCH_MAX_MS) {
      finish();
      return false;
    }
    return true;
  }

  return { tick, finish };
}

/** Start watching this launch. Call once, at the top of bootstrap. */
export function startStartupWatch() {
  if (activeWatch || typeof setInterval !== "function") {
    return;
  }
  let timer = null;
  const watch = createStartupWatch({
    onFinish: () => {
      clearInterval(timer);
      stopInvokeActivityRecording();
    },
  });
  activeWatch = watch;
  timer = setInterval(() => watch.tick(), STARTUP_WATCH_TICK_MS);
}

/** Stop watching without reporting (e.g. the dev editor fixture skips the normal startup). */
export function stopStartupWatch() {
  activeWatch?.finish();
}
