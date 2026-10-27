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
