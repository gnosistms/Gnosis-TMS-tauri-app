import test from "node:test";
import assert from "node:assert/strict";

const {
  createAiBatchPool,
  createSerialLane,
  isTransientAiProviderError,
  runWithTransientAiRetry,
} = await import("./editor-ai-batch-pool.js");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("serial lane runs tasks one at a time and survives rejections", async () => {
  const lane = createSerialLane();
  const events = [];
  const first = deferred();

  const a = lane(async () => {
    events.push("a:start");
    await first.promise;
    events.push("a:end");
    return "a";
  });
  const b = lane(async () => {
    events.push("b:start");
    throw new Error("b failed");
  });
  const c = lane(async () => {
    events.push("c:start");
    return "c";
  });

  await tick();
  assert.deepEqual(events, ["a:start"]);
  first.resolve();

  assert.equal(await a, "a");
  await assert.rejects(b, /b failed/);
  assert.equal(await c, "c");
  assert.deepEqual(events, ["a:start", "a:end", "b:start", "c:start"]);
});

test("pool caps concurrent slot holders across batch requests and fallbacks", async () => {
  const pool = createAiBatchPool({ concurrency: 2 });
  const gates = new Map();
  let inFlight = 0;
  let maxInFlight = 0;

  const slotTask = (name) => pool.withSlot(async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const gate = deferred();
    gates.set(name, gate);
    await gate.promise;
    inFlight -= 1;
    return name;
  });

  const running = Promise.all([
    slotTask("batch-1"),
    slotTask("batch-2"),
    slotTask("fallback-1"),
    slotTask("fallback-2"),
  ]);
  await tick();

  assert.equal(maxInFlight, 2);
  assert.deepEqual([...gates.keys()], ["batch-1", "batch-2"]);

  gates.get("batch-1").resolve();
  await tick();
  assert.equal(gates.has("fallback-1"), true);
  assert.equal(maxInFlight, 2);

  gates.get("batch-2").resolve();
  gates.get("fallback-1").resolve();
  await tick();
  gates.get("fallback-2").resolve();
  assert.deepEqual(await running, ["batch-1", "batch-2", "fallback-1", "fallback-2"]);
  assert.equal(maxInFlight, 2);
});

test("pool run applies out-of-order completions through a non-overlapping lane", async () => {
  const pool = createAiBatchPool({ concurrency: 3 });
  const requests = new Map();
  const applied = [];
  let applying = 0;

  const runPromise = pool.run([1, 2, 3], async (batch, tools) => {
    const gate = deferred();
    requests.set(batch, gate);
    const result = await tools.withSlot(() => gate.promise);
    return tools.inApplyLane(async () => {
      applying += 1;
      assert.equal(applying, 1, "applies must never overlap");
      await tick();
      applied.push(result);
      applying -= 1;
      return "ok";
    });
  });
  await tick();
  assert.deepEqual([...requests.keys()], [1, 2, 3]);

  requests.get(3).resolve("r3");
  requests.get(1).resolve("r1");
  requests.get(2).resolve("r2");

  assert.equal(await runPromise, "ok");
  assert.deepEqual([...applied].sort(), ["r1", "r2", "r3"]);
});

test("pool run stops new batches after the first non-ok outcome", async () => {
  const pool = createAiBatchPool({ concurrency: 1 });
  const started = [];

  const outcome = await pool.run([1, 2, 3, 4], async (batch) => {
    started.push(batch);
    return batch === 2 ? "abort" : "ok";
  });

  assert.equal(outcome, "abort");
  assert.deepEqual(started, [1, 2]);
});

test("pool run lets in-flight batches settle after a failure, then rethrows the first error", async () => {
  const pool = createAiBatchPool({ concurrency: 2 });
  const slow = deferred();
  const settled = [];

  const runPromise = pool.run([1, 2, 3], async (batch, tools) => {
    if (batch === 1) {
      await tools.withSlot(() => slow.promise);
      settled.push(1);
      return "ok";
    }
    if (batch === 2) {
      throw new Error("batch 2 exploded");
    }
    settled.push(batch);
    return "ok";
  });
  await tick();
  slow.resolve();

  await assert.rejects(runPromise, /batch 2 exploded/);
  assert.deepEqual(settled, [1]);
});

test("transient detection matches every provider's 429 and 5xx wording", () => {
  assert.equal(isTransientAiProviderError(new Error("OpenAI rate limited this request. Wait a moment and try again.")), true);
  assert.equal(isTransientAiProviderError(new Error("Claude rate limited this request. Wait a moment and try again.")), true);
  assert.equal(isTransientAiProviderError(new Error("OpenAI is temporarily unavailable. Try again in a moment.")), true);
  assert.equal(isTransientAiProviderError(new Error("Gemini is temporarily unavailable: model overloaded")), true);
  assert.equal(isTransientAiProviderError(new Error("The AI response was empty.")), false);
});

test("transient provider failures retry with the slot released and then succeed", async () => {
  const pool = createAiBatchPool({ concurrency: 1 });
  let attempts = 0;
  let slotFreeDuringWait = false;

  const result = await runWithTransientAiRetry({
    withSlot: pool.withSlot,
    delaysMs: [10],
    call: async () => {
      attempts += 1;
      if (attempts === 1) {
        // While this call waits out its backoff, the slot must be available
        // to others — probe it from a parallel acquisition.
        setTimeout(() => {
          pool.withSlot(async () => {
            slotFreeDuringWait = true;
          });
        }, 3);
        throw new Error("OpenAI is temporarily unavailable. Try again in a moment.");
      }
      return "second-attempt";
    },
  });

  assert.equal(result, "second-attempt");
  assert.equal(attempts, 2);
  assert.equal(slotFreeDuringWait, true);
});

test("non-transient errors and exhausted retries propagate to the fallback path", async () => {
  const pool = createAiBatchPool({ concurrency: 1 });

  let attempts = 0;
  await assert.rejects(
    runWithTransientAiRetry({
      withSlot: pool.withSlot,
      delaysMs: [1],
      call: async () => {
        attempts += 1;
        throw new Error("The AI response was empty.");
      },
    }),
    /response was empty/,
  );
  assert.equal(attempts, 1);

  let limitedAttempts = 0;
  await assert.rejects(
    runWithTransientAiRetry({
      withSlot: pool.withSlot,
      delaysMs: [1, 1],
      call: async () => {
        limitedAttempts += 1;
        throw new Error("OpenAI rate limited this request. Wait a moment and try again.");
      },
    }),
    /rate limited/,
  );
  assert.equal(limitedAttempts, 3);
});

test("pool run aborts before starting batches when the run is no longer active", async () => {
  let active = true;
  const pool = createAiBatchPool({ concurrency: 2, isRunActive: () => active });
  const started = [];

  const outcome = await pool.run([1, 2, 3], async (batch) => {
    started.push(batch);
    if (batch === 1) {
      active = false;
    }
    return "ok";
  });

  assert.equal(outcome, "abort");
  assert.equal(started.includes(3), false);
});
