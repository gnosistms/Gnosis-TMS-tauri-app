let activeTargetLanguageManagerDrag = null;

function parseGlossaryTermVariantIndex(value) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function findTargetLanguageManagerRow(target) {
  return target instanceof Element
    ? target.closest("[data-target-language-manager-row]")
    : null;
}

function clearTargetLanguageManagerDragClasses() {
  document
    .querySelectorAll(".term-variant-row.is-dragging, .term-variant-row.is-drop-before, .term-variant-row.is-drop-after")
    .forEach((row) => {
      row.classList.remove("is-dragging", "is-drop-before", "is-drop-after");
    });
}

function targetLanguageManagerRowFromPoint(clientX, clientY) {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return null;
  }

  return findTargetLanguageManagerRow(document.elementFromPoint(clientX, clientY));
}

function targetLanguageManagerDropPosition(row, event) {
  const targetIndex = parseGlossaryTermVariantIndex(row?.dataset.languageIndex);
  if (targetIndex === null) {
    return null;
  }

  const rect = row.getBoundingClientRect();
  const insertAfter = event.clientY > rect.top + rect.height / 2;
  return {
    targetIndex,
    rawInsertionIndex: insertAfter ? targetIndex + 1 : targetIndex,
    insertAfter,
  };
}

function releaseTargetLanguageManagerPointerCapture() {
  const handle = activeTargetLanguageManagerDrag?.handle;
  const pointerId = activeTargetLanguageManagerDrag?.pointerId;
  if (!handle || !Number.isInteger(pointerId) || typeof handle.releasePointerCapture !== "function") {
    return;
  }

  try {
    handle.releasePointerCapture(pointerId);
  } catch {
    // Ignore capture release failures when the pointer is already gone.
  }
}

function createTargetLanguageManagerPreview(row) {
  if (!(row instanceof HTMLElement)) {
    return null;
  }

  const preview = row.cloneNode(true);
  if (!(preview instanceof HTMLElement)) {
    return null;
  }

  preview.classList.remove("is-dragging", "is-drop-before", "is-drop-after");
  preview.classList.add("term-variant-row-preview");
  preview.setAttribute("aria-hidden", "true");
  preview
    .querySelectorAll("[data-target-language-manager-row], [data-target-language-manager-handle], [data-action]")
    .forEach((element) => {
      element.removeAttribute("data-target-language-manager-row");
      element.removeAttribute("data-target-language-manager-handle");
      element.removeAttribute("data-action");
    });

  return preview;
}

function updateTargetLanguageManagerPreviewPosition(clientX, clientY) {
  const preview = activeTargetLanguageManagerDrag?.preview;
  if (!(preview instanceof HTMLElement)) {
    return;
  }

  const offsetX = activeTargetLanguageManagerDrag?.previewOffsetX ?? 0;
  const offsetY = activeTargetLanguageManagerDrag?.previewOffsetY ?? 0;
  preview.style.transform = `translate(${Math.round(clientX - offsetX)}px, ${Math.round(clientY - offsetY)}px)`;
}

function destroyTargetLanguageManagerPreview() {
  const preview = activeTargetLanguageManagerDrag?.preview;
  if (preview instanceof HTMLElement) {
    preview.remove();
  }
}

function startTargetLanguageManagerDrag(event) {
  const handle = event.target instanceof Element
    ? event.target.closest("[data-target-language-manager-handle]")
    : null;
  if (!handle) {
    return;
  }

  const row = findTargetLanguageManagerRow(handle);
  const index = parseGlossaryTermVariantIndex(row?.dataset.languageIndex);
  if (!row || index === null) {
    return;
  }

  event.preventDefault();
  const rowRect = row.getBoundingClientRect();
  const preview = createTargetLanguageManagerPreview(row);
  if (preview) {
    preview.style.width = `${Math.round(rowRect.width)}px`;
    preview.style.height = `${Math.round(rowRect.height)}px`;
    document.body.append(preview);
  }

  clearTargetLanguageManagerDragClasses();
  row.classList.add("is-dragging");
  activeTargetLanguageManagerDrag = {
    handle,
    pointerId: event.pointerId,
    index,
    row,
    preview,
    previewOffsetX: event.clientX - rowRect.left,
    previewOffsetY: event.clientY - rowRect.top,
  };
  updateTargetLanguageManagerPreviewPosition(event.clientX, event.clientY);

  if (typeof handle.setPointerCapture === "function") {
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Ignore capture failures and fall back to document-level pointer tracking.
    }
  }
}

function updateTargetLanguageManagerDrag(event) {
  if (!activeTargetLanguageManagerDrag || event.pointerId !== activeTargetLanguageManagerDrag.pointerId) {
    return;
  }

  event.preventDefault();
  updateTargetLanguageManagerPreviewPosition(event.clientX, event.clientY);
  clearTargetLanguageManagerDragClasses();
  activeTargetLanguageManagerDrag.row.classList.add("is-dragging");

  const row = targetLanguageManagerRowFromPoint(event.clientX, event.clientY);
  const position = row ? targetLanguageManagerDropPosition(row, event) : null;
  if (
    !row
    || !position
    || position.rawInsertionIndex === activeTargetLanguageManagerDrag.index
    || position.rawInsertionIndex === activeTargetLanguageManagerDrag.index + 1
  ) {
    return;
  }

  row.classList.add(position.insertAfter ? "is-drop-after" : "is-drop-before");
}

async function finishTargetLanguageManagerDrag(event, dispatchAction) {
  if (!activeTargetLanguageManagerDrag || event.pointerId !== activeTargetLanguageManagerDrag.pointerId) {
    return;
  }

  event.preventDefault();
  const drag = activeTargetLanguageManagerDrag;
  const row = targetLanguageManagerRowFromPoint(event.clientX, event.clientY);
  const position = row ? targetLanguageManagerDropPosition(row, event) : null;
  releaseTargetLanguageManagerPointerCapture();
  destroyTargetLanguageManagerPreview();
  activeTargetLanguageManagerDrag = null;
  clearTargetLanguageManagerDragClasses();

  if (
    !row
    || !position
    || position.rawInsertionIndex === drag.index
    || position.rawInsertionIndex === drag.index + 1
  ) {
    return;
  }

  await dispatchAction(
    `move-target-language-manager-language:${drag.index}:${position.rawInsertionIndex}`,
    event,
  );
}

function cancelTargetLanguageManagerDrag() {
  releaseTargetLanguageManagerPointerCapture();
  destroyTargetLanguageManagerPreview();
  activeTargetLanguageManagerDrag = null;
  clearTargetLanguageManagerDragClasses();
}

export {
  cancelTargetLanguageManagerDrag,
  finishTargetLanguageManagerDrag,
  startTargetLanguageManagerDrag,
  updateTargetLanguageManagerDrag,
};
