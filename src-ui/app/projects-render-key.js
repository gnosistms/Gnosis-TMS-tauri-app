// Identifies what a full projects-page render would show, so a render that
// would change nothing can be skipped. A full render replaces the scroll
// container, which interrupts scrolling, and background sync asks for many
// renders whose result is identical to what is already on screen.
//
// The key is the screen's markup with three render-to-render differences
// removed that do not reflect a change in what the page shows:
// - the virtual list window, which follows the scroll position: the key is
//   built with every list item rendered (see renderProjectsScreen's fullList);
// - the refresh spinner's animation offset, which is the elapsed time since
//   the refresh started and so differs on every render;
// - the floating status surface, which has its own scoped render and is
//   refreshed separately when a full render is skipped.

const SPIN_DELAY_STYLE_PATTERN = / style="--title-icon-spin-delay: -\d+ms;"/g;

export function buildProjectsRenderKey({ screenHtml, statusSurfaceHtml = "", extraParts = [] }) {
  let key = String(screenHtml ?? "").replace(SPIN_DELAY_STYLE_PATTERN, "");
  const statusSurface = String(statusSurfaceHtml ?? "");
  if (statusSurface) {
    key = key.replace(statusSurface, "");
  }
  return [key, ...extraParts.map((part) => String(part ?? ""))].join("\u0000");
}
