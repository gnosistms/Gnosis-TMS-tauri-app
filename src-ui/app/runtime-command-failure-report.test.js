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

const { resolveCommandFailureReport } = await import("./runtime.js");

test("skips the expected session-expired path", () => {
  assert.equal(
    resolveCommandFailureReport("any_command", new Error("AUTH_REQUIRED:Your GitHub session expired.")),
    null,
  );
});

test("skips forced-update control flow", () => {
  assert.equal(
    resolveCommandFailureReport(
      "load_gnosis_projects",
      new Error("APP_UPDATE_REQUIRED:This version of Gnosis TMS is no longer supported."),
    ),
    null,
  );
});

test("skips connectivity failures (broker unreachable, connection reset, offline)", () => {
  for (const message of [
    "Failed to fetch",
    "error sending request for url (https://gnosis-github-app-broker-8bfus.ondigitalocean.app/session)",
    "git fetch failed: connection reset by peer",
    "Could not resolve host: github.com",
  ]) {
    assert.equal(
      resolveCommandFailureReport("sync_command", new Error(message)),
      null,
      `expected skip for: ${message}`,
    );
  }
});

test("downgrades GitHub 5xx to a warning with a stable fingerprint and no body", () => {
  const report = resolveCommandFailureReport(
    "list_team_repositories",
    new Error("GitHub API 502: <html><body>Server Error</body></html>"),
  );
  assert.equal(report.error, "GitHub API 502");
  assert.equal(report.options.level, "warning");
  assert.deepEqual(report.options.fingerprint, [
    "command-failure",
    "list_team_repositories",
    "github-5xx",
  ]);

  const gatewayTimeout = resolveCommandFailureReport(
    "list_team_repositories",
    new Error("GitHub API 504: Gateway Time-out"),
  );
  assert.equal(gatewayTimeout.error, "GitHub API 504");
  // 502 and 504 for the same command group under the same fingerprint.
  assert.deepEqual(gatewayTimeout.options.fingerprint, report.options.fingerprint);
});

test("does not treat GitHub 4xx as a transient outage", () => {
  const report = resolveCommandFailureReport(
    "list_team_repositories",
    new Error("GitHub API 422: Validation Failed"),
  );
  assert.equal(report.options, undefined);
});

test("skips expected remote permission denials", () => {
  for (const message of [
    "git push failed: remote: Write access to repository not granted.",
    "Your account type cannot manage shared resources.",
    "Your account type cannot edit shared content.",
    "You need admin access in @Gnosis-VN for this action.",
  ]) {
    assert.equal(
      resolveCommandFailureReport("push_command", new Error(message)),
      null,
      `expected skip for: ${message}`,
    );
  }
});

test("replaces malformed AI assistant payloads with a fixed message", () => {
  const report = resolveCommandFailureReport(
    "run_ai_assistant",
    new Error('AI_ASSISTANT_MALFORMED_RESPONSE_JSON:{"raw":"document content"}'),
  );
  assert.equal(report.error, "The AI assistant returned a malformed response.");
  assert.equal(report.options, undefined);
});

test("skips expected user-input / validation failures", () => {
  for (const message of [
    "There is no source text to translate yet.",
    "There is no source text to discuss yet.",
    "The dropped item '/Users/x/Desktop/folder' is not a file.",
    "The uploaded file is not a valid supported image.",
    "The saved OpenAI API key was rejected. Update it in AI Settings and try again.",
    "Line 4: Expected an SRT timing line like 00:00:01,000 --> 00:00:02,000.",
    "OpenAI is temporarily unavailable. Try again in a moment.",
  ]) {
    assert.equal(
      resolveCommandFailureReport("some_command", new Error(message)),
      null,
      `expected skip for: ${message}`,
    );
  }
});

test("skips expected repository creation validation", () => {
  assert.equal(
    resolveCommandFailureReport(
      "create_gnosis_project_repo",
      new Error("GitHub API 422: name already exists on this account"),
    ),
    null,
  );
  const unexpected = new Error('GitHub API 422: {"message":"Malformed repository payload."}');
  assert.equal(
    resolveCommandFailureReport("create_gnosis_project_repo", unexpected).error,
    unexpected,
  );
});

test("reports ordinary failures unchanged at the default level", () => {
  const error = new Error("manifest.json is missing required field name");
  const report = resolveCommandFailureReport("load_manifest", error);
  assert.equal(report.error, error);
  assert.equal(report.options, undefined);
});
