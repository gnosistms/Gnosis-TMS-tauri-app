export function resolveNavigationLeaveLoading(previousScreen, navTarget, options = {}) {
  if (previousScreen === "translate" && navTarget !== "translate" && navTarget !== "projects") {
    return {
      title: "Saving and syncing...",
      message: "Please wait before leaving the editor.",
    };
  }

  if (
    previousScreen === "glossaryEditor"
    && navTarget !== "glossaryEditor"
    && options.glossaryNeedsExitSync === true
  ) {
    return {
      title: "Saving and syncing...",
      message: "Please wait before leaving the glossary.",
    };
  }

  if (
    previousScreen === "qaListEditor"
    && navTarget !== "qaListEditor"
    && options.qaListNeedsExitSync === true
  ) {
    return {
      title: "Saving and syncing...",
      message: "Please wait before leaving the QA list.",
    };
  }

  return null;
}
