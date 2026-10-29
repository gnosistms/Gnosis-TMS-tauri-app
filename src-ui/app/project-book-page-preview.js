import { state } from "./state.js";
import { invoke, listen } from "./runtime.js";
import { bookExportItems } from "./project-book-model.js";
import { DEFAULT_PDF_PAPER_SIZE } from "./editor-export-options.js";
import { formatErrorForDisplay } from "./error-display.js";
import { selectedProjectsTeam } from "./project-context.js";

// Book sections whose step-1 preview is the actual typeset PDF page.
export const BOOK_PROOF_KINDS = ["title", "contents"];

let timer;
let active;
let listener;
const currentModal = () => state.editorChapter?.exportModal;

function previewInput(modal) {
  const item = modal?.book?.items.find((item) => item.id === modal.book.selectedItemId);
  if (!modal?.isOpen || modal.page !== 1 || !BOOK_PROOF_KINDS.includes(item?.kind)) return null;
  // Share the exact field normalization (including empty-title defaults) with
  // PDF export. Preview an excluded section too, so it can still be edited.
  const items = bookExportItems({ ...modal, book: { ...modal.book,
    items: modal.book.items.map((entry) => entry.id === item.id ? { ...entry, excluded: false } : entry) } });
  const input = { languageCode: modal.languageCode, paperSize: modal.pdfPaperSize || DEFAULT_PDF_PAPER_SIZE,
    item: items.find((entry) => entry.id === item.id) };
  if (item.kind !== "contents") return input;
  // Contents page numbers come from typesetting the saved book's text. Review
  // exclusions belong to step 2; approximate numbers do not wait for them.
  const project = state.projects.find((entry) => entry.id === modal.projectId);
  return { ...input, book: {
    installationId: selectedProjectsTeam()?.installationId, repoName: project?.name || "", projectId: modal.projectId,
    projectFullName: project?.fullName || "", projectTitle: modal.projectTitle || "",
    bookItems: items.map((entry) => ({ ...entry, exclusions: [], reviewRevision: "" })),
  } };
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
    ...modal, book: { ...modal.book, pagePreview: { ...modal.book.pagePreview, ...patch } },
  } };
  request.render?.({ scope: "project-book-preview" });
}

export function cancelBookPagePreview() {
  clearTimeout(timer);
  active = null;
}

// Only the SVG output is patched when a job finishes. The form/caret and both
// scroll panes stay mounted while typing, including when older jobs finish late.
export function requestBookPagePreview(render, operations = {}) {
  const modal = currentModal();
  const input = previewInput(modal);
  if (!input) { cancelBookPagePreview(); return; }
  const key = JSON.stringify(input);
  if (active?.key === key && isCurrent(active)) return;
  clearTimeout(timer);
  const request = { key, render, session: modal.book.previewCache,
    projectId: modal.projectId, teamId: state.selectedTeamId, id: crypto.randomUUID() };
  active = request;
  const previous = modal.book.pagePreview;
  publish(request, { key, status: "loading", error: "",
    pages: previous?.itemId === input.item.id ? previous.pages : [], itemId: input.item.id });
  timer = setTimeout(async () => {
    if (!isCurrent(request)) return;
    try {
      if (!listener) {
        const subscribe = operations.listen ?? listen;
        if (!subscribe) throw new Error("The page preview is available in the desktop app.");
        listener = Promise.resolve(subscribe("book-page-preview", ({ payload }) => {
          const request = active;
          if (!request || payload?.requestId !== request.id) return;
          publish(request, { status: payload.error ? "error" : "ready", pages: payload.pages || [], error: payload.error || "" });
        })).catch((error) => { listener = null; throw error; });
      }
      await listener;
      if (!isCurrent(request)) return;
      await (operations.invoke ?? invoke)("start_project_book_page_preview", { input: { ...input, requestId: request.id } });
    } catch (error) {
      publish(request, { status: "error", pages: [], error: formatErrorForDisplay(error) });
    }
  }, operations.delay ?? 250);
}
