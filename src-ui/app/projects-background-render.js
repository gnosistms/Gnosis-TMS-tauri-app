// Project discovery publishes many useful snapshots. Keep applying those through
// Query, but draw the mounted list only when discovery finishes. User actions use
// the ordinary render path and remain immediate.
const BACKGROUND_SCOPE = "projects-background";
const EXPORT_DIALOG = '[data-modal-dialog="editor-export"]';
const mounted = new WeakMap();

export function projectBackgroundRender(render) {
  return (options = {}) => render?.({ ...options, scope: options.scope ?? BACKGROUND_SCOPE });
}

export function projectRefreshInProgress(state) {
  return state.projectsPage?.isRefreshing === true
    || state.projectsPageSync?.status === "syncing"
    || state.projectDiscovery?.status === "loading";
}

export function deferProjectsBackgroundRender(root, state, options = {}) {
  const previous = mounted.get(root);
  return options.scope === BACKGROUND_SCOPE && state.screen === "projects"
    && previous?.teamId === state.selectedTeamId && previous.hasProjects
    && (options.projectUpdatePending === true || projectRefreshInProgress(state));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => key !== "fileLoadState")
    .map((key) => [key, stableValue(value[key])]));
}

export function exportProjectFingerprint(state) {
  const modal = state.editorChapter?.exportModal;
  if (!modal?.isOpen) return "";
  const project = state.projects.find((entry) => modal.projectId
    ? entry.id === modal.projectId
    : entry.chapters?.some((chapter) => chapter.id === modal.chapterId));
  return JSON.stringify([state.selectedTeamId, modal.projectId ?? modal.chapterId, stableValue(project)]);
}

// Replace siblings around the retained backdrop, never removing or moving that
// backdrop. Detach/reinsert would interrupt native popups and text selection.
function replaceAround(root, template, retained, placeholder) {
  for (const child of [...root.childNodes]) if (child !== retained) child.remove();
  while (template.content.firstChild !== placeholder) root.insertBefore(template.content.firstChild, retained);
  placeholder.remove();
  root.append(template.content);
}

/** Returns false when a completed background notification has no visible change. */
export function commitProjectsPageHtml(root, html, state, options = {}) {
  if (state.screen !== "projects") {
    mounted.delete(root);
    root.innerHTML = html;
    return true;
  }
  const previous = mounted.get(root);
  const background = options.scope === BACKGROUND_SCOPE && previous?.teamId === state.selectedTeamId;
  const template = root.ownerDocument.createElement("template");
  template.innerHTML = html;
  const placeholder = template.content.querySelector(EXPORT_DIALOG)?.closest(".modal-backdrop");
  const retained = root.querySelector(EXPORT_DIALOG)?.closest(".modal-backdrop");
  const project = exportProjectFingerprint(state);
  // Compare the page independently of the dialog and the separately patched
  // status surface. Typing in the dialog must not invalidate the project list.
  const comparison = template.content.cloneNode(true);
  comparison.querySelector(EXPORT_DIALOG)?.closest(".modal-backdrop")?.remove();
  comparison.querySelector(".team-ui-debug")?.remove();
  const container = root.ownerDocument.createElement("div");
  container.append(comparison);
  const pageHtml = container.innerHTML;
  const preserveExport = background && retained && placeholder && previous.project === project;
  if (background && previous.pageHtml === pageHtml && (preserveExport || (!retained && !placeholder))) {
    return false;
  }
  if (preserveExport) replaceAround(root, template, retained, placeholder);
  else root.innerHTML = html;
  mounted.set(root, {
    teamId: state.selectedTeamId,
    hasProjects: state.projects.length > 0 || (state.deletedProjects?.length ?? 0) > 0,
    pageHtml,
    // An explicit dialog action during sync does not consume the pending project
    // change. Compare the final snapshot with the last settled project instead.
    project: previous && retained && projectRefreshInProgress(state) ? previous.project : project,
  });
  return true;
}
