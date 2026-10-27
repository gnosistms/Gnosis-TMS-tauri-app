import { state } from "./state.js";
import { invoke, listen } from "./runtime.js";
import { bookExportItems } from "./project-book-model.js";
import { DEFAULT_PDF_PAPER_SIZE } from "./editor-export-options.js";
import { formatErrorForDisplay } from "./error-display.js";

let timer;
let active;
let listener;
const currentModal = () => state.editorChapter?.exportModal;

function previewInput(modal) {
  const item = modal?.book?.items.find((item) => item.id === modal.book.selectedItemId);
  if (!modal?.isOpen || modal.page !== 1 || item?.kind !== "title") return null;
  // Share the exact field normalization (including empty-title defaults) with
  // PDF export. Preview an excluded title too, so it can still be edited.
  const normalized = bookExportItems({ ...modal, book: { ...modal.book, items: [{ ...item, excluded: false }] } })[0];
  return { languageCode: modal.languageCode, paperSize: modal.pdfPaperSize || DEFAULT_PDF_PAPER_SIZE, item: normalized };
}

function isCurrent(request) {
  const modal = currentModal();
  return active === request && modal?.projectId === request.projectId
    && state.selectedTeamId === request.teamId && modal?.book?.previewCache === request.session
    && JSON.stringify(previewInput(modal)) === request.key;
}

function publish(request, patch) {
  if (!isCurrent(request)) return;
  const modal = currentModal();
  state.editorChapter = { ...state.editorChapter, exportModal: {
    ...modal, book: { ...modal.book, titlePreview: { ...modal.book.titlePreview, ...patch } },
  } };
  request.render?.({ scope: "project-book-preview" });
}

export function cancelBookTitlePreview() {
  clearTimeout(timer);
  active = null;
}

// Only the SVG output is patched when a job finishes. The form/caret and both
// scroll panes stay mounted while typing, including when older jobs finish late.
export function requestBookTitlePreview(render, operations = {}) {
  const modal = currentModal();
  const input = previewInput(modal);
  if (!input) { cancelBookTitlePreview(); return; }
  const key = JSON.stringify(input);
  if (active?.key === key && isCurrent(active)) return;
  clearTimeout(timer);
  const request = { key, render, session: modal.book.previewCache,
    projectId: modal.projectId, teamId: state.selectedTeamId, id: crypto.randomUUID() };
  active = request;
  const previous = modal.book.titlePreview;
  publish(request, { key, status: "loading", error: "",
    pages: previous?.itemId === input.item.id ? previous.pages : [], itemId: input.item.id });
  timer = setTimeout(async () => {
    if (!isCurrent(request)) return;
    try {
      if (!listener) {
        const subscribe = operations.listen ?? listen;
        if (!subscribe) throw new Error("The title-page preview is available in the desktop app.");
        listener = Promise.resolve(subscribe("book-title-preview", ({ payload }) => {
          const request = active;
          if (!request || payload?.requestId !== request.id) return;
          publish(request, { status: payload.error ? "error" : "ready", pages: payload.pages || [], error: payload.error || "" });
        })).catch((error) => { listener = null; throw error; });
      }
      await listener;
      if (!isCurrent(request)) return;
      await (operations.invoke ?? invoke)("start_project_book_title_preview", { input: { ...input, requestId: request.id } });
    } catch (error) {
      publish(request, { status: "error", pages: [], error: formatErrorForDisplay(error) });
    }
  }, operations.delay ?? 250);
}
