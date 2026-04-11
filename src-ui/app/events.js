import { handleInputEvent } from "./input-handlers.js";
import { handleNavigation, refreshCurrentScreen } from "./navigation.js";
import { createActionDispatcher } from "./action-dispatcher.js";
import { checkForAppUpdate } from "./updater-flow.js";
import { listen } from "./runtime.js";

const SYNC_WITH_SERVER_EVENT = "sync-with-server";
const CHECK_FOR_UPDATES_EVENT = "check-for-updates";
let activeGlossaryTermVariantDrag = null;
let activeGlossaryTooltipMark = null;
let activeGlossaryTooltipPointer = null;
let glossaryTooltipPlacementFrameId = 0;

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

function shouldBlurActiveEditorField(event) {
  if (event.defaultPrevented || event.repeat || event.isComposing) {
    return false;
  }

  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement) || !target.matches("[data-editor-row-field]")) {
    return false;
  }

  if (target.disabled || target.readOnly) {
    return false;
  }

  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  return key === "enter" && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
}

function focusEditorFieldFromGlossaryMark(event) {
  const mark = event.target instanceof Element
    ? event.target.closest("[data-editor-glossary-mark]")
    : null;
  if (!mark) {
    return false;
  }

  const fieldStack = mark.closest("[data-editor-glossary-field-stack]");
  const field = fieldStack?.querySelector("[data-editor-row-field]");
  if (!(field instanceof HTMLTextAreaElement)) {
    return false;
  }

  event.preventDefault();
  field.focus({ preventScroll: true });

  const start = Number.parseInt(mark.dataset.textStart ?? "", 10);
  const end = Number.parseInt(mark.dataset.textEnd ?? "", 10);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) {
    return true;
  }

  const rect = mark.getBoundingClientRect();
  const ratio =
    rect.width > 0
      ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
      : 1;
  const nextOffset = start + Math.round((end - start) * ratio);
  field.setSelectionRange(nextOffset, nextOffset, "none");
  return true;
}

function glossaryTooltipMark(target) {
  return target instanceof Element
    ? target.closest("[data-editor-glossary-mark][data-tooltip]")
    : null;
}

function glossaryTooltipBoundaryRect(mark) {
  const scrollContainer = mark.closest(".translate-main-scroll");
  if (scrollContainer instanceof HTMLElement) {
    return scrollContainer.getBoundingClientRect();
  }

  return {
    left: 0,
    right: window.innerWidth,
    top: 0,
    bottom: window.innerHeight,
  };
}

function setActiveGlossaryTooltipPointer(clientX, clientY) {
  if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
    activeGlossaryTooltipPointer = { clientX, clientY };
    return;
  }

  activeGlossaryTooltipPointer = null;
}

function glossaryTooltipAnchorPoint(mark) {
  const pointerClientX = activeGlossaryTooltipPointer?.clientX;
  const pointerClientY = activeGlossaryTooltipPointer?.clientY;
  if (Number.isFinite(pointerClientX) && Number.isFinite(pointerClientY)) {
    return {
      clientX: pointerClientX,
      clientY: pointerClientY,
    };
  }

  const markRect = mark.getBoundingClientRect();
  return {
    clientX: markRect.left + (markRect.width / 2),
    clientY: markRect.top + (markRect.height / 2),
  };
}

function updateGlossaryTooltipPlacement(mark) {
  if (!(mark instanceof HTMLElement) || !mark.isConnected) {
    return;
  }

  const boundaryRect = glossaryTooltipBoundaryRect(mark);
  const boundaryVerticalMidline = boundaryRect.top + ((boundaryRect.bottom - boundaryRect.top) / 2);
  const boundaryHorizontalMidline = boundaryRect.left + ((boundaryRect.right - boundaryRect.left) / 2);
  const anchorPoint = glossaryTooltipAnchorPoint(mark);
  const shouldPlaceBelow = anchorPoint.clientY < boundaryVerticalMidline;
  const shouldAlignStart = anchorPoint.clientX < boundaryHorizontalMidline;

  if (shouldPlaceBelow) {
    mark.dataset.tooltipSide = "bottom";
  } else {
    mark.removeAttribute("data-tooltip-side");
  }

  if (shouldAlignStart) {
    mark.dataset.tooltipAlign = "start";
    return;
  }

  mark.dataset.tooltipAlign = "end";
}

function scheduleActiveGlossaryTooltipPlacementUpdate() {
  if (glossaryTooltipPlacementFrameId || !(activeGlossaryTooltipMark instanceof HTMLElement)) {
    return;
  }

  glossaryTooltipPlacementFrameId = window.requestAnimationFrame(() => {
    glossaryTooltipPlacementFrameId = 0;
    if (!(activeGlossaryTooltipMark instanceof HTMLElement) || !activeGlossaryTooltipMark.isConnected) {
      activeGlossaryTooltipMark = null;
      return;
    }

    updateGlossaryTooltipPlacement(activeGlossaryTooltipMark);
  });
}

function activateGlossaryTooltipMark(mark) {
  if (!(mark instanceof HTMLElement)) {
    return;
  }

  activeGlossaryTooltipMark = mark;
  updateGlossaryTooltipPlacement(mark);
}

function deactivateGlossaryTooltipMark(mark = activeGlossaryTooltipMark) {
  if (glossaryTooltipPlacementFrameId) {
    window.cancelAnimationFrame(glossaryTooltipPlacementFrameId);
    glossaryTooltipPlacementFrameId = 0;
  }

  if (mark instanceof HTMLElement) {
    mark.removeAttribute("data-tooltip-side");
    mark.removeAttribute("data-tooltip-align");
  }

  if (!mark || activeGlossaryTooltipMark === mark) {
    activeGlossaryTooltipMark = null;
    activeGlossaryTooltipPointer = null;
  }
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
  if (sourceInput instanceof HTMLTextAreaElement && previewInput instanceof HTMLTextAreaElement) {
    previewInput.value = sourceInput.value;
    previewInput.style.height = sourceInput.style.height;
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
    if (shouldBlurActiveEditorField(event)) {
      event.preventDefault();
      event.target.blur();
      return;
    }

    if (!shouldTriggerSyncShortcut(event)) {
      return;
    }

    event.preventDefault();
    void refreshCurrentScreen(render);
  });

  document.addEventListener("mousedown", (event) => {
    focusEditorFieldFromGlossaryMark(event);
  });

  document.addEventListener("pointerover", (event) => {
    const mark = glossaryTooltipMark(event.target);
    if (!mark) {
      return;
    }

    setActiveGlossaryTooltipPointer(event.clientX, event.clientY);
    activateGlossaryTooltipMark(mark);
  });

  document.addEventListener("pointerout", (event) => {
    const mark = glossaryTooltipMark(event.target);
    if (!mark) {
      return;
    }

    const nextMark = glossaryTooltipMark(event.relatedTarget);
    if (nextMark === mark) {
      return;
    }

    deactivateGlossaryTooltipMark(mark);
  });

  document.addEventListener("scroll", () => {
    scheduleActiveGlossaryTooltipPlacementUpdate();
  }, true);

  window.addEventListener("resize", () => {
    scheduleActiveGlossaryTooltipPlacementUpdate();
  });

  document.addEventListener("click", async (event) => {
    const disabledControl = event.target.closest('[aria-disabled="true"], :disabled');
    if (disabledControl) {
      event.preventDefault();
      return;
    }

    if (event.target.closest("[data-stop-row-action]")) {
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

    const mark = glossaryTooltipMark(event.target);
    if (mark && activeGlossaryTooltipMark === mark) {
      setActiveGlossaryTooltipPointer(event.clientX, event.clientY);
      updateGlossaryTooltipPlacement(mark);
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
    deactivateGlossaryTooltipMark();
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
