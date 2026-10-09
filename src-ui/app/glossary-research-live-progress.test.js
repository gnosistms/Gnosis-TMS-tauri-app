import test from "node:test";
import assert from "node:assert/strict";

import {
  elapsedText, isSlow, latestThinkingTitle, liveStatusHtml, recordStepTiming, seedStepTimings,
  stepTimings, timingsSeeded, usualRange, usualText, writingProgress, writingText,
} from "./glossary-research-live-progress.js";

function memory() {
  let value = {};
  return { read: (_key, fallback) => value ?? fallback, write: (_key, next) => { value = next; } };
}

test("the usual range is the middle half of earlier durations, said in minutes or seconds", () => {
  const candidates = [233, 194, 199, 149, 190, 149, 182, 145, 178, 222, 281, 138, 204, 225, 339];
  assert.equal(usualText(usualRange(candidates)), "usually 3–4 min");
  assert.equal(usualText(usualRange([20, 25, 30, 40])), "usually 25–35 s");
  assert.equal(usualRange([100, 120]), null, "too few earlier runs say nothing");
});

test("a request well past its usual time is called slow", () => {
  const range = usualRange([100, 120, 140]);
  assert.equal(isSlow(range, 200_000), false);
  assert.equal(isSlow(range, 400_000), true);
  assert.equal(isSlow(null, 1e9), false);
});

test("the clock reads minutes and seconds", () => {
  assert.equal(elapsedText(100_500), "1:40");
  assert.equal(elapsedText(3_725_000), "1:02:05");
});

test("timings are kept per model and step, and saved runs are added once", () => {
  const store = memory();
  recordStepTiming("gpt", "checks", 61.23, store);
  recordStepTiming("gpt", "checks", 70, store);
  recordStepTiming("other", "checks", 5, store);
  assert.deepEqual(stepTimings("gpt", "checks", store.read), [61.2, 70]);
  assert.equal(timingsSeeded(store.read), false);
  assert.equal(seedStepTimings([{ modelId: "gpt", usage: [{ stage: "checks", status: "ok", seconds: 80 }, { stage: "checks", status: "failed", seconds: 1 }] }], store), true);
  assert.deepEqual(stepTimings("gpt", "checks", store.read), [61.2, 70, 80]);
  assert.equal(seedStepTimings([{ modelId: "gpt", usage: [{ stage: "checks", status: "ok", seconds: 90 }] }], store), false, "only once");
});

test("the item being written is counted from the field that opens each item", () => {
  const answer = '{"candidates":[{"n":1,"words":[{"word":"x"}]},{"n": 2,"words":[';
  assert.deepEqual(writingProgress(answer, { key: "n", total: 31, unit: "translation" }), { current: 2, total: 31, unit: "translation" });
  assert.equal(writingText(writingProgress('{"senses":[{"senseId":"s1"},{"senseId":"s2"', { key: "senseId", total: null, unit: "meaning" })), "2 meanings");
  assert.equal(writingProgress("{", { key: "n", total: 3 }), null);
});

test("the live status says what the request is doing, with the clock and the usual time", () => {
  const usual = usualRange([150, 180, 200, 240]);
  const started = 1_000_000;
  const thinking = liveStatusHtml({ startedAt: started, purpose: "propose Vietnamese translations for each meaning", thinking: "**Evaluating Vietnamese translations**\n…" }, "thinking", usual, started + 100_000);
  assert.match(thinking, /Asking the AI to propose Vietnamese translations for each meaning \(thinking\)/, "what it was asked stays in view; the thinking shows below");
  assert.match(thinking, /1:40 · usually 3–4 min/);
  const writing = liveStatusHtml({ startedAt: started, answer: '{"candidates":[{"n":1},{"n":2', progress: { key: "n", total: 4, unit: "translation" } }, "writing", usual, started + 5_000);
  assert.match(writing, /The AI is writing: 2 of 4 translations/);
  assert.match(writing, /role="progressbar"/);
  assert.match(liveStatusHtml({ startedAt: started }, "waiting", usual, started + 900_000), /taking much longer than usual/);
});
