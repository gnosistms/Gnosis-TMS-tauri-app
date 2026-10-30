import test from "node:test";
import assert from "node:assert/strict";
import { newStudioStudy } from "./glossary-research-studio-workflow.js";
import { STUDIO_SKIP_PROMPTS, studioRecommendationKey } from "./glossary-research-studio-recommendations.js";
import { STUDIO_AUTO_CHOICE_MS, advanceStudioAutoChoice, answerStudioAutoChoice, studioAutoChoiceCountdown, studioAutoChoiceTarget, studioAutoChoiceText } from "./glossary-research-studio-auto-choice.js";

function advised(step, recommendation = "Skip", extra = {}) {
  const s = newStudioStudy({ term: "mundo", sourceLanguage: { code: "es", name: "Spanish" },
    targetLanguage: { code: "en", name: "English" } }, "auto-choice");
  s.step = step;
  s.skipRecommendations = { [step]: { contextKey: studioRecommendationKey(s), recommendation, reason: "Because.", createdAt: "2026-10-30T10:00:00.000Z", ...extra } };
  return { study: s, busy: false };
}

test("every recommendable step counts down to the AI's choice at the research frontier", () => {
  for (const step of Object.keys(STUDIO_SKIP_PROMPTS)) {
    for (const [recommendation, choice] of [["Skip", "skip"], ["Run", "run"]]) {
      const view = advised(step, recommendation);
      assert.equal(studioAutoChoiceTarget(view.study, view)?.choice, choice, `${step}: ${recommendation}`);
    }
  }
});

test("nothing counts down while the translator is busy, revisiting, deciding, or without real advice", () => {
  const blocked = {
    "advice is loading": (view) => Object.assign(view, { busy: true, recommendingStep: view.study.step }),
    "a save is running": (view) => { view.saving = true; },
    "a dialog is open": (view) => { view.modal = { kind: "skip", label: "source research" }; },
    "an error is showing": (view) => { view.error = "Provider unavailable"; },
    "a step is being revisited": (view) => { view.revisiting = true; },
    "a question is pending": (view) => { view.study.pendingDecision = { kind: "progress" }; },
    "the study is complete": (view) => { view.study.status = "complete"; },
    "research has started": (view) => { view.study.steps["4.3"] = { status: "running" }; },
    "the inputs changed": (view) => { view.study.scope.term = "otro"; },
    "the AI could not answer": (view) => { view.study.skipRecommendations["4.3"].fallback = true; },
    "there is no advice": (view) => { delete view.study.skipRecommendations; },
  };
  for (const [reason, block] of Object.entries(blocked)) {
    const view = advised("4.3"); block(view);
    assert.equal(studioAutoChoiceTarget(view.study, view), null, reason);
    assert.equal(studioAutoChoiceCountdown(view), null, reason);
    assert.equal(advanceStudioAutoChoice(view, 0), null, reason);
    assert.equal(view.autoChoice, null, reason);
  }
  const view = advised("4.2");
  assert.equal(studioAutoChoiceTarget(view.study, view), null, "4.2 cannot be skipped");
});

test("the recommendation is taken once its ten seconds are up", () => {
  const view = advised("4.3", "Skip");
  assert.equal(studioAutoChoiceText(studioAutoChoiceCountdown(view)), "Skipping this step in 10 seconds unless you choose.");
  assert.equal(advanceStudioAutoChoice(view, 1_000), null);
  assert.equal(advanceStudioAutoChoice(view, 4_100), null);
  assert.equal(view.autoChoice.remaining, STUDIO_AUTO_CHOICE_MS - 3_100);
  assert.equal(studioAutoChoiceText(studioAutoChoiceCountdown(view)), "Skipping this step in 7 seconds unless you choose.");
  assert.equal(advanceStudioAutoChoice(view, 10_500), null);
  assert.equal(studioAutoChoiceText(view.autoChoice), "Skipping this step in 1 second unless you choose.");
  assert.equal(advanceStudioAutoChoice(view, 11_000), "skip");
  assert.equal(view.autoChoice, null);
  assert.equal(advanceStudioAutoChoice(view, 30_000), null, "the timer acts once");
  assert.equal(studioAutoChoiceCountdown(view), null);
});

test("reading the reasoning holds the countdown, and a state change restarts it", () => {
  const view = advised("2a", "Run");
  advanceStudioAutoChoice(view, 0);
  advanceStudioAutoChoice(view, 4_000);
  advanceStudioAutoChoice(view, 4_250, { held: true });
  assert.equal(view.autoChoice.remaining, 5_750);
  assert.equal(advanceStudioAutoChoice(view, 60_000, { held: true }), null);
  assert.equal(studioAutoChoiceText(view.autoChoice), "Countdown paused while the reasoning is open.");
  assert.equal(view.autoChoice.remaining, 5_750, "time spent reading does not count");
  advanceStudioAutoChoice(view, 61_000);
  assert.equal(studioAutoChoiceText(view.autoChoice), "Running this step in 6 seconds unless you choose.");
  view.saving = true;
  advanceStudioAutoChoice(view, 62_000);
  view.saving = false;
  advanceStudioAutoChoice(view, 63_000);
  assert.equal(view.autoChoice.remaining, STUDIO_AUTO_CHOICE_MS, "a save restarts the countdown");
  assert.equal(advanceStudioAutoChoice(view, 72_999), null);
  assert.equal(advanceStudioAutoChoice(view, 73_000), "run");
});

test("a translator's action answers the advice for good, while refreshed advice counts down again", () => {
  const view = advised("4.4.4", "Skip");
  advanceStudioAutoChoice(view, 0);
  answerStudioAutoChoice(view);
  assert.equal(view.autoChoice, null);
  // For example the source-summary skip confirmation was cancelled.
  assert.equal(studioAutoChoiceCountdown(view), null);
  assert.equal(advanceStudioAutoChoice(view, 20_000), null);
  view.study.skipRecommendations["4.4.4"] = { ...view.study.skipRecommendations["4.4.4"], recommendation: "Run", createdAt: "2026-10-30T10:05:00.000Z" };
  assert.equal(studioAutoChoiceCountdown(view).choice, "run");
  advanceStudioAutoChoice(view, 21_000);
  assert.equal(advanceStudioAutoChoice(view, 31_000), "run");
});
