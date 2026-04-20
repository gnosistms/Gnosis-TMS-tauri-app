export function resolveNavigationLeaveLoading(previousScreen, navTarget, options = {}) {
  if (previousScreen === "translate" && navTarget !== "translate") {
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

  return null;
}
