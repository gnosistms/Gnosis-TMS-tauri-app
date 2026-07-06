// Session-scoped viewport anchor for the projects page, following the
// editor-scroll-session pattern: one module owns the anchor, renders restore
// from it by construction, and the scroll handler keeps it current.
//
// The anchor is model-space — a flat-list item key plus the item's pixel
// offset from the top of the scroll container — so it survives full
// re-renders, item-list changes (expand/collapse), and, unlike a raw
// scrollTop, remains meaningful when content above the viewport changes
// height. Team-scoped so a stale anchor can never leak across team switches.
// Module-level state deliberately survives renders and screen changes: the
// projects virtual list controller is destroyed and recreated on every full
// render, and leave-and-return within a session restores from here.

let sessionAnchor = null;
let sessionAnchorTeamId = "";

export function updateProjectsSessionAnchor(anchor, teamId = "") {
  if (!anchor?.itemKey) {
    return;
  }

  sessionAnchor = { ...anchor };
  sessionAnchorTeamId = typeof teamId === "string" ? teamId : "";
}

export function readProjectsSessionAnchor(teamId = "") {
  if (!sessionAnchor) {
    return null;
  }

  const normalizedTeamId = typeof teamId === "string" ? teamId : "";
  if (sessionAnchorTeamId !== normalizedTeamId) {
    return null;
  }

  return { ...sessionAnchor };
}

export function clearProjectsSessionAnchor() {
  sessionAnchor = null;
  sessionAnchorTeamId = "";
}

function isHtmlElement(value) {
  return typeof HTMLElement === "function" && value instanceof HTMLElement;
}

/**
 * Top-most projects-list item intersecting the viewport, as an anchor.
 * DOM scan over the rendered window only (bounded by the virtualizer).
 */
export function captureVisibleProjectsAnchor() {
  const container = document.querySelector(".page-body");
  if (!isHtmlElement(container)) {
    return null;
  }

  const containerRect = container.getBoundingClientRect();
  const items = document.querySelectorAll("[data-projects-item-key]");
  for (const item of items) {
    const rect = item.getBoundingClientRect();
    if (rect.bottom > containerRect.top && rect.top < containerRect.bottom) {
      return {
        itemKey: item.dataset.projectsItemKey ?? "",
        offsetTop: rect.top - containerRect.top,
      };
    }
  }

  return null;
}

/**
 * Pin a specific item (by key) at its current viewport offset before a
 * mutation re-renders the list. Used by expand/collapse toggles so the
 * clicked header/separator stays stationary while content unfolds beneath
 * it — including when the current anchor sits inside the section being
 * collapsed away.
 */
export function anchorProjectsSessionToItem(itemKey, teamId = "") {
  if (typeof itemKey !== "string" || !itemKey) {
    return false;
  }

  const container = document.querySelector(".page-body");
  const item = document.querySelector(
    `[data-projects-item-key="${CSS.escape(itemKey)}"]`,
  );
  if (!isHtmlElement(container) || !isHtmlElement(item)) {
    return false;
  }

  updateProjectsSessionAnchor(
    {
      itemKey,
      offsetTop: item.getBoundingClientRect().top - container.getBoundingClientRect().top,
    },
    teamId,
  );
  return true;
}

export function resetProjectsScrollSessionForTests() {
  sessionAnchor = null;
  sessionAnchorTeamId = "";
}
