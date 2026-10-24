// Defers re-renders while the user is composing text with an input method
// (Vietnamese Telex, Chinese, Japanese, Korean...).
//
// A render replaces the focused field with a new element and restores focus
// and caret, but an input method's composition lives in the old element: it
// is cut off mid-word and the input method's next keystrokes edit text that
// no longer matches what it composed, so the typed word comes out scrambled.
// Search boxes render on every keystroke, so they broke on Windows Telex.
//
// Renders are deferred, never dropped: the held renders are merged (any full
// render makes the flush a full render) and flushed once the composition ends
// or the field loses focus. A safety timeout keeps a composition that never
// reports its end from stalling the screen.

const IME_RENDER_HOLD_SAFETY_MS = 15000;

let composingTarget = null;
let heldOptions = null;
let flushRender = null;
let safetyTimerId = 0;
let installed = false;

function isTextField(element) {
  return (
    (typeof HTMLInputElement === "function" && element instanceof HTMLInputElement)
    || (typeof HTMLTextAreaElement === "function" && element instanceof HTMLTextAreaElement)
  );
}

function mergeHeldOptions(held, next) {
  if (!held) {
    return { ...(next ?? {}) };
  }
  // Two different scoped renders (or any full one) flush as one full render.
  if (!held.scope || !next?.scope || held.scope !== next.scope) {
    return {};
  }
  return { ...held, ...next };
}

function clearSafetyTimer() {
  if (safetyTimerId) {
    clearTimeout(safetyTimerId);
    safetyTimerId = 0;
  }
}

export function flushImeHeldRender() {
  clearSafetyTimer();
  const options = heldOptions;
  heldOptions = null;
  if (options) {
    flushRender?.(options);
  }
}

/**
 * Called by the render entry point. Returns true when the render was deferred
 * (the caller should skip it).
 */
export function deferRenderWhileComposing(options = {}, doc = globalThis.document) {
  if (!composingTarget || doc?.activeElement !== composingTarget) {
    return false;
  }

  heldOptions = mergeHeldOptions(heldOptions, options);
  if (!safetyTimerId) {
    safetyTimerId = setTimeout(() => {
      safetyTimerId = 0;
      composingTarget = null;
      flushImeHeldRender();
    }, IME_RENDER_HOLD_SAFETY_MS);
  }
  return true;
}

export function installImeCompositionHold(render, doc = globalThis.document) {
  if (installed || !doc) {
    return;
  }
  installed = true;
  flushRender = render;
  doc.addEventListener("compositionstart", (event) => {
    if (isTextField(event.target)) {
      composingTarget = event.target;
    }
  }, true);
  doc.addEventListener("compositionend", (event) => {
    if (event.target !== composingTarget) {
      return;
    }
    composingTarget = null;
    // Some engines send the composed text's last input event after
    // compositionend; let it update state before the held render lands.
    setTimeout(flushImeHeldRender, 0);
  }, true);
  doc.addEventListener("focusout", (event) => {
    if (event.target !== composingTarget) {
      return;
    }
    composingTarget = null;
    flushImeHeldRender();
  }, true);
}

export function resetImeCompositionHoldForTests() {
  composingTarget = null;
  heldOptions = null;
  flushRender = null;
  installed = false;
  clearSafetyTimer();
}
