import { state } from "./state.js";
import { currentStudioRecommendation, studioCanRecommendSkip, studioResearchStarted } from "./glossary-research-studio-recommendations.js";

// The translator has this long to answer the AI's Run or Skip recommendation
// before the studio takes it. See plans/studio-recommendation-countdown.md.
export const STUDIO_AUTO_CHOICE_MS = 10_000;
const TICK_MS = 250;

/** The recommendation waiting on the translator at the research frontier, or null. */
export function studioAutoChoiceTarget(s, view) {
  if (!s || view.busy || view.saving || view.modal || view.revisiting || view.error || s.pendingDecision) return null;
  if (!studioCanRecommendSkip(s.step) || ["complete", "merged", "cancelled"].includes(s.status) || studioResearchStarted(s)) return null;
  // A fallback Run is the studio's default after the AI failed, not its advice.
  const recommendation = currentStudioRecommendation(s);
  if (!recommendation || recommendation.fallback) return null;
  const key = `${s.id}:${s.step}:${recommendation.createdAt}`;
  if (view.autoChoiceAnswered === key) return null;
  return { key, choice: recommendation.recommendation === "Skip" ? "skip" : "run" };
}

/** The countdown to show for the current recommendation, or null. */
export function studioAutoChoiceCountdown(view) {
  const target = studioAutoChoiceTarget(view.study, view);
  if (!target) return null;
  return view.autoChoice?.key === target.key ? view.autoChoice : { ...target, remaining: STUDIO_AUTO_CHOICE_MS, held: false };
}

export function studioAutoChoiceText(countdown) {
  if (countdown.held) return "Countdown paused while the reasoning is open.";
  const seconds = Math.ceil(countdown.remaining / 1000);
  return `${countdown.choice === "skip" ? "Skipping" : "Running"} this step in ${seconds} ${seconds === 1 ? "second" : "seconds"} unless you choose.`;
}

/** A studio action by the translator answers the recommendation, so it never counts down again. */
export function answerStudioAutoChoice(view) {
  const target = studioAutoChoiceTarget(view.study, view);
  if (target) view.autoChoiceAnswered = target.key;
  view.autoChoice = null;
}

/**
 * Advances the countdown to `now` and returns "run" or "skip" once its time is up.
 * Time spent `held` does not count. Any interruption restarts the countdown when
 * the recommendation is back.
 */
export function advanceStudioAutoChoice(view, now, { held = false } = {}) {
  const target = studioAutoChoiceTarget(view.study, view);
  const armed = view.autoChoice;
  if (!target) { view.autoChoice = null; return null; }
  if (armed?.key !== target.key) {
    view.autoChoice = { ...target, remaining: STUDIO_AUTO_CHOICE_MS, at: now, held };
    return null;
  }
  if (!armed.held) armed.remaining = Math.max(0, armed.remaining - (now - armed.at));
  armed.at = now; armed.held = held;
  if (armed.remaining > 0 || held) return null;
  view.autoChoiceAnswered = armed.key; view.autoChoice = null;
  return armed.choice;
}

let timer = null;
let takeChoice = () => {};

/** Ticks the countdown while the studio is open; `act` takes the recommendation. */
export function startStudioAutoChoice(view, act) {
  takeChoice = act;
  if (timer !== null || typeof document === "undefined" || typeof setInterval !== "function") return;
  timer = setInterval(() => {
    if (state.screen !== "glossaryResearchStudio") {
      clearInterval(timer); timer = null; view().autoChoice = null; return;
    }
    const reasoning = document.querySelector('[data-studio-disclosure="recommendation-reason"]');
    const choice = advanceStudioAutoChoice(view(), Date.now(), { held: Boolean(reasoning?.open) });
    if (choice) takeChoice(choice);
    else showCountdown(view().autoChoice);
  }, TICK_MS);
}

// Updates the rendered countdown in place, without a full render each second.
function showCountdown(countdown) {
  const element = document.querySelector("[data-studio-auto-choice]");
  if (!element || !countdown) return;
  const label = element.querySelector("[data-studio-auto-choice-text]");
  const text = studioAutoChoiceText(countdown);
  if (label && label.textContent !== text) label.textContent = text;
  element.classList.toggle("is-held", countdown.held);
  element.style.setProperty("--studio-auto-choice-left", String(countdown.remaining / STUDIO_AUTO_CHOICE_MS));
}
