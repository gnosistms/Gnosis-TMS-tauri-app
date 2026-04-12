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
let glossaryTooltipElement = null;

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

function shouldFocusEditorSearch(event) {
  if (event.defaultPrevented || event.repeat || event.isComposing) {
    return false;
  }

  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  if (key !== "f" || event.shiftKey || event.altKey) {
    return false;
  }

  if (navigator.platform.includes("Mac")) {
    return event.metaKey && !event.ctrlKey;
  }

  return event.ctrlKey && !event.metaKey;
}

function focusEditorSearchInput(selectContents = false) {
  const input = document.querySelector("[data-editor-search-input]");
  if (!(input instanceof HTMLInputElement)) {
    return false;
  }

  input.focus({ preventScroll: true });
  if (selectContents) {
    input.select();
  }
  return true;
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
    ? target.closest(
      "[data-editor-glossary-mark][data-editor-glossary-tooltip-payload], [data-editor-glossary-mark][data-editor-glossary-tooltip], [data-editor-glossary-mark][data-tooltip]",
    )
    : null;
}

function ensureGlossaryTooltipElement() {
  if (glossaryTooltipElement instanceof HTMLElement && glossaryTooltipElement.isConnected) {
    return glossaryTooltipElement;
  }

  const tooltip = document.createElement("div");
  tooltip.className = "editor-glossary-tooltip";
  tooltip.setAttribute("aria-hidden", "true");
  tooltip.hidden = true;

  const body = document.createElement("div");
  body.className = "editor-glossary-tooltip__body";
  tooltip.append(body);

  document.body.append(tooltip);
  glossaryTooltipElement = tooltip;
  return tooltip;
}

function glossaryTooltipBodyElement() {
  const tooltip = ensureGlossaryTooltipElement();
  return tooltip.querySelector(".editor-glossary-tooltip__body");
}

function glossaryTooltipText(mark) {
  if (typeof mark?.dataset?.editorGlossaryTooltip === "string") {
    const explicitTooltip = mark.dataset.editorGlossaryTooltip.trim();
    if (explicitTooltip) {
      return explicitTooltip;
    }
  }

  return typeof mark?.dataset?.tooltip === "string"
    ? mark.dataset.tooltip.trim()
    : "";
}

function glossaryTooltipPayload(mark) {
  if (typeof mark?.dataset?.editorGlossaryTooltipPayload !== "string") {
    return null;
  }

  try {
    const payload = JSON.parse(mark.dataset.editorGlossaryTooltipPayload);
    if (payload?.kind !== "source" && payload?.kind !== "target") {
      return null;
    }

    const title = typeof payload.title === "string" ? payload.title.trim() : "";
    const variants = Array.isArray(payload.variants)
      ? payload.variants.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [];
    const translatorNotes = Array.isArray(payload.translatorNotes)
      ? payload.translatorNotes.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [];
    const footnotes = Array.isArray(payload.footnotes)
      ? payload.footnotes.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [];
    if (!title && variants.length === 0 && translatorNotes.length === 0 && footnotes.length === 0) {
      return null;
    }

    return {
      kind: payload.kind,
      title,
      variants,
      translatorNotes,
      footnotes,
    };
  } catch {
    return null;
  }
}

function renderStructuredGlossaryTooltipBody(body, payload) {
  body.replaceChildren();
  body.classList.add("editor-glossary-info-card");

  if (payload.title) {
    const title = document.createElement("p");
    title.className = "editor-glossary-info-card__title";
    title.textContent = payload.title;
    body.append(title);
  }

  if (payload.variants.length > 0) {
    const variants = document.createElement("p");
    variants.className = "editor-glossary-info-card__variants";
    variants.textContent = payload.variants.join(", ");
    body.append(variants);
  }

  const translatorNotes = Array.isArray(payload.translatorNotes) ? payload.translatorNotes : [];
  const footnotes = Array.isArray(payload.footnotes) ? payload.footnotes : [];
  if (translatorNotes.length > 0 || footnotes.length > 0) {
    const comments = document.createElement("div");
    comments.className = "editor-glossary-info-card__comments";
    for (const note of translatorNotes) {
      const comment = String(note ?? "").trim();
      if (!comment) {
        continue;
      }

      const paragraph = document.createElement("p");
      paragraph.className = "editor-glossary-info-card__comment";
      paragraph.textContent = comment;
      comments.append(paragraph);
    }
    for (const footnote of footnotes) {
      const text = String(footnote ?? "").trim();
      if (!text) {
        continue;
      }

      const paragraph = document.createElement("p");
      paragraph.className = "editor-glossary-info-card__comment editor-glossary-info-card__footnote";
      paragraph.textContent = text;
      comments.append(paragraph);
    }

    if (comments.childElementCount > 0) {
      body.append(comments);
    }
  }
}

function setActiveGlossaryTooltipPointer(clientX, clientY) {
  if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
    activeGlossaryTooltipPointer = { clientX, clientY };
    return;
  }

  activeGlossaryTooltipPointer = null;
}

function glossaryTooltipMarkAtActivePointer() {
  const clientX = activeGlossaryTooltipPointer?.clientX;
  const clientY = activeGlossaryTooltipPointer?.clientY;
  if (
    !Number.isFinite(clientX)
    || !Number.isFinite(clientY)
    || typeof document.elementFromPoint !== "function"
  ) {
    return null;
  }

  const boundedClientX = Math.min(Math.max(0, clientX), Math.max(0, window.innerWidth - 1));
  const boundedClientY = Math.min(Math.max(0, clientY), Math.max(0, window.innerHeight - 1));
  return glossaryTooltipMark(document.elementFromPoint(boundedClientX, boundedClientY));
}

function hideGlossaryTooltip() {
  if (!(glossaryTooltipElement instanceof HTMLElement)) {
    return;
  }

  glossaryTooltipElement.hidden = true;
  glossaryTooltipElement.classList.remove("is-visible");
}

function updateGlossaryTooltipPlacement(mark) {
  if (!(mark instanceof HTMLElement) || !mark.isConnected) {
    hideGlossaryTooltip();
    return;
  }

  const tooltipPayload = glossaryTooltipPayload(mark);
  const tooltipText = glossaryTooltipText(mark);
  if (!tooltipPayload && !tooltipText) {
    hideGlossaryTooltip();
    return;
  }

  const tooltip = ensureGlossaryTooltipElement();
  const body = glossaryTooltipBodyElement();
  if (!(body instanceof HTMLElement)) {
    hideGlossaryTooltip();
    return;
  }

  if (tooltipPayload?.kind === "source" || tooltipPayload?.kind === "target") {
    tooltip.classList.add("editor-glossary-tooltip--structured");
    renderStructuredGlossaryTooltipBody(body, tooltipPayload);
  } else {
    tooltip.classList.remove("editor-glossary-tooltip--structured");
    body.classList.remove("editor-glossary-info-card");
    body.textContent = tooltipText;
  }
  tooltip.hidden = false;
  tooltip.classList.add("is-visible");
  const markRect = mark.getBoundingClientRect();
  const anchorClientX = Number.isFinite(activeGlossaryTooltipPointer?.clientX)
    ? activeGlossaryTooltipPointer.clientX
    : markRect.left;
  const anchorClientY = Number.isFinite(activeGlossaryTooltipPointer?.clientY)
    ? activeGlossaryTooltipPointer.clientY
    : markRect.top;
  const offsetHeight = tooltip.offsetHeight;
  const offsetWidth = tooltip.offsetWidth;
  const gap = 14;
  const left = Math.min(
    Math.max(gap, Math.round(anchorClientX + gap)),
    Math.max(gap, window.innerWidth - offsetWidth - gap),
  );
  const top = Math.max(gap, Math.round(anchorClientY - offsetHeight - gap));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function scheduleActiveGlossaryTooltipPlacementUpdate() {
  if (glossaryTooltipPlacementFrameId || !(activeGlossaryTooltipMark instanceof HTMLElement)) {
    return;
  }

  glossaryTooltipPlacementFrameId = window.requestAnimationFrame(() => {
    glossaryTooltipPlacementFrameId = 0;
    const hoveredMark = glossaryTooltipMarkAtActivePointer();
    if (hoveredMark && hoveredMark !== activeGlossaryTooltipMark) {
      activateGlossaryTooltipMark(hoveredMark);
      return;
    }

    if (!hoveredMark && activeGlossaryTooltipPointer) {
      deactivateGlossaryTooltipMark();
      return;
    }

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

  hideGlossaryTooltip();

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
    if (shouldFocusEditorSearch(event)) {
      if (focusEditorSearchInput(true)) {
        event.preventDefault();
      }
      return;
    }

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

    if (event.target instanceof Element && event.target.closest("[data-editor-search-case-toggle]")) {
      event.preventDefault();
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
