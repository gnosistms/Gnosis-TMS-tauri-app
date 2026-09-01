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

const PROJECTS_RENDER_HOLD_SAFETY_MS = 4000;
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
