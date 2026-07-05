// Single owner for translate-editor scroll arbitration and (eventually) the
// viewport anchor. See plans/editor-scroll-ownership-redesign-plan.md.
//
// The core invariant: a programmatic scroll must never act on information
// older than the user's latest scroll input. Every user scroll input bumps a
// generation counter; viewport snapshots record the generation at capture
// time, and restores from a stale generation are refused. Deliberate
// user-initiated transitions (filter clear, jump to row) pass `userIntent`
// and bypass the staleness check — they ARE the user's latest intent.
//
// Module-level state deliberately survives translate-body re-renders: the
// virtual list controller is destroyed and recreated on every body render, so
// it cannot own cross-render scroll state itself.

import { logEditorScrollDebug } from "./editor-scroll-debug.js";

let userScrollGeneration = 0;
let sessionAnchor = null;
let sessionAnchorChapterId = "";

/**
 * Record that the user expressed scroll intent (wheel, touch drag, scrollbar
 * drag, or a scroll key). Never call this for programmatic scrollTop writes —
 * `scroll` events do not distinguish the two, which is why intent is captured
 * from input events instead.
 *
 * Deliberate viewport jumps the app performs as the direct response to a user
 * action (bottom-pin on opening the upload editor, scroll-to-top on filter
 * activation, center-row on show-in-context) also count: they represent the
 * user's current intent, so anchors and snapshots captured before the jump
 * must go stale and not drag the viewport back.
 */
export function noteUserScrollIntent(source = "") {
  userScrollGeneration += 1;
  logEditorScrollDebug("user-scroll-intent", {
    source,
    userScrollGeneration,
  });
}

export function readUserScrollGeneration() {
  return userScrollGeneration;
}

/**
 * True when a snapshot captured at `basisGeneration` may still drive a
 * programmatic scroll. Snapshots without a recorded generation are allowed —
 * only stamped snapshots opt into arbitration.
 */
export function isUserScrollBasisCurrent(basisGeneration) {
  if (!Number.isFinite(basisGeneration)) {
    return true;
  }

  return basisGeneration >= userScrollGeneration;
}

/**
 * Session anchor: the model-space viewport location (row id + pixel offset)
 * maintained continuously so renders can preserve the viewport without every
 * mutation call site capturing its own snapshot. Written by the virtual list
 * controller's scroll handler and by anchored renders; read by the render
 * pipeline as the default anchor. Chapter-scoped so a stale anchor can never
 * leak across chapter switches.
 */
export function updateSessionAnchor(anchor, chapterId = "") {
  if (!anchor?.rowId) {
    return;
  }

  sessionAnchor = {
    ...anchor,
  };
  sessionAnchorChapterId = typeof chapterId === "string" ? chapterId : "";
}

export function readSessionAnchor(chapterId = "") {
  if (!sessionAnchor) {
    return null;
  }

  const normalizedChapterId = typeof chapterId === "string" ? chapterId : "";
  if (sessionAnchorChapterId !== normalizedChapterId) {
    return null;
  }

  return {
    ...sessionAnchor,
  };
}

export function clearSessionAnchor() {
  sessionAnchor = null;
  sessionAnchorChapterId = "";
}

export function resetEditorScrollSessionForTests() {
  userScrollGeneration = 0;
  sessionAnchor = null;
  sessionAnchorChapterId = "";
}
