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
  const container = document.querySelector(".translate-main-scroll");
  if (!(container instanceof HTMLElement) || !(source instanceof Element)) {
    return null;
  }

  const containerRect = container.getBoundingClientRect();
  const toggle = source.closest("[data-editor-language-toggle]");
  if (toggle instanceof HTMLElement) {
    const toggleRect = toggle.getBoundingClientRect();
    pendingTranslateAnchor = {
      type: "language-toggle",
      rowId: toggle.dataset.rowId ?? "",
      languageCode: toggle.dataset.languageCode ?? "",
      offsetTop: toggleRect.top - containerRect.top,
    };
    return pendingTranslateAnchor;
  }

  const field = source.closest("[data-editor-row-field]");
  if (field instanceof HTMLElement) {
    const fieldRect = field.getBoundingClientRect();
    pendingTranslateAnchor = {
      type: "field",
      rowId: field.dataset.rowId ?? "",
      languageCode: field.dataset.languageCode ?? "",
      offsetTop: fieldRect.top - containerRect.top,
    };
    return pendingTranslateAnchor;
  }

  const row = source.closest("[data-editor-row-card]");
  if (row instanceof HTMLElement) {
    const rowRect = row.getBoundingClientRect();
    pendingTranslateAnchor = {
      type: "row",
      rowId: row.dataset.rowId ?? "",
      languageCode: "",
      offsetTop: rowRect.top - containerRect.top,
    };
    return pendingTranslateAnchor;
  }

  pendingTranslateAnchor = null;
  return null;
}

export function restoreTranslateRowAnchor(snapshot) {
  if (!snapshot?.rowId) {
    pendingTranslateAnchor = null;
    return;
  }

  const container = document.querySelector(".translate-main-scroll");
  if (!(container instanceof HTMLElement)) {
    return;
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
  }

  if (!(anchor instanceof HTMLElement)) {
    anchor = document.querySelector(`[data-editor-row-card][data-row-id="${CSS.escape(snapshot.rowId)}"]`);
  }

  if (!(anchor instanceof HTMLElement)) {
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const currentOffsetTop = anchorRect.top - containerRect.top;
  container.scrollTop += currentOffsetTop - snapshot.offsetTop;
  pendingTranslateAnchor = null;
}

export function pendingTranslateAnchorRowId() {
  return typeof pendingTranslateAnchor?.rowId === "string" && pendingTranslateAnchor.rowId
    ? pendingTranslateAnchor.rowId
    : "";
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
