// TanStack Virtual controller for the projects page list.
//
// Unlike the editor controller, the item model is immutable for a controller's
// lifetime: every projects-page state change (toggle, rename, snapshot apply)
// goes through a full main.js render, which tears this controller down and
// recreates it against the fresh DOM. The controller owns scroll-driven
// window updates and the scroll session anchor: it updates the anchor on
// every scroll and restores from it at mount, so full re-renders preserve the
// viewport by construction even when the item list changed shape.
//
// Scroll performance: projects rows are short (~45px), so the visible range
// advances every few dozen scrolled pixels. Rebuilding the whole window per
// range change (the editor's approach, fine for its huge rows) makes momentum
// scrolling jerky here. Instead the rendered range is a buffered superset of
// the required range, patched incrementally: scrolls that stay inside the
// buffer do no DOM work at all; when the buffer is exceeded, only the edge
// items are inserted/removed and only inserted items are measured. The
// session anchor is likewise derived from virtualizer coordinates, not a DOM
// scan, so the per-scroll-event cost is arithmetic only.
//
// The scroll container (.page-body) also holds content above and below the
// list (warnings, deleted-projects section), so the virtualizer runs with a
// scrollMargin equal to the list's offset inside the container.

import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
} from "@tanstack/virtual-core";
import {
  PROJECTS_VIRTUALIZATION_INITIAL_VIEWPORT_PX,
  PROJECTS_VIRTUALIZATION_MIN_ITEMS,
  calculateProjectsVirtualWindow,
  estimateProjectsListItemHeight,
  parseProjectsListItemProjectId,
  projectHeaderItemKey,
} from "./projects-list-model.js";
import {
  captureVisibleProjectsAnchor,
  readProjectsSessionAnchor,
  updateProjectsSessionAnchor,
} from "./projects-scroll-session.js";
import {
  consumeProjectsScrollTopReset,
  scheduleProjectsScrollSave,
} from "./projects-scroll-store.js";

// Items rendered beyond the viewport, kept deliberately minimal. WKWebView
// does not pre-rasterize offscreen rows: anything inserted ahead of the
// viewport just paints late as one large block when it scrolls into view
// (tested — a 24-item runway made hard-flick flicker chunkier, not smoother,
// matching the editor's tuning experience). Rendering just-in-time keeps
// per-frame patches at one or two rows and confines paint latency to a
// single row at the leading edge.
const PROJECTS_VIRTUALIZER_OVERSCAN_ITEMS = 2;

let activeController = null;

// Measured item heights per team, keyed by item key. Survives re-renders so
// the initial window of the next render starts from real numbers.
const itemHeightCacheByTeamId = new Map();

function getProjectsItemHeightCache(teamId) {
  const normalizedTeamId = typeof teamId === "string" && teamId ? teamId : "unknown";
  if (!itemHeightCacheByTeamId.has(normalizedTeamId)) {
    itemHeightCacheByTeamId.set(normalizedTeamId, new Map());
  }
  return itemHeightCacheByTeamId.get(normalizedTeamId);
}

// Debug/A-B switch (window.__gnosisDebug.setProjectsVirtualizationDisabled):
// renders the full flat list with no windowing so virtualized vs plain
// scrolling can be compared live on real data. Session-anchor tracking and
// scroll persistence stay active via the plain tracker.
let virtualizationDisabledForDebug = false;

export function setProjectsVirtualizationDisabled(disabled) {
  virtualizationDisabledForDebug = disabled === true;
  return virtualizationDisabledForDebug;
}

export function shouldVirtualizeProjectsList(items) {
  return (
    !virtualizationDisabledForDebug
    && Array.isArray(items)
    && items.length >= PROJECTS_VIRTUALIZATION_MIN_ITEMS
  );
}

function isHtmlElement(value) {
  return typeof HTMLElement === "function" && value instanceof HTMLElement;
}

function measureListScrollMargin(scrollContainer, list) {
  return (
    list.getBoundingClientRect().top
    - scrollContainer.getBoundingClientRect().top
    + scrollContainer.scrollTop
  );
}

function itemHeightsForWindow(items, heightCache) {
  return items.map((item) => heightCache.get(item.key) ?? estimateProjectsListItemHeight(item));
}

/**
 * Fallback chain for a saved anchor against the current item list: the exact
 * item, else the owning project's header (item collapsed away or deleted),
 * else nothing (project gone — the caller keeps the current position).
 */
export function resolveProjectsAnchorIndex(anchor, itemIndexByKey) {
  const itemKey = typeof anchor?.itemKey === "string" ? anchor.itemKey : "";
  if (!itemKey) {
    return null;
  }

  const exactIndex = itemIndexByKey.get(itemKey);
  if (Number.isInteger(exactIndex)) {
    return { index: exactIndex, itemKey };
  }

  const headerKey = projectHeaderItemKey(parseProjectsListItemProjectId(itemKey));
  const headerIndex = itemIndexByKey.get(headerKey);
  if (Number.isInteger(headerIndex)) {
    return { index: headerIndex, itemKey: headerKey };
  }

  return null;
}

function estimatedItemStart(itemHeights, index) {
  let start = 0;
  for (let cursor = 0; cursor < index; cursor += 1) {
    start += itemHeights[cursor] ?? 0;
  }
  return start;
}

function findRenderedItemElement(itemKey) {
  return document.querySelector(
    `[data-projects-item-key="${CSS.escape(itemKey)}"]`,
  );
}

/**
 * Fine-grained anchor restore against the mounted DOM: scroll by the delta
 * between where the anchor item sits now and where the anchor says it should
 * sit. Returns false when the item is not rendered.
 */
function restoreAnchorAgainstDom(scrollContainer, itemKey, offsetTop) {
  const item = findRenderedItemElement(itemKey);
  if (!isHtmlElement(item)) {
    return false;
  }

  const containerRect = scrollContainer.getBoundingClientRect();
  const currentOffsetTop = item.getBoundingClientRect().top - containerRect.top;
  const scrollDelta = currentOffsetTop - offsetTop;
  if (Number.isFinite(scrollDelta) && Math.abs(scrollDelta) >= 1) {
    scrollContainer.scrollTop += scrollDelta;
  }
  return true;
}

/**
 * Initial window for a full screen render, computed before the new HTML
 * exists. Prefers the session anchor's position (so re-renders and same-team
 * re-entries build the right window immediately); falls back to the outgoing
 * DOM's scroll position, or the top on a cold entry.
 */
export function resolveProjectsInitialWindowState(appState, items) {
  if (!shouldVirtualizeProjectsList(items)) {
    return null;
  }

  const heightCache = getProjectsItemHeightCache(appState?.selectedTeamId ?? "");
  const itemHeights = itemHeightsForWindow(items, heightCache);
  const scrollContainer = document.querySelector(".page-body");
  const viewportHeight = isHtmlElement(scrollContainer) && scrollContainer.clientHeight > 0
    ? scrollContainer.clientHeight
    : PROJECTS_VIRTUALIZATION_INITIAL_VIEWPORT_PX;

  let listRelativeScrollTop = 0;
  const anchor = readProjectsSessionAnchor(appState?.selectedTeamId ?? "");
  const anchorTarget = anchor
    ? resolveProjectsAnchorIndex(
        anchor,
        new Map(items.map((item, index) => [item.key, index])),
      )
    : null;
  if (anchorTarget) {
    listRelativeScrollTop = Math.max(
      0,
      estimatedItemStart(itemHeights, anchorTarget.index) - (anchor.offsetTop ?? 0),
    );
  } else {
    const list = document.querySelector("[data-projects-virtual-list]");
    if (isHtmlElement(scrollContainer) && isHtmlElement(list)) {
      listRelativeScrollTop = Math.max(
        0,
        scrollContainer.scrollTop - measureListScrollMargin(scrollContainer, list),
      );
    }
  }

  return calculateProjectsVirtualWindow(itemHeights, listRelativeScrollTop, viewportHeight);
}

function updateSpacerHeight(spacer, height) {
  spacer.style.height = `${Math.max(0, Math.round(height))}px`;
}

// Non-virtual mode: no windowing, but the session anchor still needs a
// scroll-tracking owner and an at-mount restore so small teams get the same
// leave-and-return and toggle-stability behavior.
function createPlainProjectsScrollTracker(scrollContainer, teamId, projectIds) {
  const handleScroll = () => {
    const anchor = captureVisibleProjectsAnchor();
    updateProjectsSessionAnchor(anchor, teamId);
    scheduleProjectsScrollSave(teamId, anchor, projectIds, scrollContainer.scrollTop);
  };
  scrollContainer.addEventListener("scroll", handleScroll, { passive: true });

  if (consumeProjectsScrollTopReset()) {
    scrollContainer.scrollTop = 0;
  }
  const anchor = readProjectsSessionAnchor(teamId);
  if (anchor?.itemKey) {
    if (!restoreAnchorAgainstDom(scrollContainer, anchor.itemKey, anchor.offsetTop ?? 0)) {
      const headerKey = projectHeaderItemKey(parseProjectsListItemProjectId(anchor.itemKey));
      restoreAnchorAgainstDom(scrollContainer, headerKey, anchor.offsetTop ?? 0);
    }
    updateProjectsSessionAnchor(captureVisibleProjectsAnchor(), teamId);
  }

  return {
    destroy() {
      scrollContainer.removeEventListener("scroll", handleScroll);
    },
  };
}

/**
 * Mount the controller for the current render. `hooks` injects the screen
 * layer (no app → screens imports):
 *   buildListState(appState) -> { items, context }
 *   renderItemsRange(items, context, startIndex, endIndex) -> html string
 */
export function initializeProjectsVirtualization(root, appState, hooks) {
  activeController?.destroy?.();
  activeController = null;

  if (appState?.screen !== "projects") {
    return;
  }

  const scrollContainer = root.querySelector(".page-body");
  const list = root.querySelector("[data-projects-virtual-list]");
  const itemsContainer = root.querySelector("[data-projects-virtual-items]");
  const topSpacer = root.querySelector('[data-projects-virtual-spacer="top"]');
  const bottomSpacer = root.querySelector('[data-projects-virtual-spacer="bottom"]');
  if (
    !isHtmlElement(scrollContainer)
    || !isHtmlElement(list)
    || !isHtmlElement(itemsContainer)
    || !isHtmlElement(topSpacer)
    || !isHtmlElement(bottomSpacer)
  ) {
    return;
  }

  const teamId = appState.selectedTeamId ?? "";
  const projectIds = (Array.isArray(appState.projects) ? appState.projects : []).map(
    (project) => String(project?.id ?? ""),
  );
  const { items, context } = hooks.buildListState(appState);
  if (!shouldVirtualizeProjectsList(items)) {
    activeController = createPlainProjectsScrollTracker(scrollContainer, teamId, projectIds);
    return;
  }

  const heightCache = getProjectsItemHeightCache(teamId);
  const itemIndexByKey = new Map(items.map((item, index) => [item.key, index]));
  const scrollMargin = measureListScrollMargin(scrollContainer, list);

  // Contiguous index range currently in the DOM ([start, end)); -1 marks
  // "nothing rendered yet" so the first pass always rebuilds.
  let renderedStart = -1;
  let renderedEnd = -1;
  let animationFrameId = 0;
  let isRendering = false;
  let needsPostMeasureRender = false;
  // Virtual-core's built-in scroll compensation on resizeItem is wanted only
  // while measuring during scroll-driven renders (keeps upward scrolling
  // smooth as estimates correct to real heights). See the editor controller
  // for the failure mode when it acts alongside explicit anchoring.
  let allowResizeScrollAdjustment = true;

  const virtualizer = new Virtualizer({
    count: items.length,
    getScrollElement: () => scrollContainer,
    estimateSize: (index) => {
      const item = items[index] ?? null;
      return item
        ? (heightCache.get(item.key) ?? estimateProjectsListItemHeight(item))
        : 40;
    },
    getItemKey: (index) => items[index]?.key ?? index,
    overscan: PROJECTS_VIRTUALIZER_OVERSCAN_ITEMS,
    scrollMargin,
    initialRect: {
      width: scrollContainer.clientWidth || 0,
      height: scrollContainer.clientHeight || PROJECTS_VIRTUALIZATION_INITIAL_VIEWPORT_PX,
    },
    initialOffset: () => scrollContainer.scrollTop,
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    useAnimationFrameWithResizeObserver: true,
    onChange: (_instance, sync) => {
      if (isRendering) {
        needsPostMeasureRender = true;
        return;
      }

      scheduleRender(sync ? "scroll" : "virtualizer-change");
    },
  });
  // Instance field, not an option — setting it via options is silently ignored.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
    allowResizeScrollAdjustment
    && item.start < instance.getScrollOffset() + instance.scrollAdjustments;
  const cleanupVirtualizer = virtualizer._didMount();
  virtualizer._willUpdate();

  const readRequiredRange = () => {
    const virtualItems = virtualizer.getVirtualItems();
    if (virtualItems.length === 0) {
      return { startIndex: 0, endIndex: 0 };
    }
    const firstItem = virtualItems[0];
    const lastItem = virtualItems[virtualItems.length - 1];
    return {
      startIndex: Number.isInteger(firstItem?.index) ? firstItem.index : 0,
      endIndex: Number.isInteger(lastItem?.index) ? lastItem.index + 1 : 0,
    };
  };

  const applySpacersForRenderedRange = () => {
    const itemHeights = itemHeightsForWindow(items, heightCache);
    let topHeight = 0;
    for (let index = 0; index < renderedStart; index += 1) {
      topHeight += itemHeights[index];
    }
    let bottomHeight = 0;
    for (let index = renderedEnd; index < itemHeights.length; index += 1) {
      bottomHeight += itemHeights[index];
    }
    updateSpacerHeight(topSpacer, topHeight);
    updateSpacerHeight(bottomSpacer, bottomHeight);
  };

  /**
   * Bring the DOM to exactly [targetStart, targetEnd): trim departed edge
   * items, insert arriving ones, full rebuild only when the ranges are
   * disjoint. Returns the keys of inserted items (the only ones that need
   * measuring).
   */
  const patchRenderedRange = (targetStart, targetEnd) => {
    const insertedKeys = [];
    const collectKeys = (start, end) => {
      for (let index = start; index < end; index += 1) {
        insertedKeys.push(items[index].key);
      }
    };

    const disjoint =
      renderedStart < 0
      || targetStart >= renderedEnd
      || targetEnd <= renderedStart;
    if (disjoint) {
      itemsContainer.innerHTML = hooks.renderItemsRange(items, context, targetStart, targetEnd);
      collectKeys(targetStart, targetEnd);
    } else {
      for (let count = targetStart - renderedStart; count > 0; count -= 1) {
        itemsContainer.firstElementChild?.remove();
      }
      for (let count = renderedEnd - targetEnd; count > 0; count -= 1) {
        itemsContainer.lastElementChild?.remove();
      }
      // Drop whitespace text nodes stranded at the edges by the removals so
      // they don't accumulate across patches.
      while (itemsContainer.firstChild && itemsContainer.firstChild.nodeType !== 1) {
        itemsContainer.firstChild.remove();
      }
      while (itemsContainer.lastChild && itemsContainer.lastChild.nodeType !== 1) {
        itemsContainer.lastChild.remove();
      }
      if (targetStart < renderedStart) {
        itemsContainer.insertAdjacentHTML(
          "afterbegin",
          hooks.renderItemsRange(items, context, targetStart, renderedStart),
        );
        collectKeys(targetStart, renderedStart);
      }
      if (targetEnd > renderedEnd) {
        itemsContainer.insertAdjacentHTML(
          "beforeend",
          hooks.renderItemsRange(items, context, renderedEnd, targetEnd),
        );
        collectKeys(renderedEnd, targetEnd);
      }
    }

    renderedStart = targetStart;
    renderedEnd = targetEnd;
    return insertedKeys;
  };

  const measureItemsByKey = (itemKeys) => {
    let changed = false;
    for (const itemKey of itemKeys) {
      const itemIndex = itemIndexByKey.get(itemKey);
      if (!Number.isInteger(itemIndex)) {
        continue;
      }

      const itemElement = itemsContainer.querySelector(
        `[data-projects-item-key="${CSS.escape(itemKey)}"]`,
      );
      if (!isHtmlElement(itemElement)) {
        continue;
      }

      const measuredHeight = Math.ceil(itemElement.getBoundingClientRect().height);
      if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) {
        continue;
      }

      if (heightCache.get(itemKey) === measuredHeight) {
        continue;
      }

      heightCache.set(itemKey, measuredHeight);
      virtualizer.resizeItem(itemIndex, measuredHeight);
      changed = true;
    }
    return changed;
  };

  const renderedItemKeys = () =>
    [...itemsContainer.querySelectorAll("[data-projects-item-key]")].map(
      (element) => element.dataset.projectsItemKey ?? "",
    );

  const withResizeScrollAdjustment = (enabled, callback) => {
    const previous = allowResizeScrollAdjustment;
    allowResizeScrollAdjustment = enabled;
    try {
      return callback();
    } finally {
      allowResizeScrollAdjustment = previous;
    }
  };

  const renderWindow = (force = false, reason = "render") => {
    isRendering = true;
    needsPostMeasureRender = false;
    const isScrollDrivenRender = reason === "scroll";
    let rebuild = force;

    try {
      // Measurement of inserted items can shift the required range; loop
      // until it settles (bounded — heights converge to measured values).
      for (let pass = 0; pass < 4; pass += 1) {
        const required = readRequiredRange();
        const targetStart = required.startIndex;
        const targetEnd = required.endIndex;
        if (!rebuild && targetStart === renderedStart && targetEnd === renderedEnd) {
          break;
        }
        rebuild = false;

        const insertedKeys = patchRenderedRange(targetStart, targetEnd);
        applySpacersForRenderedRange();
        const heightsChanged = withResizeScrollAdjustment(isScrollDrivenRender, () =>
          measureItemsByKey(insertedKeys));
        if (!heightsChanged) {
          break;
        }
        applySpacersForRenderedRange();
      }
    } finally {
      isRendering = false;
    }

    if (needsPostMeasureRender) {
      needsPostMeasureRender = false;
      scheduleRender("post-measure");
    }
  };

  function scheduleRender(reason = "render") {
    if (animationFrameId) {
      return;
    }

    animationFrameId = window.requestAnimationFrame(() => {
      animationFrameId = 0;
      renderWindow(false, reason);
    });
  }

  // Session anchor for the current viewport: the candidate item is picked
  // arithmetically from virtualizer coordinates, but its offset is read from
  // the DOM — with measurement deferred during momentum, virtualizer
  // positions are estimates and can drift from real layout by the
  // accumulated estimate error. One rect read per scroll event is cheap
  // (layout is valid mid-scroll; per-frame DOM writes happen later, in rAF).
  const captureCurrentAnchor = () => {
    const scrollOffset = virtualizer.getScrollOffset();
    const hit = virtualizer.getVirtualItems().find((virtualItem) => virtualItem.end > scrollOffset);
    const item = Number.isInteger(hit?.index) ? items[hit.index] : null;
    if (!item) {
      return null;
    }

    // Rendered range is contiguous, so the element is addressable by index.
    let element = itemsContainer.children[hit.index - renderedStart] ?? null;
    if (!isHtmlElement(element) || element.dataset.projectsItemKey !== item.key) {
      element = findRenderedItemElement(item.key);
    }
    if (!isHtmlElement(element)) {
      // Scrolled past the rendered range within this frame; keep the previous
      // anchor — the post-patch scroll event will refresh it.
      return null;
    }

    return {
      itemKey: item.key,
      offsetTop:
        element.getBoundingClientRect().top - scrollContainer.getBoundingClientRect().top,
    };
  };

  const restoreSessionAnchor = () => {
    const anchor = readProjectsSessionAnchor(teamId);
    const anchorTarget = anchor ? resolveProjectsAnchorIndex(anchor, itemIndexByKey) : null;
    if (!anchorTarget) {
      return;
    }

    const offsetTop = Number.isFinite(anchor.offsetTop) ? anchor.offsetTop : 0;
    // Coarse pass: position the scroll container from estimated/cached item
    // offsets, then rebuild the window there. The scroll event from this
    // write lands asynchronously, so mirror the offset into the virtualizer
    // for the synchronous (pre-paint) window computation.
    const itemHeights = itemHeightsForWindow(items, heightCache);
    const desiredScrollTop = Math.max(
      0,
      Math.min(
        virtualizer.options.scrollMargin
          + estimatedItemStart(itemHeights, anchorTarget.index)
          - offsetTop,
        scrollContainer.scrollHeight - scrollContainer.clientHeight,
      ),
    );
    if (Math.abs(scrollContainer.scrollTop - desiredScrollTop) >= 1) {
      scrollContainer.scrollTop = desiredScrollTop;
      virtualizer.scrollOffset = desiredScrollTop;
      renderWindow(true, "anchor-restore");
    }

    // Fine pass: align the mounted anchor element exactly. Each alignment can
    // pull previously unmeasured items into the window, and measuring them
    // shifts content (compensation is off outside scroll-driven renders), so
    // iterate until the anchor is stable — heights converge to measured
    // values, so this settles in a pass or two.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const anchorElement = findRenderedItemElement(anchorTarget.itemKey);
      if (!isHtmlElement(anchorElement)) {
        break;
      }

      const scrollDelta =
        anchorElement.getBoundingClientRect().top
        - scrollContainer.getBoundingClientRect().top
        - offsetTop;
      if (!Number.isFinite(scrollDelta) || Math.abs(scrollDelta) < 1) {
        break;
      }

      scrollContainer.scrollTop += scrollDelta;
      virtualizer.scrollOffset = scrollContainer.scrollTop;
      renderWindow(false, "anchor-restore");
    }
    updateProjectsSessionAnchor(captureCurrentAnchor(), teamId);
  };

  const handleScroll = () => {
    const anchor = captureCurrentAnchor();
    updateProjectsSessionAnchor(anchor, teamId);
    scheduleProjectsScrollSave(teamId, anchor, projectIds, scrollContainer.scrollTop);
  };
  scrollContainer.addEventListener("scroll", handleScroll, { passive: true });

  // Item heights depend on layout width: re-measure what is mounted after a
  // resize (off-window cache entries self-correct as they re-enter the window
  // and get measured as insertions).
  const handleResize = () => {
    withResizeScrollAdjustment(false, () => measureItemsByKey(renderedItemKeys()));
    applySpacersForRenderedRange();
    renderWindow(true, "resize");
  };
  window.addEventListener("resize", handleResize);

  if (consumeProjectsScrollTopReset() && scrollContainer.scrollTop !== 0) {
    scrollContainer.scrollTop = 0;
    virtualizer.scrollOffset = 0;
  }
  renderWindow(true, "initial-render");
  restoreSessionAnchor();

  activeController = {
    destroy() {
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
        animationFrameId = 0;
      }
      scrollContainer.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
      cleanupVirtualizer?.();
    },
  };
}
