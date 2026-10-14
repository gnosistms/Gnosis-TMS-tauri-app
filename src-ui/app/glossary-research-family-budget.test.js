import test from "node:test";
import assert from "node:assert/strict";

import { batchSpent, nextWordLimit, recordRunSpend } from "./glossary-research-family-budget.js";

test("each related word gets its own limit, never more than the total has left", () => {
  const queue = { wordLimit: 2, totalLimit: 5, spentByRun: {} };
  recordRunSpend(queue, "main", 1.2);
  assert.deepEqual(nextWordLimit(queue).limit, 2);
  recordRunSpend(queue, "w1", 0.8);
  recordRunSpend(queue, "w2", 1.75);
  assert.equal(nextWordLimit(queue).limit, 1.25);
  recordRunSpend(queue, "w3", 1.22);
  assert.equal(nextWordLimit(queue).limit, null, "under five cents left: the batch ends");
});

test("a resumed run's spending replaces its earlier record", () => {
  const queue = { wordLimit: 2, totalLimit: 10, spentByRun: {} };
  recordRunSpend(queue, "w1", 2);
  recordRunSpend(queue, "w1", 3.1);
  assert.equal(batchSpent(queue), 3.1);
});
