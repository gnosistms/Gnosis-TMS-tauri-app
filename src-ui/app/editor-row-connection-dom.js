import { editorRowViewportDirection } from "./editor-row-connection.js";
import {
  noteUserScrollIntent,
  readUserScrollGeneration,
  updateSessionAnchor,
} from "./editor-scroll-session.js";
import { captureVisibleTranslateRowLocation } from "./scroll-state.js";

export function createEditorRowConnectionController(root, appState, scrollContainer, geometry) {
  let frame = 0;
  let revealFrame = 0;
  let destroyed = false;
  const chapterId = appState.editorChapter?.chapterId;
  const rowElement = (rowId) => root.querySelector(
    `[data-editor-row-card][data-row-id="${CSS.escape(rowId)}"]`,
  );
  const mountedBounds = (rowId) => {
    const row = rowElement(rowId);
    if (!row) return null;
    const rect = row.getBoundingClientRect();
    const top = scrollContainer.getBoundingClientRect().top + scrollContainer.clientTop;
    return { start: rect.top - top + scrollContainer.scrollTop, end: rect.bottom - top + scrollContainer.scrollTop };
  };
  const boundsFor = (rowId) => mountedBounds(rowId) ?? geometry?.getRowBounds?.(rowId);
  const current = () => !destroyed && appState.screen === "translate"
    && appState.editorChapter?.chapterId === chapterId && scrollContainer.isConnected;

  function sync() {
    if (!current()) return;
    const rowId = appState.editorChapter.activeRowId;
    const languageCode = appState.editorChapter.activeLanguageCode;
    root.querySelectorAll('[data-editor-row-card].is-connected').forEach((row) => {
      if (row.dataset.rowId !== rowId) row.classList.remove("is-connected");
    });
    if (rowId) rowElement(rowId)?.classList.add("is-connected");
    root.querySelectorAll('[data-editor-language-panel].is-active').forEach((panel) => {
      if (panel.dataset.rowId !== rowId || panel.dataset.languageCode !== languageCode) {
        panel.classList.remove("is-active");
      }
    });
    if (rowId && languageCode) {
      rowElement(rowId)?.querySelector(
        `[data-editor-language-panel][data-language-code="${CSS.escape(languageCode)}"]`,
      )?.classList.add("is-active");
    }
    const notice = root.querySelector("[data-editor-row-connection]");
    if (!notice) return;
    const direction = rowId ? editorRowViewportDirection(boundsFor(rowId), {
      start: scrollContainer.scrollTop,
      end: scrollContainer.scrollTop + scrollContainer.clientHeight,
    }) : null;
    const offscreen = direction === "above" || direction === "below";
    if (offscreen) {
      const text = `Selected row is ${direction === "above" ? "above" : "below"} the visible area`;
      const label = notice.querySelector("[data-editor-row-connection-text]");
      if (label.textContent !== text) {
        label.textContent = text;
        notice.querySelector("[data-editor-row-connection-arrow]").textContent = direction === "above" ? "↑" : "↓";
      }
    }
    notice.hidden = !offscreen;
  }
  function schedule() {
    if (destroyed || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; sync(); });
  }
  function reveal() {
    if (!current()) return false;
    const rowId = appState.editorChapter.activeRowId;
    if (!rowId || !boundsFor(rowId)) return false;
    const notice = root.querySelector("[data-editor-row-connection]");
    const restoreFocus = document.activeElement === notice;
    const languageCode = appState.editorChapter.activeLanguageCode;
    noteUserScrollIntent("show-connected-row");
    const generation = readUserScrollGeneration();
    if (revealFrame) cancelAnimationFrame(revealFrame);
    const align = () => {
      const bounds = boundsFor(rowId);
      if (!bounds) return;
      scrollContainer.scrollTop = Math.max(0, bounds.start - Math.max(0,
        (scrollContainer.clientHeight - (bounds.end - bounds.start)) / 2));
      geometry?.renderRevealedRow?.();
      updateSessionAnchor(captureVisibleTranslateRowLocation(), chapterId);
      sync();
    };
    align();
    // Correct estimated height once after mounting. A newer user intent wins.
    revealFrame = requestAnimationFrame(() => {
      revealFrame = 0;
      if (!current() || appState.editorChapter.activeRowId !== rowId
        || readUserScrollGeneration() !== generation) return;
      align();
      if (restoreFocus && (document.activeElement === notice || document.activeElement === document.body)) {
        const row = rowElement(rowId);
        const field = row?.querySelector(`[data-language-code="${CSS.escape(languageCode ?? "")}"] [data-editor-display-field]`)
          ?? row?.querySelector("[data-editor-display-field], [data-editor-row-field], button");
        field?.focus({ preventScroll: true });
      }
    });
    return true;
  }
  const resize = new ResizeObserver(schedule);
  resize.observe(scrollContainer);
  if (scrollContainer.firstElementChild) resize.observe(scrollContainer.firstElementChild);
  scrollContainer.addEventListener("scroll", schedule, { passive: true });
  schedule();
  return {
    schedule,
    reveal,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(revealFrame);
      resize.disconnect();
      scrollContainer.removeEventListener("scroll", schedule);
    },
  };
}
