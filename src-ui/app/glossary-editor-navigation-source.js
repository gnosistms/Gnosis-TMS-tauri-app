export function normalizeGlossaryEditorNavigationSource(value) {
  return value === "editor" ? "editor" : null;
}

export function resolveGlossaryEditorNavigationSource(options = {}, previousSource = null) {
  if (Object.prototype.hasOwnProperty.call(options, "navigationSource")) {
    return normalizeGlossaryEditorNavigationSource(options.navigationSource);
  }

  return normalizeGlossaryEditorNavigationSource(previousSource);
}
