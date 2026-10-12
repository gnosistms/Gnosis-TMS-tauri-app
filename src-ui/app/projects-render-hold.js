// Defers full re-renders while the user is engaged with a protected select on
// the projects page: a chapter status/glossary pill or a project-transfer field.
//
// A native <select> whose element is replaced closes its open popup, so any
// render that lands while the user is choosing — write status badges, the
// deferred repo sync's progress, query snapshots — interrupts rapid
// click-through. Renders are deferred, never dropped: the newest render is
// held and flushed when the select disengages (focusout) or when the user's own
// selection commits (the change event runs with the hold bypassed so the
// optimistic render lands immediately). Chapter selects also use a safety
// timeout so a focused-but-idle inline control cannot stall background updates.
// Modal selects intentionally have no timeout: replacing one while its native
// popup is open closes the menu, and leaving or committing the field always
// provides a deterministic flush point.
//
// Full renders also defer while the user is scrolling the projects list. A full
// render replaces the scroll container, which cuts off trackpad momentum and
// makes the virtual list re-place itself, so background sync renders landing
// mid-scroll feel like hitches. Only real scroll input counts (wheel, touch,
// scroll keys, scrollbar drags); the programmatic scroll a render's own
// position restore causes does not, or typing into the search field would
// start holding its own renders. The held render flushes once scrolling has
// been idle briefly, or after a maximum hold so a long scroll still shows
// updates. Status-bar and update-badge renders touch only their own surfaces
// and always pass through.

const PROJECTS_RENDER_HOLD_SAFETY_MS = 4000;
const PROJECTS_SCROLL_IDLE_MS = 200;
const PROJECTS_SCROLL_MAX_HOLD_MS = 3000;
const PROJECTS_SCROLL_CONTAINER_SELECTOR = '[data-screen="projects"] .page-body';
const SCROLL_HOLD_PASS_THROUGH_SCOPES = new Set(["status-surface", "app-update-progress"]);
const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);
const HOLD_SELECT_SELECTOR =
  [
    "[data-chapter-status-select]",
    "[data-chapter-glossary-select]",
    "[data-project-transfer-team-select]",
    "[data-project-transfer-glossary-select]",
  ].join(", ");
const MODAL_HOLD_SELECT_SELECTOR =
  "[data-project-transfer-team-select], [data-project-transfer-glossary-select]";

let pendingRender = null;
let safetyTimerId = 0;
let commitBypassDepth = 0;
let installed = false;
let userScrolling = false;
let pointerIsDown = false;
let scrollIdleTimerId = 0;
let scrollMaxHoldTimerId = 0;

function isEngagedHoldSelect(element) {
  return (
    typeof HTMLSelectElement === "function"
    && element instanceof HTMLSelectElement
    && element.matches(HOLD_SELECT_SELECTOR)
  );
}

function isModalHoldSelect(element) {
  return isEngagedHoldSelect(element) && element.matches(MODAL_HOLD_SELECT_SELECTOR);
}

export function isProjectsSelectCommitTarget(target) {
  return isEngagedHoldSelect(target);
}

function clearHoldTimers() {
  if (safetyTimerId) {
    clearTimeout(safetyTimerId);
    safetyTimerId = 0;
  }
  if (scrollMaxHoldTimerId) {
    clearTimeout(scrollMaxHoldTimerId);
    scrollMaxHoldTimerId = 0;
  }
}

function activeSelectIsEngaged() {
  return typeof document !== "undefined" && isEngagedHoldSelect(document.activeElement);
}

// Scroll-hold flush points leave a render alone while a select is engaged: the
// select hold owns that render and flushes it on disengage.
function flushScrollHeldRender() {
  if (!activeSelectIsEngaged()) {
    flushProjectsHeldRender();
  }
}

export function flushProjectsHeldRender() {
  clearHoldTimers();

  const performRender = pendingRender;
  pendingRender = null;
  performRender?.();
}

/**
 * Called by the render entry point. Returns true when the render was deferred
 * (the caller should skip it); the newest deferred render wins and is flushed
 * on disengage/commit/safety-timeout.
 */
export function deferProjectsRenderWhileSelectEngaged(appState, performRender) {
  if (
    appState?.screen !== "projects"
    || commitBypassDepth > 0
    || typeof document === "undefined"
    || !isEngagedHoldSelect(document.activeElement)
  ) {
    return false;
  }

  const activeSelect = document.activeElement;
  pendingRender = performRender;
  if (!isModalHoldSelect(activeSelect) && !safetyTimerId) {
    safetyTimerId = setTimeout(() => {
      safetyTimerId = 0;
      flushProjectsHeldRender();
    }, PROJECTS_RENDER_HOLD_SAFETY_MS);
  }
  return true;
}

/**
 * Called by the render entry point after the select hold. Returns true when a
 * full render was deferred because the user is scrolling the projects list.
 */
export function deferProjectsRenderWhileScrolling(appState, options, performRender) {
  if (
    !userScrolling
    || appState?.screen !== "projects"
    || commitBypassDepth > 0
    || SCROLL_HOLD_PASS_THROUGH_SCOPES.has(options?.scope)
  ) {
    return false;
  }

  pendingRender = performRender;
  if (!scrollMaxHoldTimerId) {
    scrollMaxHoldTimerId = setTimeout(() => {
      scrollMaxHoldTimerId = 0;
      flushScrollHeldRender();
    }, PROJECTS_SCROLL_MAX_HOLD_MS);
  }
  return true;
}

export function noteProjectsUserScroll() {
  userScrolling = true;
  if (scrollIdleTimerId) {
    clearTimeout(scrollIdleTimerId);
  }
  scrollIdleTimerId = setTimeout(() => {
    scrollIdleTimerId = 0;
    userScrolling = false;
    flushScrollHeldRender();
  }, PROJECTS_SCROLL_IDLE_MS);
}

function isInProjectsScrollContainer(target) {
  return typeof target?.closest === "function"
    && target.closest(PROJECTS_SCROLL_CONTAINER_SELECTOR) !== null;
}

function isEditableTarget(target) {
  return typeof target?.closest === "function"
    && target.closest("input, textarea, select, [contenteditable]") !== null;
}

/**
 * Runs a select's change handling with the hold bypassed, so the optimistic
 * state write it triggers renders immediately. Any render deferred before the
 * commit is superseded by that fresh render.
 */
export function withProjectsSelectCommit(callback) {
  commitBypassDepth += 1;
  try {
    return callback();
  } finally {
    commitBypassDepth -= 1;
    // The commit just rendered current state; an older held render is
    // redundant now.
    if (commitBypassDepth === 0 && pendingRender) {
      pendingRender = null;
      clearHoldTimers();
    }
  }
}

export function installProjectsRenderHold() {
  if (installed || typeof document === "undefined") {
    return;
  }
  installed = true;
  document.addEventListener(
    "focusout",
    (event) => {
      if (isEngagedHoldSelect(event.target)) {
        flushProjectsHeldRender();
      }
    },
    true,
  );

  const noteScrollInput = (event) => {
    if (isInProjectsScrollContainer(event.target)) {
      noteProjectsUserScroll();
    }
  };
  document.addEventListener("wheel", noteScrollInput, { capture: true, passive: true });
  document.addEventListener("touchmove", noteScrollInput, { capture: true, passive: true });
  document.addEventListener(
    "keydown",
    (event) => {
      if (SCROLL_KEYS.has(event.key) && !isEditableTarget(event.target)) {
        noteProjectsUserScroll();
      }
    },
    true,
  );
  // Scroll events also come from a render restoring the list position, so
  // they count only while a pointer is down, which is how a scrollbar drag
  // shows up.
  document.addEventListener("pointerdown", () => { pointerIsDown = true; }, true);
  for (const eventName of ["pointerup", "pointercancel"]) {
    document.addEventListener(eventName, () => { pointerIsDown = false; }, true);
  }
  document.addEventListener(
    "scroll",
    (event) => {
      if (pointerIsDown) {
        noteScrollInput(event);
      }
    },
    { capture: true, passive: true },
  );
}

export function resetProjectsRenderHoldForTests() {
  pendingRender = null;
  commitBypassDepth = 0;
  userScrolling = false;
  pointerIsDown = false;
  clearHoldTimers();
  if (scrollIdleTimerId) {
    clearTimeout(scrollIdleTimerId);
    scrollIdleTimerId = 0;
  }
}
