import { handleInputEvent } from "./input-handlers.js";
import { handleNavigation, refreshCurrentScreen } from "./navigation.js";
import { createActionDispatcher } from "./action-dispatcher.js";
import { checkForAppUpdate } from "./updater-flow.js";
import { listen } from "./runtime.js";

const SYNC_WITH_SERVER_EVENT = "sync-with-server";
const CHECK_FOR_UPDATES_EVENT = "check-for-updates";
let activeGlossaryTermVariantDrag = null;

function shouldTriggerSyncShortcut(event) {
  if (event.defaultPrevented || event.repeat) {
    return false;
  }

  const target = event.target;
  if (
    target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target?.isContentEditable === true
  ) {
    return false;
  }

  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  if (navigator.platform.includes("Mac")) {
    return event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && key === "s";
  }

  return event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && key === "r";
}

function isGlossaryTermVariantSide(value) {
  return value === "source" || value === "target";
}

function parseGlossaryTermVariantIndex(value) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function findGlossaryTermVariantRow(target) {
  return target instanceof Element
    ? target.closest("[data-glossary-term-variant-row]")
    : null;
}

function clearGlossaryTermVariantDragClasses() {
  document
    .querySelectorAll(".term-variant-row.is-dragging, .term-variant-row.is-drop-before, .term-variant-row.is-drop-after")
    .forEach((row) => {
      row.classList.remove("is-dragging", "is-drop-before", "is-drop-after");
    });
}

function glossaryTermVariantRowFromPoint(clientX, clientY) {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return null;
  }

  return findGlossaryTermVariantRow(document.elementFromPoint(clientX, clientY));
}

function glossaryTermVariantDropPosition(row, event) {
  const targetIndex = parseGlossaryTermVariantIndex(row?.dataset.variantIndex);
  const side = row?.dataset.variantSide;
  if (targetIndex === null || !isGlossaryTermVariantSide(side)) {
    return null;
  }

  const rect = row.getBoundingClientRect();
  const insertAfter = event.clientY > rect.top + rect.height / 2;
  return {
    side,
    targetIndex,
    rawInsertionIndex: insertAfter ? targetIndex + 1 : targetIndex,
    insertAfter,
  };
}

function releaseGlossaryTermVariantPointerCapture() {
  const handle = activeGlossaryTermVariantDrag?.handle;
  const pointerId = activeGlossaryTermVariantDrag?.pointerId;
  if (!handle || !Number.isInteger(pointerId) || typeof handle.releasePointerCapture !== "function") {
    return;
  }

  try {
    handle.releasePointerCapture(pointerId);
  } catch {
    // Ignore capture release failures when the pointer is already gone.
  }
}

function createGlossaryTermVariantPreview(row) {
  if (!(row instanceof HTMLElement)) {
    return null;
  }

  const preview = row.cloneNode(true);
  if (!(preview instanceof HTMLElement)) {
    return null;
  }

  const sourceInput = row.querySelector("[data-glossary-term-variant-input]");
  const previewInput = preview.querySelector("[data-glossary-term-variant-input]");
  if (sourceInput instanceof HTMLInputElement && previewInput instanceof HTMLInputElement) {
    previewInput.value = sourceInput.value;
  }

  preview.classList.remove("is-dragging", "is-drop-before", "is-drop-after");
  preview.classList.add("term-variant-row-preview");
  preview.setAttribute("aria-hidden", "true");
  preview
    .querySelectorAll("[data-glossary-term-variant-row], [data-glossary-term-variant-input], [data-glossary-term-variant-handle], [data-action]")
    .forEach((element) => {
      element.removeAttribute("data-glossary-term-variant-row");
      element.removeAttribute("data-glossary-term-variant-input");
      element.removeAttribute("data-glossary-term-variant-handle");
      element.removeAttribute("data-action");
    });

  return preview;
}

function updateGlossaryTermVariantPreviewPosition(clientX, clientY) {
  const preview = activeGlossaryTermVariantDrag?.preview;
  if (!(preview instanceof HTMLElement)) {
    return;
  }

  const offsetX = activeGlossaryTermVariantDrag?.previewOffsetX ?? 0;
  const offsetY = activeGlossaryTermVariantDrag?.previewOffsetY ?? 0;
  preview.style.transform = `translate(${Math.round(clientX - offsetX)}px, ${Math.round(clientY - offsetY)}px)`;
}

function destroyGlossaryTermVariantPreview() {
  const preview = activeGlossaryTermVariantDrag?.preview;
  if (preview instanceof HTMLElement) {
    preview.remove();
  }
}

function startGlossaryTermVariantDrag(event) {
  const handle = event.target instanceof Element
    ? event.target.closest("[data-glossary-term-variant-handle]")
    : null;
  if (!handle) {
    return;
  }

  const row = findGlossaryTermVariantRow(handle);
  const side = row?.dataset.variantSide;
  const index = parseGlossaryTermVariantIndex(row?.dataset.variantIndex);
  if (!row || !isGlossaryTermVariantSide(side) || index === null) {
    return;
  }

  event.preventDefault();
  const rowRect = row.getBoundingClientRect();
  const preview = createGlossaryTermVariantPreview(row);
  if (preview) {
    preview.style.width = `${Math.round(rowRect.width)}px`;
    preview.style.height = `${Math.round(rowRect.height)}px`;
    document.body.append(preview);
  }

  clearGlossaryTermVariantDragClasses();
  row.classList.add("is-dragging");
  activeGlossaryTermVariantDrag = {
    handle,
    pointerId: event.pointerId,
    side,
    index,
    row,
    preview,
    previewOffsetX: event.clientX - rowRect.left,
    previewOffsetY: event.clientY - rowRect.top,
  };
  updateGlossaryTermVariantPreviewPosition(event.clientX, event.clientY);

  if (typeof handle.setPointerCapture === "function") {
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Ignore capture failures and fall back to document-level pointer tracking.
    }
  }
}

function updateGlossaryTermVariantDrag(event) {
  if (!activeGlossaryTermVariantDrag || event.pointerId !== activeGlossaryTermVariantDrag.pointerId) {
    return;
  }

  event.preventDefault();
  updateGlossaryTermVariantPreviewPosition(event.clientX, event.clientY);
  clearGlossaryTermVariantDragClasses();
  activeGlossaryTermVariantDrag.row.classList.add("is-dragging");

  const row = glossaryTermVariantRowFromPoint(event.clientX, event.clientY);
  const position = row ? glossaryTermVariantDropPosition(row, event) : null;
  if (
    !row
    || !position
    || position.side !== activeGlossaryTermVariantDrag.side
    || position.rawInsertionIndex === activeGlossaryTermVariantDrag.index
    || position.rawInsertionIndex === activeGlossaryTermVariantDrag.index + 1
  ) {
    return;
  }

  row.classList.add(position.insertAfter ? "is-drop-after" : "is-drop-before");
}

async function finishGlossaryTermVariantDrag(event, dispatchAction) {
  if (!activeGlossaryTermVariantDrag || event.pointerId !== activeGlossaryTermVariantDrag.pointerId) {
    return;
  }

  event.preventDefault();
  const drag = activeGlossaryTermVariantDrag;
  const row = glossaryTermVariantRowFromPoint(event.clientX, event.clientY);
  const position = row ? glossaryTermVariantDropPosition(row, event) : null;
  releaseGlossaryTermVariantPointerCapture();
  destroyGlossaryTermVariantPreview();
  activeGlossaryTermVariantDrag = null;
  clearGlossaryTermVariantDragClasses();

  if (
    !row
    || !position
    || position.side !== drag.side
    || position.rawInsertionIndex === drag.index
    || position.rawInsertionIndex === drag.index + 1
  ) {
    return;
  }

  await dispatchAction(
    `move-glossary-term-variant:${drag.side}:${drag.index}:${position.rawInsertionIndex}`,
    event,
  );
}

function cancelGlossaryTermVariantDrag() {
  releaseGlossaryTermVariantPointerCapture();
  destroyGlossaryTermVariantPreview();
  activeGlossaryTermVariantDrag = null;
  clearGlossaryTermVariantDragClasses();
}

export function registerAppEvents(render) {
  const dispatchAction = createActionDispatcher(render);

  document.addEventListener("input", (event) => handleInputEvent(event, render));
  document.addEventListener("change", (event) => handleInputEvent(event, render));
  document.addEventListener("keydown", (event) => {
    if (!shouldTriggerSyncShortcut(event)) {
      return;
    }

    event.preventDefault();
    void refreshCurrentScreen(render);
  });

  document.addEventListener("click", async (event) => {
    const disabledControl = event.target.closest('[aria-disabled="true"], :disabled');
    if (disabledControl) {
      event.preventDefault();
      return;
    }

    const navTarget = event.target.closest("[data-nav-target]")?.dataset.navTarget;
    if (navTarget) {
      handleNavigation(navTarget, render);
      return;
    }

    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) {
      return;
    }

    await dispatchAction(action, event);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!(event instanceof PointerEvent) || event.button !== 0) {
      return;
    }

    startGlossaryTermVariantDrag(event);
  });

  document.addEventListener("pointermove", (event) => {
    if (!(event instanceof PointerEvent)) {
      return;
    }

    updateGlossaryTermVariantDrag(event);
  });

  document.addEventListener("pointerup", (event) => {
    if (!(event instanceof PointerEvent)) {
      return;
    }

    void finishGlossaryTermVariantDrag(event, dispatchAction);
  });

  document.addEventListener("pointercancel", () => {
    cancelGlossaryTermVariantDrag();
  });

  window.addEventListener("blur", () => {
    cancelGlossaryTermVariantDrag();
  });

  if (listen) {
    void listen(SYNC_WITH_SERVER_EVENT, () => {
      void refreshCurrentScreen(render);
    });

    void listen(CHECK_FOR_UPDATES_EVENT, () => {
      void checkForAppUpdate(render, { silent: false });
    });
  }
}
