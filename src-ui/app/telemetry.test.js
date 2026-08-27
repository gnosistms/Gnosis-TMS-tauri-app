import test from "node:test";
import assert from "node:assert/strict";

const {
  isExpectedControlFlowRejection,
  isRoutineQueryCancellation,
} = await import("./telemetry.js");

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
