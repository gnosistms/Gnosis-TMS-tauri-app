// Shared orchestrator for running AI batches concurrently in Translate All
// and Review All (see plans/ai-batch-parallelization-plan.md). It owns the
// three behaviors both flows must share exactly:
//
// - a slot semaphore capping ALL in-flight AI calls for the run (batch
//   requests and per-row fallbacks draw from the same budget, so a failing
//   provider never sees pool × batch-size fallback requests);
// - a single serialized apply lane, so validate/apply/save work runs one
//   batch at a time — for the review flow this is what prevents two
//   concurrent git commits, because its applies invoke write commands
//   directly rather than through the write-intent queue;
// - stop-on-first-non-ok-outcome, so a canceled or failed batch keeps
//   remaining workers from starting new AI calls while in-flight ones finish
//   and settle normally.
//
// Slot/lane ordering rule: never hold a slot while waiting to enter the
// lane. Acquire slots either entirely outside the lane (batch requests,
// fallback AI calls) or entirely inside a lane task (single-row paths that
// cannot split their AI call from their apply). Holding a slot across the
// lane boundary could stall every other AI call behind one queued apply.

import { mapWithConcurrency } from "./editor-ai-batch-request.js";

function createSlotSemaphore(limit) {
  let available = Math.max(1, Number.isFinite(limit) ? limit : 1);
  const waiters = [];
  const release = () => {
    const next = waiters.shift();
    if (next) {
      next();
    } else {
      available += 1;
    }
  };
  return {
    async acquire() {
      if (available > 0) {
        available -= 1;
        return release;
      }
      await new Promise((resolve) => waiters.push(resolve));
      return release;
    },
  };
}

const swallow = () => {};

// A promise chain that runs queued tasks strictly one at a time. The returned
// function resolves/rejects with its task's result while keeping the chain
// alive past rejections.
export function createSerialLane() {
  let tail = Promise.resolve();
  return (task) => {
    const result = tail.then(task);
    tail = result.then(swallow, swallow);
    return result;
  };
}

export function createAiBatchPool({ concurrency, isRunActive = () => true }) {
  const slots = createSlotSemaphore(concurrency);
  const inApplyLane = createSerialLane();
  let stopOutcome = null;

  const withSlot = async (task) => {
    const release = await slots.acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };

  const tools = {
    withSlot,
    inApplyLane,
    isStopped: () => stopOutcome !== null,
  };

  // Runs task(batch, tools) over all batches with up to `concurrency` batches
  // open at once. Tasks report by returning an outcome string; "ok" (or
  // undefined) continues, anything else stops new batches and becomes the
  // run's outcome. A thrown error also stops new batches and is rethrown
  // after every in-flight task settles, so callers keep their existing
  // try/catch error handling.
  const run = async (batches, task) => {
    let firstError = null;
    await mapWithConcurrency(batches, concurrency, async (batch) => {
      if (stopOutcome !== null) {
        return;
      }
      if (!isRunActive()) {
        stopOutcome = "abort";
        return;
      }
      try {
        const outcome = await task(batch, tools);
        if (outcome !== undefined && outcome !== "ok" && stopOutcome === null) {
          stopOutcome = outcome;
        }
      } catch (error) {
        if (stopOutcome === null) {
          stopOutcome = "run-error";
        }
        firstError = firstError ?? error;
      }
    });
    if (firstError) {
      throw firstError;
    }
    return stopOutcome ?? "ok";
  };

  return { run, withSlot, inApplyLane };
}
