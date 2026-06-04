import test from "node:test";
import assert from "node:assert/strict";

const {
  scrubString,
  scrubData,
  scrubEvent,
  COMMAND_ERROR_MAX_LENGTH,
} = await import("./telemetry-scrub.js");

test("scrubString redacts the username from macOS and Linux home paths", () => {
  assert.equal(
    scrubString("Could not write /Users/alice/Library/app/secrets.hold"),
    "Could not write /Users/<user>/Library/app/secrets.hold",
  );
  assert.equal(
    scrubString("open /home/bob/.config/gnosis failed"),
    "open /home/<user>/.config/gnosis failed",
  );
});

test("scrubString redacts the username from a Windows home path", () => {
  assert.equal(
    scrubString("C:\\Users\\Carol\\AppData\\Roaming\\gnosis"),
    "C:\\Users\\<user>\\AppData\\Roaming\\gnosis",
  );
});

test("scrubString redacts secret-looking tokens", () => {
  assert.match(scrubString("token ghp_ABCDEF0123456789ABCDEF expired"), /<redacted>/);
  assert.match(scrubString("key sk-ant-abc123ABC456def789ghi failed"), /<redacted>/);
  assert.match(scrubString("OpenAI sk-abcdefghijklmnop1234 rejected"), /<redacted>/);
  assert.match(scrubString("Authorization: Bearer abcdef.ghijkl.mnopqr"), /<redacted>/);
  assert.doesNotMatch(scrubString("ghp_ABCDEF0123456789ABCDEF"), /ghp_ABCDEF/);
});

test("scrubString truncates with the short command-error cap", () => {
  const long = "x".repeat(500);
  const out = scrubString(long, COMMAND_ERROR_MAX_LENGTH);
  assert.equal(out.length, COMMAND_ERROR_MAX_LENGTH + 1); // + ellipsis
  assert.ok(out.endsWith("…"));
});

test("scrubData drops sensitive keys and scrubs nested strings", () => {
  const input = {
    command: "save_broker_auth_session",
    payload: {
      sessionToken: "ghp_should_be_dropped_entirely_123456",
      apiKey: "sk-secretsecretsecret1234",
      note: "wrote /Users/dave/x",
      nested: { password: "hunter2", ok: "fine" },
    },
  };
  const out = scrubData(input);
  assert.equal(out.payload.sessionToken, "<redacted>");
  assert.equal(out.payload.apiKey, "<redacted>");
  assert.equal(out.payload.nested.password, "<redacted>");
  assert.equal(out.payload.note, "wrote /Users/<user>/x");
  assert.equal(out.payload.nested.ok, "fine");
  // Original is not mutated.
  assert.equal(input.payload.sessionToken, "ghp_should_be_dropped_entirely_123456");
});

test("scrubEvent strips identity, host, and request data", () => {
  const event = {
    user: { id: "alice", ip_address: "203.0.113.5", username: "alice" },
    server_name: "alices-macbook.local",
    request: { url: "https://example/path?token=abc", headers: { Cookie: "x" } },
    message: "boom",
  };
  const out = scrubEvent(event);
  assert.equal(out.user, undefined);
  assert.equal(out.server_name, undefined);
  assert.equal(out.request, undefined);
});

test("scrubEvent scrubs message, exception value, stack-frame paths, and drops frame vars", () => {
  const event = {
    message: "failed at /Users/erin/app",
    exception: {
      values: [
        {
          type: "Error",
          value: "token ghp_ABCDEF0123456789ABCDEF leaked",
          stacktrace: {
            frames: [
              {
                filename: "/Users/erin/app/src-ui/app/runtime.js",
                vars: { secret: "do-not-keep" },
              },
            ],
          },
        },
      ],
    },
  };
  const out = scrubEvent(event);
  assert.equal(out.message, "failed at /Users/<user>/app");
  assert.match(out.exception.values[0].value, /<redacted>/);
  assert.equal(
    out.exception.values[0].stacktrace.frames[0].filename,
    "/Users/<user>/app/src-ui/app/runtime.js",
  );
  assert.equal(out.exception.values[0].stacktrace.frames[0].vars, undefined);
});

test("scrubEvent scrubs breadcrumbs and extra/contexts/tags", () => {
  const event = {
    breadcrumbs: [{ message: "saved /home/frank/x", data: { token: "abc" } }],
    extra: { path: "/Users/gina/y", apiKey: "sk-xyz" },
    tags: { command: "list_gnosis_projects_for_installation" },
  };
  const out = scrubEvent(event);
  assert.equal(out.breadcrumbs[0].message, "saved /home/<user>/x");
  assert.equal(out.breadcrumbs[0].data.token, "<redacted>");
  assert.equal(out.extra.path, "/Users/<user>/y");
  assert.equal(out.extra.apiKey, "<redacted>");
  assert.equal(out.tags.command, "list_gnosis_projects_for_installation");
});

test("scrubEvent scrubs breadcrumbs in Sentry SDK { values: [] } format", () => {
  const event = {
    breadcrumbs: {
      values: [{ message: "saved /home/henry/x", data: { token: "abc" } }],
    },
  };
  const out = scrubEvent(event);
  assert.equal(out.breadcrumbs.values[0].message, "saved /home/<user>/x");
  assert.equal(out.breadcrumbs.values[0].data.token, "<redacted>");
});

test("scrubString redacts fine-grained GitHub PATs (github_pat_ prefix)", () => {
  const pat = "github_pat_" + "A".repeat(20);
  assert.match(scrubString(`token ${pat} expired`), /<redacted>/);
  assert.doesNotMatch(scrubString(`token ${pat} expired`), /github_pat_/);
});

test("scrubEvent tolerates non-object input", () => {
  assert.equal(scrubEvent(null), null);
  assert.equal(scrubEvent(undefined), undefined);
});
