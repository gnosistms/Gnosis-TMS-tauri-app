import test from "node:test";
import assert from "node:assert/strict";

import {
  readInvokeActivity,
  resetInvokeActivityForTests,
  stopInvokeActivityRecording,
  trackInvoke,
} from "./invoke-activity.js";

test("records a call as waiting until it settles, then with its timing", async () => {
  resetInvokeActivityForTests();
  let resolveCall;
  const pending = trackInvoke("list_accessible_github_app_installations", () => (
    new Promise((resolve) => {
      resolveCall = resolve;
    })
  ));

  const during = readInvokeActivity().calls;
  assert.equal(during.length, 1);
  assert.equal(during[0].command, "list_accessible_github_app_installations");
  assert.equal(during[0].endMs, null);

  resolveCall(["team"]);
  assert.deepEqual(await pending, ["team"]);
  const [after] = readInvokeActivity().calls;
  assert.equal(typeof after.endMs, "number");
  assert.ok(after.endMs >= after.startMs);
  assert.equal(after.errorType, null);
});

test("a failed call keeps its error type, not its message, and still rejects", async () => {
  resetInvokeActivityForTests();
  await assert.rejects(
    trackInvoke("inspect_broker_auth_session", async () => {
      throw new Error("error sending request: operation timed out");
    }),
    /operation timed out/,
  );
  const [call] = readInvokeActivity().calls;
  assert.equal(call.errorType, "connection_unavailable");
  assert.equal(Object.values(call).some((value) => String(value).includes("timed out")), false);
});

test("a tracked call hands back the call's own promise, adding no delay", async () => {
  resetInvokeActivityForTests();
  const original = Promise.resolve("value");
  assert.equal(trackInvoke("load_ai_provider_secret", () => original), original);
  await original;
});

test("recording is capped and counts what it dropped", async () => {
  resetInvokeActivityForTests();
  for (let index = 0; index < 305; index += 1) {
    await trackInvoke("load_editor_preferences", async () => null);
  }
  const activity = readInvokeActivity();
  assert.equal(activity.calls.length, 300);
  assert.equal(activity.droppedCallCount, 5);
});

test("after the watch stops, calls run untracked and the record is released", async () => {
  resetInvokeActivityForTests();
  await trackInvoke("check_internet_connection", async () => true);
  stopInvokeActivityRecording();
  assert.equal(await trackInvoke("check_internet_connection", async () => true), true);
  assert.deepEqual(readInvokeActivity().calls, []);
});
