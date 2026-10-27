import test from "node:test";
import assert from "node:assert/strict";

const {
  addTelemetryBreadcrumb,
  buildAppBreadcrumb,
  initTelemetry,
  isExpectedControlFlowRejection,
  isRoutineQueryCancellation,
  keepOnlyAppBreadcrumbs,
  refreshTelemetryState,
  reportCommandFailure,
} = await import("./telemetry.js");
const { writePersistentValue } = await import("./persistent-store.js");
const {
  TELEMETRY_DISCLOSURE_SHOWN_KEY,
  TELEMETRY_ENABLED_KEY,
} = await import("./telemetry-consent.js");

test("a TanStack CancelledError rejection is routine, not a crash", () => {
  // The real CancelledError extends Error with the literal message "CancelledError"
  // (its class name is unreliable after minification, so detection keys on the message).
  const cancelled = new Error("CancelledError");
  assert.equal(isRoutineQueryCancellation({ kind: "unhandledrejection", error: cancelled, message: cancelled.message }), true);
  // Non-Error rejection reasons carry only the message.
  assert.equal(isRoutineQueryCancellation({ kind: "unhandledrejection", error: null, message: "CancelledError" }), true);
});

test("ordinary errors are still treated as crashes", () => {
  const error = new Error("Cannot read properties of undefined");
  assert.equal(isRoutineQueryCancellation({ kind: "error", error, message: error.message }), false);
  assert.equal(isRoutineQueryCancellation({ kind: "unhandledrejection", error: null, message: "boom" }), false);
});

test("an unhandled AUTH_REQUIRED rejection is expected session control flow", () => {
  const authRequired = new Error("AUTH_REQUIRED:Sign in with GitHub to connect to the broker first.");
  assert.equal(isExpectedControlFlowRejection({
    kind: "unhandledrejection",
    error: authRequired,
    message: authRequired.message,
  }), true);
  assert.equal(isExpectedControlFlowRejection({
    kind: "error",
    error: authRequired,
    message: authRequired.message,
  }), false);
  assert.equal(isExpectedControlFlowRejection({
    kind: "unhandledrejection",
    error: new Error("Cannot read properties of undefined"),
  }), false);
});

test("the breadcrumb filter keeps the app's own breadcrumbs", () => {
  const { breadcrumb, hint } = buildAppBreadcrumb({
    operation: "repo_write_overdue",
    reason: "save-row",
  });
  assert.deepEqual(breadcrumb, {
    category: "repo_write_overdue",
    message: "repo_write_overdue: save-row",
    level: "warning",
    data: { reason: "save-row" },
  });
  assert.equal(keepOnlyAppBreadcrumbs(breadcrumb, hint), breadcrumb);
});

test("the breadcrumb filter drops every breadcrumb the app did not mark", () => {
  // Shaped like the SDK's own console and navigation breadcrumbs.
  assert.equal(
    keepOnlyAppBreadcrumbs(
      { category: "console", message: "saved /Users/someone/doc.txt", data: { logger: "console" } },
      { input: ["saved /Users/someone/doc.txt"], level: "log" },
    ),
    null,
  );
  assert.equal(keepOnlyAppBreadcrumbs({ category: "navigation", data: { from: "/a", to: "/b" } }), null);
  // The mark is the module's own hint object, not the breadcrumb's shape: a copy of an
  // app breadcrumb, or a look-alike hint, does not pass.
  const { breadcrumb, hint } = buildAppBreadcrumb({ operation: "ai-review-batch", reason: "fallback-single-row" });
  assert.equal(keepOnlyAppBreadcrumbs({ ...breadcrumb }), null);
  assert.equal(keepOnlyAppBreadcrumbs(breadcrumb, { ...hint }), null);
});

// The tests below drive the real Sentry SDK through telemetry.js. Nothing leaves the
// process: fetch is stubbed and only records the envelopes the SDK would send.
const sentEnvelopes = [];
let realSentry = null;

async function startRealSentry() {
  if (realSentry) {
    return realSentry;
  }
  globalThis.__GNOSIS_SENTRY_DSN__ = "https://publickey@sentry.invalid/1";
  globalThis.fetch = async (_url, init) => {
    sentEnvelopes.push(String(init?.body ?? ""));
    return new Response("{}", { status: 200 });
  };
  writePersistentValue(TELEMETRY_DISCLOSURE_SHOWN_KEY, true);
  writePersistentValue(TELEMETRY_ENABLED_KEY, true);
  await initTelemetry();
  realSentry = await import("@sentry/browser");
  assert.ok(realSentry.getClient(), "telemetry should have initialised the Sentry client");
  return realSentry;
}

function sentEvents() {
  const events = [];
  for (const envelope of sentEnvelopes) {
    const lines = envelope.split("\n").filter(Boolean);
    for (let index = 1; index < lines.length - 1; index += 1) {
      if (JSON.parse(lines[index])?.type === "event") {
        events.push(JSON.parse(lines[index + 1]));
      }
    }
  }
  return events;
}

function breadcrumbsOf(event) {
  const crumbs = Array.isArray(event?.breadcrumbs) ? event.breadcrumbs : event?.breadcrumbs?.values ?? [];
  return crumbs.map(({ category, message, level, data }) => ({ category, message, level, data }));
}

test("with the real SDK, app breadcrumbs reach the next event and automatic ones do not", async () => {
  const Sentry = await startRealSentry();
  addTelemetryBreadcrumb({ operation: "ai-translate-batch", reason: "fallback-single-row" });
  // What an automatic integration would record, and an unmarked look-alike.
  Sentry.addBreadcrumb({ category: "console", message: "saved /Users/someone/doc.txt" });
  Sentry.addBreadcrumb({ category: "ai-translate-batch", message: "unmarked" });

  reportCommandFailure("demo_command", new Error("boom"));
  await Sentry.flush(2000);

  const events = sentEvents();
  assert.equal(events.length, 1);
  assert.deepEqual(breadcrumbsOf(events[0]), [{
    category: "ai-translate-batch",
    message: "ai-translate-batch: fallback-single-row",
    level: "warning",
    data: { reason: "fallback-single-row" },
  }]);
});

test("with the real SDK, an explicit opt-out drops breadcrumbs before a later opt-in", async () => {
  const Sentry = await startRealSentry();
  addTelemetryBreadcrumb({ operation: "repo_write_overdue", reason: "save-row" });

  writePersistentValue(TELEMETRY_ENABLED_KEY, false);
  refreshTelemetryState();
  writePersistentValue(TELEMETRY_ENABLED_KEY, true);
  await initTelemetry();

  sentEnvelopes.length = 0;
  reportCommandFailure("demo_command", new Error("after opt-in"));
  await Sentry.flush(2000);

  const events = sentEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].message, "demo_command: after opt-in");
  assert.deepEqual(breadcrumbsOf(events[0]), []);
});
