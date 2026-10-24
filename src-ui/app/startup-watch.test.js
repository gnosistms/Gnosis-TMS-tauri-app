import test from "node:test";
import assert from "node:assert/strict";

globalThis.document = globalThis.document ?? {
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.window = globalThis.window ?? {
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  setTimeout,
  clearTimeout,
};

const {
  STARTUP_REPORT_AFTER_MS,
  STARTUP_WATCH_MAX_MS,
  buildSlowStartupReport,
  createStartupWatch,
  describeStartupStage,
} = await import("./startup-watch.js");
const { scrubData } = await import("./telemetry-scrub.js");

const ALL_STEPS = [
  { step: "storage_ready", atMs: 400 },
  { step: "app_state_loaded", atMs: 900 },
  { step: "window_ready", atMs: 950 },
  { step: "saved_login_loaded", atMs: 1000 },
];

function appState(overrides = {}) {
  return {
    screen: "start",
    auth: { status: "restoring" },
    offline: { checked: true, hasConnection: true, isEnabled: false },
    orgDiscovery: { status: "idle" },
    teamsPage: { isRefreshing: false },
    teams: [],
    ...overrides,
  };
}

const teamListLoading = appState({
  screen: "teams",
  auth: { status: "success" },
  orgDiscovery: { status: "loading" },
  teamsPage: { isRefreshing: true },
  teams: [{ id: "a" }, { id: "b" }],
});

const teamListReady = appState({
  screen: "teams",
  auth: { status: "success" },
  orgDiscovery: { status: "ready" },
  teams: [{ id: "a" }, { id: "b" }],
});

function harness({ states, calls = [] }) {
  const clock = { ms: 0 };
  const current = { state: states };
  const reports = [];
  let finishCount = 0;
  const watch = createStartupWatch({
    now: () => clock.ms,
    readAppState: () => current.state,
    readActivity: () => ({ calls, droppedCallCount: 0 }),
    readSteps: () => ALL_STEPS,
    readVersions: () => ({ appVersion: "0.8.126", previousVersion: "0.8.83", known: true }),
    platform: () => "windows",
    report: (report) => reports.push(report),
    onFinish: () => {
      finishCount += 1;
    },
  });
  return {
    reports,
    watch,
    finishCount: () => finishCount,
    at(ms, nextState = current.state) {
      clock.ms = ms;
      current.state = nextState;
      return watch.tick();
    },
  };
}

test("names the startup step the user is waiting on, in order", () => {
  assert.equal(describeStartupStage(appState(), []), "storage");
  assert.equal(describeStartupStage(appState(), ALL_STEPS.slice(0, 1)), "app_state");
  assert.equal(describeStartupStage(appState(), ALL_STEPS.slice(0, 2)), "window");
  assert.equal(describeStartupStage(appState(), ALL_STEPS.slice(0, 3)), "loading_saved_login");
  assert.equal(
    describeStartupStage(appState({ offline: { checked: false, hasConnection: true } }), ALL_STEPS),
    "internet_check",
  );
  assert.equal(describeStartupStage(appState(), ALL_STEPS), "checking_login");
  assert.equal(describeStartupStage(teamListLoading, ALL_STEPS), "team_list_refresh");
  assert.equal(describeStartupStage({ ...teamListLoading, teams: [] }, ALL_STEPS), "team_list");
});

test("the wait ends on the team list, the start or offline screen, or an opened team", () => {
  assert.equal(describeStartupStage(teamListReady, ALL_STEPS), null);
  assert.equal(describeStartupStage(appState({ auth: { status: "idle" } }), ALL_STEPS), null);
  assert.equal(
    describeStartupStage(appState({ offline: { checked: true, hasConnection: false } }), ALL_STEPS),
    null,
  );
  assert.equal(
    describeStartupStage({ ...teamListLoading, screen: "projects" }, ALL_STEPS),
    null,
  );
});

test("a normal startup sends nothing", () => {
  const run = harness({ states: appState() });
  assert.equal(run.at(1_000), true);
  assert.equal(run.at(2_000, teamListLoading), true);
  assert.equal(run.at(7_000, teamListReady), false);
  assert.deepEqual(run.reports, []);
  assert.equal(run.finishCount(), 1);
  assert.equal(run.at(40_000, teamListLoading), false);
  assert.deepEqual(run.reports, []);
});

test("a long wait reports once while waiting and once when it ends", () => {
  const calls = [
    { command: "check_internet_connection", startMs: 1_000, endMs: 1_200, errorType: null },
    { command: "inspect_broker_auth_session", startMs: 1_000, endMs: 31_000, errorType: "connection_unavailable" },
    { command: "load_editor_preferences", startMs: 1_100, endMs: 1_110, errorType: null },
    { command: "list_accessible_github_app_installations", startMs: 31_500, endMs: null, errorType: null },
  ];
  const run = harness({ states: appState(), calls });
  run.at(1_000);
  run.at(29_000, teamListLoading);
  assert.equal(run.reports.length, 0);

  assert.equal(run.at(STARTUP_REPORT_AFTER_MS + 2_000), true);
  assert.equal(run.reports.length, 1);
  const [waiting] = run.reports;
  assert.equal(waiting.message, "Startup still waiting after 32 s (team_list_refresh)");
  assert.deepEqual(waiting.tags, {
    phase: "waiting",
    stage: "team_list_refresh",
    platform: "windows",
    after_update: "yes",
  });
  assert.deepEqual(waiting.extra.waitingCalls, [
    { command: "list_accessible_github_app_installations", startMs: 31_500, waitedMs: 500 },
  ]);
  assert.deepEqual(waiting.extra.slowCalls, [
    { command: "inspect_broker_auth_session", startMs: 1_000, tookMs: 30_000, errorType: "connection_unavailable" },
  ]);
  assert.equal(waiting.extra.callCount, 4);
  assert.equal(waiting.extra.longestTickGapMs, 28_000);
  assert.equal(waiting.extra.previousVersion, "0.8.83");
  assert.equal(waiting.extra.view.teamCount, 2);

  run.at(33_000);
  assert.equal(run.reports.length, 1, "the waiting report is sent only once");

  assert.equal(run.at(61_000, teamListReady), false);
  assert.equal(run.reports.length, 2);
  const finished = run.reports[1];
  assert.equal(finished.message, "Startup took 61 s (team_list_refresh, ended: team_list_ready)");
  assert.equal(finished.tags.phase, "finished");
  assert.equal(finished.tags.outcome, "team_list_ready");
  assert.equal(run.finishCount(), 1);
});

test("a wait that ends on the offline screen says so", () => {
  const run = harness({ states: appState({ offline: { checked: false, hasConnection: true } }) });
  run.at(31_000);
  run.at(34_000, appState({ offline: { checked: true, hasConnection: false } }));
  assert.deepEqual(run.reports.map((report) => report.tags.phase), ["waiting", "finished"]);
  assert.equal(run.reports[0].tags.stage, "internet_check");
  assert.equal(run.reports[1].tags.outcome, "offline");
});

test("a wait that never ends stops watching after the cap", () => {
  const run = harness({ states: teamListLoading });
  run.at(31_000);
  assert.equal(run.at(STARTUP_WATCH_MAX_MS), false);
  assert.equal(run.finishCount(), 1);
  run.at(STARTUP_WATCH_MAX_MS + 1_000, teamListReady);
  assert.deepEqual(run.reports.map((report) => report.tags.phase), ["waiting"]);
});

test("stopping the watch early sends nothing later", () => {
  const run = harness({ states: teamListLoading });
  run.at(1_000);
  run.watch.finish();
  assert.equal(run.at(45_000), false);
  assert.deepEqual(run.reports, []);
});

test("the report survives telemetry scrubbing unchanged", () => {
  const report = buildSlowStartupReport({
    phase: "finished",
    stage: "checking_login",
    outcome: "team_list_error",
    elapsedMs: 95_000,
    appState: { ...teamListReady, orgDiscovery: { status: "error" } },
    activity: {
      calls: [
        { command: "refresh_broker_auth_session", startMs: 2_000, endMs: 32_000, errorType: "connection_unavailable" },
        { command: "inspect_broker_auth_session", startMs: 32_000, endMs: null, errorType: null },
      ],
      droppedCallCount: 0,
    },
    steps: ALL_STEPS,
    versions: { appVersion: "0.8.126", previousVersion: null, known: true },
    platform: "mac",
    longestTickGapMs: 1_000,
  });
  assert.equal(report.tags.after_update, "unknown");
  assert.deepEqual(scrubData(report.extra), report.extra);
  assert.deepEqual(scrubData(report.tags), report.tags);
  assert.equal(JSON.stringify(report).includes("<redacted>"), false);
});
