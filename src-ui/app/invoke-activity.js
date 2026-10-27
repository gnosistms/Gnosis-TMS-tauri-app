// Records backend calls (command name and timing only) while startup is being watched,
// so a slow-startup report can say which call the app was waiting on. See
// plans/slow-startup-report-plan.md. Payloads and error text are never kept.

import { classifySyncError } from "./sync-error.js";

const MAX_RECORDED_CALLS = 300;

const recordedCalls = [];
let recording = true;
let droppedCallCount = 0;

function currentTimeMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function beginCall(command) {
  if (!recording) {
    return null;
  }
  if (recordedCalls.length >= MAX_RECORDED_CALLS) {
    droppedCallCount += 1;
    return null;
  }
  const call = {
    command: String(command ?? "unknown"),
    startMs: currentTimeMs(),
    endMs: null,
    errorType: null,
  };
  recordedCalls.push(call);
  return call;
}

function endCall(call, error) {
  try {
    call.endMs = currentTimeMs();
    if (error !== undefined) {
      call.errorType = classifySyncError(error).type;
    }
  } catch {
    // Recording must never affect the call itself.
  }
}

/**
 * Run one backend call, recording its timing while startup is being watched. Returns
 * the call's own promise, so callers see no added delay.
 */
export function trackInvoke(command, call) {
  const record = beginCall(command);
  if (!record) {
    return call();
  }
  let result;
  try {
    result = call();
  } catch (error) {
    endCall(record, error ?? "unknown error");
    throw error;
  }
  Promise.resolve(result).then(
    () => endCall(record),
    (error) => endCall(record, error ?? "unknown error"),
  );
  return result;
}

/** Copies of the calls recorded so far, oldest first. */
export function readInvokeActivity() {
  return {
    calls: recordedCalls.map((call) => ({ ...call })),
    droppedCallCount,
  };
}

/** Stop recording and release what was recorded; later calls run untracked. */
export function stopInvokeActivityRecording() {
  recording = false;
  recordedCalls.length = 0;
}

/** Test hook: start a fresh recording. */
export function resetInvokeActivityForTests() {
  recording = true;
  recordedCalls.length = 0;
  droppedCallCount = 0;
}
