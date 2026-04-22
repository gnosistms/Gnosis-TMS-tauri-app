import { syncEditorRowTextareaHeights } from "./autosize.js";
import { renderTranslationContentRow } from "./editor-row-render.js";
import { buildEditorScreenViewModel } from "./editor-screen-model.js";
import { buildEditorFieldSelector } from "./editor-utils.js";
import { notifyEditorRowsChanged } from "./editor-virtualization.js";

function isMountedEditorElement(value) {
  return typeof HTMLElement !== "undefined" && value instanceof HTMLElement;
}

function normalizeEditorRowIds(rowIds) {
  if (!Array.isArray(rowIds) || rowIds.length === 0) {
    return [];
  }

  const normalizedRowIds = [];
  const seen = new Set();
  rowIds.forEach((rowId) => {
    const normalizedRowId =
      typeof rowId === "string" && rowId.trim()
        ? rowId.trim()
        : "";
    if (!normalizedRowId || seen.has(normalizedRowId)) {
      return;
    }

    seen.add(normalizedRowId);
    normalizedRowIds.push(normalizedRowId);
  });

  return normalizedRowIds;
}

function readVisibleMountedEditorRowIds(root) {
  if (!isMountedEditorElement(root)) {
    return [];
  }

  return [...root.querySelectorAll("[data-editor-row-card]")]
    .map((element) => element.dataset.rowId ?? "")
    .filter(Boolean);
}

function resolveMountedEditorRowCard(root, rowId) {
  if (
    !isMountedEditorElement(root)
    || typeof rowId !== "string"
    || !rowId
    || typeof CSS === "undefined"
    || typeof CSS.escape !== "function"
  ) {
    return null;
  }

  const rowCard = root.querySelector(
    `[data-editor-row-card][data-row-id="${CSS.escape(rowId)}"]`,
  );
  return isMountedEditorElement(rowCard) ? rowCard : null;
}

function captureFocusedEditorField(root, patchedRowIds) {
  if (!isMountedEditorElement(root) || !(patchedRowIds instanceof Set) || patchedRowIds.size === 0) {
    return null;
  }

  const activeElement = root.ownerDocument?.activeElement;
  if (
    typeof HTMLTextAreaElement === "undefined"
    || !(activeElement instanceof HTMLTextAreaElement)
    || !activeElement.matches("[data-editor-row-field]")
  ) {
    return null;
  }

  const activeRowId = activeElement.dataset.rowId ?? "";
  if (!patchedRowIds.has(activeRowId)) {
    return null;
  }

  return {
    rowId: activeRowId,
    languageCode: activeElement.dataset.languageCode ?? "",
    contentKind:
      activeElement.dataset.contentKind === "footnote"
        ? "footnote"
        : activeElement.dataset.contentKind === "image-caption"
          ? "image-caption"
          : "field",
    selectionStart: activeElement.selectionStart,
    selectionEnd: activeElement.selectionEnd,
    selectionDirection: activeElement.selectionDirection ?? "none",
  };
}

function restoreFocusedEditorField(root, snapshot) {
  if (!isMountedEditorElement(root) || !snapshot?.rowId || !snapshot.languageCode) {
    return false;
  }

  const selector = buildEditorFieldSelector(
    snapshot.rowId,
    snapshot.languageCode,
    snapshot.contentKind,
  );
  const nextField = root.querySelector(selector);
  if (typeof HTMLTextAreaElement === "undefined" || !(nextField instanceof HTMLTextAreaElement)) {
    return false;
  }

  nextField.focus({ preventScroll: true });
  if (typeof snapshot.selectionStart === "number" && typeof snapshot.selectionEnd === "number") {
    nextField.setSelectionRange(
      snapshot.selectionStart,
      snapshot.selectionEnd,
      snapshot.selectionDirection,
    );
  }

  return true;
}

function buildPatchedEditorRowCard(root, row, rowIndex, viewModel) {
  if (!isMountedEditorElement(root) || !row?.id) {
    return null;
  }

  const ownerDocument = root.ownerDocument ?? globalThis.document;
  if (!ownerDocument?.createElement) {
    return null;
  }

  const template = ownerDocument.createElement("template");
  template.innerHTML = renderTranslationContentRow(
    row,
    viewModel.collapsedLanguageCodes,
    rowIndex,
    viewModel.editorReplace,
    viewModel.editorChapter,
  ).trim();
  const nextRowCard = template.content.firstElementChild;
  return isMountedEditorElement(nextRowCard) ? nextRowCard : null;
}

export function patchMountedEditorRows(root, appState, rowIds, options = {}) {
  if (!isMountedEditorElement(root)) {
    return {
      patchedVisible: false,
      patchedRowIds: [],
      visibleRowIds: [],
    };
  }

  const normalizedRowIds = normalizeEditorRowIds(rowIds);
  if (normalizedRowIds.length === 0) {
    return {
      patchedVisible: false,
      patchedRowIds: [],
      visibleRowIds: readVisibleMountedEditorRowIds(root),
    };
  }

  const viewModel = buildEditorScreenViewModel(appState);
  const rowEntriesById = new Map(
    viewModel.contentRows
      .map((row, index) => ({ row, rowIndex: index }))
      .filter((entry) => entry.row?.kind === "row" && entry.row?.id)
      .map((entry) => [entry.row.id, entry]),
  );
  const patchedRowIdSet = new Set(normalizedRowIds);
  const focusSnapshot = captureFocusedEditorField(root, patchedRowIdSet);
  const patchedRowIds = [];

  normalizedRowIds.forEach((rowId) => {
    const currentRowCard = resolveMountedEditorRowCard(root, rowId);
    const rowEntry = rowEntriesById.get(rowId) ?? null;
    if (!isMountedEditorElement(currentRowCard) || !rowEntry?.row) {
      return;
    }

    const nextRowCard = buildPatchedEditorRowCard(root, rowEntry.row, rowEntry.rowIndex, viewModel);
    if (!isMountedEditorElement(nextRowCard)) {
      return;
    }

    currentRowCard.replaceWith(nextRowCard);
    syncEditorRowTextareaHeights(nextRowCard);
    patchedRowIds.push(rowId);
  });

  if (patchedRowIds.length === 0) {
    return {
      patchedVisible: false,
      patchedRowIds: [],
      visibleRowIds: readVisibleMountedEditorRowIds(root),
    };
  }

  restoreFocusedEditorField(root, focusSnapshot);
  notifyEditorRowsChanged(patchedRowIds, {
    reason:
      typeof options?.reason === "string" && options.reason.trim()
        ? options.reason.trim()
        : "row-patch",
  });

  return {
    patchedVisible: true,
    patchedRowIds,
    visibleRowIds: readVisibleMountedEditorRowIds(root),
  };
}

export function patchMountedEditorRow(root, appState, rowId, options = {}) {
  return patchMountedEditorRows(root, appState, [rowId], options);
}
