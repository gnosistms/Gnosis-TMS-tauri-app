import { state } from "./state.js";
import { toggleStudioCitation } from "./glossary-research-studio-citations.js";

// A citation can appear in both the activity receipt and the step summary.
function citationButtons(context) {
  const counts = new Map();
  const buttons = new Map();
  for (const button of context.querySelectorAll("button[data-studio-paragraph]")) {
    const scope = button.closest("[data-studio-disclosure]")?.dataset.studioDisclosure
      ?? (button.closest(".studio-work-item") ? "activity" : "step");
    const key = JSON.stringify([scope, button.dataset.studioParagraph]);
    const index = counts.get(key) ?? 0;
    buttons.set(key + index, button);
    counts.set(key, index + 1);
  }
  return buttons;
}

// View-only state for trial reports and scroll regions replaced by progress renders.
// Context includes the study and step so an unrelated report never inherits it.
export function captureStudioDisclosures(root) {
  const context = root.querySelector("[data-studio-disclosure-context]");
  if (!context) return null;
  return {
    context: context.dataset.studioDisclosureContext,
    formsReview: Boolean(context.querySelector("[data-studio-forms-review]")),
    open: new Map([...context.querySelectorAll("details[data-studio-disclosure]")]
      .map((details) => [details.dataset.studioDisclosure, details.open])),
    citations: [...citationButtons(context)].flatMap(([key, button]) => {
      const open = button.getAttribute("aria-expanded") === "true";
      const focused = button === context.ownerDocument.activeElement;
      return open || focused ? [{ key, open, focused }] : [];
    }),
    scroll: [".studio-content", ".studio-outline"].flatMap((selector) => {
      const element = context.querySelector(selector);
      return element ? [{ selector, top: element.scrollTop, left: element.scrollLeft }] : [];
    }),
  };
}

export function restoreStudioDisclosures(root, snapshot) {
  const context = root.querySelector("[data-studio-disclosure-context]");
  if (!context) return;
  if (context.dataset.studioDisclosureContext !== snapshot?.context) {
    context.querySelector('.studio-step-link[aria-current="step"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
    return;
  }
  for (const details of context.querySelectorAll("details[data-studio-disclosure]")) {
    const key = details.dataset.studioDisclosure;
    if (snapshot.open.has(key)) details.open = snapshot.open.get(key);
  }
  if (snapshot.citations?.length) {
    const buttons = citationButtons(context);
    for (const { key, open, focused } of snapshot.citations) {
      const button = buttons.get(key);
      if (open && button?.getAttribute("aria-expanded") === "false") toggleStudioCitation(button, state.glossaryResearchStudio?.study);
      if (focused) button?.focus({ preventScroll: true });
    }
  }
  for (const { selector, top, left } of snapshot.scroll ?? []) {
    const element = context.querySelector(selector);
    if (element) {
      element.scrollTop = top;
      element.scrollLeft = left;
    }
  }
  const review = context.querySelector("[data-studio-forms-review]");
  const content = context.querySelector(".studio-content");
  if (review && content && !snapshot.formsReview) {
    // Reveal the newly completed review once, within the research scroll region.
    // Later edits and progress renders retain the user's own reading position.
    content.scrollTop += review.getBoundingClientRect().top - content.getBoundingClientRect().top
      - (Number.parseFloat(getComputedStyle(content).paddingTop) || 0);
  }
}
