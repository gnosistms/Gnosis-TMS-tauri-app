// Defers full re-renders while the user is engaged with a chapter select
// (status or glossary pill) on the projects page.
//
// A native <select> whose element is replaced closes its open popup, so any
// render that lands while the user is choosing — write status badges, the
// deferred repo sync's progress, query snapshots — interrupts rapid
// click-through. Renders are deferred, never dropped: the newest render is
// held and flushed when the select disengages (focusout), when the user's own
// selection commits (the change event runs with the hold bypassed so the
// optimistic render lands immediately), or after a safety timeout so a
// focused-but-idle select cannot stall background updates indefinitely.

const PROJECTS_RENDER_HOLD_SAFETY_MS = 4000;
const HOLD_SELECT_SELECTOR =
  "[data-chapter-status-select], [data-chapter-glossary-select]";

let pendingRender = null;
let safetyTimerId = 0;
let commitBypassDepth = 0;
let installed = false;

function isEngagedHoldSelect(element) {
  return (
    typeof HTMLSelectElement === "function"
    && element instanceof HTMLSelectElement
    && element.matches(HOLD_SELECT_SELECTOR)
  );
}

export function isProjectsSelectCommitTarget(target) {
  return isEngagedHoldSelect(target);
}

export function flushProjectsHeldRender() {
  if (safetyTimerId) {
    clearTimeout(safetyTimerId);
    safetyTimerId = 0;
  }

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

  pendingRender = performRender;
  if (!safetyTimerId) {
    safetyTimerId = setTimeout(() => {
      safetyTimerId = 0;
      flushProjectsHeldRender();
    }, PROJECTS_RENDER_HOLD_SAFETY_MS);
  }
  return true;
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
      if (safetyTimerId) {
        clearTimeout(safetyTimerId);
        safetyTimerId = 0;
      }
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
}

export function resetProjectsRenderHoldForTests() {
  pendingRender = null;
  commitBypassDepth = 0;
  if (safetyTimerId) {
    clearTimeout(safetyTimerId);
    safetyTimerId = 0;
  }
}
