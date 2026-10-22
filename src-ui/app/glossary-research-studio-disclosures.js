// View-only state for trial reports that are replaced by progress renders.
// Context includes the study and step so an unrelated report never inherits it.
export function captureStudioDisclosures(root) {
  const context = root.querySelector("[data-studio-disclosure-context]");
  if (!context) return null;
  return {
    context: context.dataset.studioDisclosureContext,
    open: new Map([...context.querySelectorAll("details[data-studio-disclosure]")]
      .map((details) => [details.dataset.studioDisclosure, details.open])),
  };
}

export function restoreStudioDisclosures(root, snapshot) {
  if (!snapshot) return;
  const context = root.querySelector("[data-studio-disclosure-context]");
  if (context?.dataset.studioDisclosureContext !== snapshot.context) return;
  for (const details of context.querySelectorAll("details[data-studio-disclosure]")) {
    const key = details.dataset.studioDisclosure;
    if (snapshot.open.has(key)) details.open = snapshot.open.get(key);
  }
}
