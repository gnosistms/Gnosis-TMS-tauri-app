let lockedScreen = null;
let lockedSnapshot = null;

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
