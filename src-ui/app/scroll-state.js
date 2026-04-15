let lockedScreen = null;
let lockedSnapshot = null;
let pendingTranslateAnchor = null;

function captureElementScroll(selector) {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    return null;
  }

  return {
    top: element.scrollTop,
    left: element.scrollLeft,
  };
}

function restoreElementScroll(selector, snapshot) {
  if (!snapshot) {
    return;
  }

  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    return;
  }

  element.scrollTop = snapshot.top;
  element.scrollLeft = snapshot.left;
}

function captureTranslateScrollState() {
  return {
    main: captureElementScroll(".translate-main-scroll"),
    sidebar: captureElementScroll(".translate-sidebar-scroll"),
  };
}

function restoreTranslateScrollState(snapshot) {
  restoreElementScroll(".translate-main-scroll", snapshot.main);
  restoreElementScroll(".translate-sidebar-scroll", snapshot.sidebar);
}

export function captureTranslateRowAnchor(target = null) {
  const source = target instanceof Element ? target : document.activeElement;
  const snapshot = resolveTranslateRowAnchor(source);
  pendingTranslateAnchor = snapshot;
  return snapshot;
}

export function resolveTranslateRowAnchor(target = null) {
  const source = target instanceof Element ? target : document.activeElement;
  const container = document.querySelector(".translate-main-scroll");
  if (!(container instanceof HTMLElement) || !(source instanceof Element)) {
    return null;
  }

  const containerRect = container.getBoundingClientRect();
  const toggle = source.closest("[data-editor-language-toggle]");
  if (toggle instanceof HTMLElement) {
    const toggleRect = toggle.getBoundingClientRect();
    return {
      type: "language-toggle",
      rowId: toggle.dataset.rowId ?? "",
      languageCode: toggle.dataset.languageCode ?? "",
      offsetTop: toggleRect.top - containerRect.top,
    };
  }

  const field = source.closest("[data-editor-row-field]");
  if (field instanceof HTMLElement) {
    const fieldRect = field.getBoundingClientRect();
    return {
      type: "field",
      rowId: field.dataset.rowId ?? "",
      languageCode: field.dataset.languageCode ?? "",
      offsetTop: fieldRect.top - containerRect.top,
    };
  }

  const row = source.closest("[data-editor-row-card]");
  if (row instanceof HTMLElement) {
    const rowRect = row.getBoundingClientRect();
    return {
      type: "row",
      rowId: row.dataset.rowId ?? "",
      languageCode: "",
      offsetTop: rowRect.top - containerRect.top,
    };
  }

  const deletedGroup = source.closest("[data-editor-deleted-group]");
  if (deletedGroup instanceof HTMLElement) {
    const deletedGroupRect = deletedGroup.getBoundingClientRect();
    return {
      type: "deleted-group",
      rowId: deletedGroup.dataset.rowId ?? "",
      languageCode: "",
      offsetTop: deletedGroupRect.top - containerRect.top,
    };
  }

  return null;
}

export function restoreTranslateRowAnchor(snapshot) {
  if (!snapshot?.rowId) {
    pendingTranslateAnchor = null;
    return false;
  }

  const container = document.querySelector(".translate-main-scroll");
  if (!(container instanceof HTMLElement)) {
    return false;
  }

  let anchor = null;
  if (snapshot.type === "language-toggle" && snapshot.languageCode) {
    anchor = document.querySelector(
      `[data-editor-language-toggle][data-row-id="${CSS.escape(snapshot.rowId)}"][data-language-code="${CSS.escape(snapshot.languageCode)}"]`,
    );
  } else if (snapshot.type === "field" && snapshot.languageCode) {
    anchor = document.querySelector(
      `[data-editor-row-field][data-row-id="${CSS.escape(snapshot.rowId)}"][data-language-code="${CSS.escape(snapshot.languageCode)}"]`,
    );
  } else if (snapshot.type === "deleted-group") {
    anchor = document.querySelector(`[data-editor-deleted-group][data-row-id="${CSS.escape(snapshot.rowId)}"]`);
  }

  if (!(anchor instanceof HTMLElement)) {
    anchor = document.querySelector(`[data-editor-row-card][data-row-id="${CSS.escape(snapshot.rowId)}"]`);
  }

  if (!(anchor instanceof HTMLElement)) {
    pendingTranslateAnchor = null;
    return false;
  }

  const containerRect = container.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const currentOffsetTop = anchorRect.top - containerRect.top;
  const scrollDelta = currentOffsetTop - snapshot.offsetTop;
  if (!Number.isFinite(scrollDelta) || Math.abs(scrollDelta) < 1) {
    pendingTranslateAnchor = null;
    return false;
  }

  container.scrollTop += scrollDelta;
  pendingTranslateAnchor = null;
  return true;
}

export function centerTranslateRowInView(rowId) {
  if (typeof rowId !== "string" || !rowId.trim()) {
    pendingTranslateAnchor = null;
    return false;
  }

  const container = document.querySelector(".translate-main-scroll");
  if (!(container instanceof HTMLElement)) {
    pendingTranslateAnchor = null;
    return false;
  }

  let row = document.querySelector(`[data-editor-row-card][data-row-id="${CSS.escape(rowId)}"]`);
  if (!(row instanceof HTMLElement)) {
    row = document.querySelector(`[data-editor-deleted-group][data-row-id="${CSS.escape(rowId)}"]`);
  }
  if (!(row instanceof HTMLElement)) {
    pendingTranslateAnchor = null;
    return false;
  }

  const containerRect = container.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const currentOffsetTop = rowRect.top - containerRect.top;
  const desiredOffsetTop = Math.max(0, (container.clientHeight - rowRect.height) / 2);
  const scrollDelta = currentOffsetTop - desiredOffsetTop;
  if (!Number.isFinite(scrollDelta) || Math.abs(scrollDelta) < 1) {
    pendingTranslateAnchor = null;
    return false;
  }

  container.scrollTop += scrollDelta;
  pendingTranslateAnchor = null;
  return true;
}

export function pendingTranslateAnchorRowId() {
  return typeof pendingTranslateAnchor?.rowId === "string" && pendingTranslateAnchor.rowId
    ? pendingTranslateAnchor.rowId
    : "";
}

export function queueTranslateRowAnchor(snapshot) {
  if (!snapshot || typeof snapshot.rowId !== "string" || !snapshot.rowId.trim()) {
    pendingTranslateAnchor = null;
    return;
  }

  pendingTranslateAnchor = {
    rowId: snapshot.rowId.trim(),
    languageCode:
      typeof snapshot.languageCode === "string" && snapshot.languageCode.trim()
        ? snapshot.languageCode.trim()
        : null,
    offsetTop: Number.isFinite(Number(snapshot.offsetTop)) && Number(snapshot.offsetTop) >= 0
      ? Number(snapshot.offsetTop)
      : 0,
    type:
      snapshot.type === "field"
      || snapshot.type === "row"
      || snapshot.type === "deleted-group"
      || snapshot.type === "language-toggle"
        ? snapshot.type
        : "language-toggle",
  };
}

export function captureVisibleTranslateLocation() {
  const container = document.querySelector(".translate-main-scroll");
  if (!(container instanceof HTMLElement)) {
    return null;
  }

  const containerRect = container.getBoundingClientRect();
  const panels = [...document.querySelectorAll("[data-editor-language-panel]")].filter(
    (element) => element instanceof HTMLElement,
  );
  const visiblePanels = panels
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.bottom > containerRect.top && rect.top < containerRect.bottom)
    .sort((left, right) => left.rect.top - right.rect.top);

  const panelCandidate = visiblePanels.find(({ rect }) => rect.bottom > containerRect.top) ?? visiblePanels[0] ?? null;
  if (panelCandidate?.element instanceof HTMLElement) {
    return {
      rowId: panelCandidate.element.dataset.rowId ?? "",
      languageCode: panelCandidate.element.dataset.languageCode ?? null,
      offsetTop: Math.max(0, panelCandidate.rect.top - containerRect.top),
    };
  }

  const rows = [...document.querySelectorAll("[data-editor-row-card]")].filter(
    (element) => element instanceof HTMLElement,
  );
  const visibleRows = rows
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.bottom > containerRect.top && rect.top < containerRect.bottom)
    .sort((left, right) => left.rect.top - right.rect.top);
  const rowCandidate = visibleRows.find(({ rect }) => rect.bottom > containerRect.top) ?? visibleRows[0] ?? null;
  if (rowCandidate?.element instanceof HTMLElement) {
    return {
      rowId: rowCandidate.element.dataset.rowId ?? "",
      languageCode: null,
      offsetTop: Math.max(0, rowCandidate.rect.top - containerRect.top),
    };
  }

  return null;
}

export function captureRenderScrollSnapshot(screen) {
  if (screen === "translate") {
    return lockedScreen === screen && lockedSnapshot
      ? lockedSnapshot
      : captureTranslateScrollState();
  }

  return captureElementScroll(".page-body");
}

export function restoreRenderScrollSnapshot(previousScreen, nextScreen, snapshot) {
  if (!snapshot || previousScreen !== nextScreen) {
    return;
  }

  if (nextScreen === "translate") {
    restoreTranslateScrollState(snapshot);
    return;
  }

  restoreElementScroll(".page-body", snapshot);
}

export function lockScreenScrollSnapshot(screen) {
  lockedScreen = screen;
  lockedSnapshot = captureRenderScrollSnapshot(screen);
}

export function unlockScreenScrollSnapshot(screen = null) {
  if (screen !== null && lockedScreen !== screen) {
    return;
  }

  lockedScreen = null;
  lockedSnapshot = null;
}
