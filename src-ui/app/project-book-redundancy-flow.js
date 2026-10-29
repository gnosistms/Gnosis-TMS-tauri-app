import { migrateBookRedundancyChoices } from "./project-book-redundancy-model.js";
import { state } from "./state.js";
import { invoke, listen } from "./runtime.js";
import { selectedProjectsTeam } from "./project-context.js";
import { getActiveStorageLogin } from "./team-storage.js";
import { bookExportItems } from "./project-book-model.js";
import { projectRepoScope, waitForRepoWriteQueueIdle } from "./repo-write-queue.js";
import { applyStoredSelectedTeamAiActionPreferences, resolveAiReviewProviderAndModel } from "./ai-settings-flow.js";
import { formatErrorForDisplay } from "./error-display.js";
let active;
let subscribed;
let pendingChoiceSave = Promise.resolve();
const modal = () => state.editorChapter?.exportModal;
function matches(request) {
  const current = modal();
  return active === request && current?.isOpen && current.page === 2
    && current.projectId === request.projectId && current.languageCode === request.languageCode
    && current.book?.previewCache === request.session && state.selectedTeamId === request.teamId
    && getActiveStorageLogin() === request.login;
}
function publish(request, patch) {
  if (!matches(request)) return;
  const current = modal();
  state.editorChapter = { ...state.editorChapter, exportModal: { ...current,
    book: { ...current.book, redundancy: { ...current.book.redundancy, ...patch } },
  } };
  request.render?.({ scope: "book-redundancy" });
}
export function cancelBookRedundancy() {
  const previous = active;
  active = null;
  if (previous?.started) void previous.invoke("cancel_book_redundancy", { requestId: previous.id }).catch(() => {});
}
export async function startBookRedundancy(render, operations = {}) {
  cancelBookRedundancy();
  const current = modal(), team = selectedProjectsTeam();
  const project = state.projects.find((entry) => entry.id === current?.projectId);
  if (!current?.book || current.page !== 2 || !project || !team) return;
  const request = { id: crypto.randomUUID(), render, projectId: current.projectId, languageCode: current.languageCode,
    teamId: team.id, login: getActiveStorageLogin(), session: current.book.previewCache, invoke: operations.invoke || invoke,
    scope: { login: getActiveStorageLogin() || "", installationId: team.installationId, projectId: current.projectId, languageCode: current.languageCode } };
  active = request;
  publish(request, { status: "loading", imagesStatus: "loading", footnotesStatus: "loading", footnotesPhase: "contexts", stage: "", error: "", choiceSaveError: "" });
  try {
    if (!subscribed) subscribed = Promise.resolve((operations.listen || listen)("book-redundancy-progress", ({ payload }) => {
      const request = active;
      if (!request || payload?.requestId !== request.id) return;
      if (!matches(request)) { cancelBookRedundancy(); return; }
      if (payload.phase === "images") {
        request.imagesPublished = true;
        publishResult(request, payload.result, modal().book.redundancy.choices || {}, { imagesStatus: "ready" });
      } else if (payload.phase === "frequencies") {
        publish(request, { footnotesPhase: payload.status === "loading" ? "frequencies" : "contexts" });
      } else if (payload.phase === "meanings") {
        publish(request, { footnotesPhase: "meanings" });
      } else if (payload.complete) {
        if (payload.error) fail(request, payload.error);
        else publishResult(request, payload.result, modal().book.redundancy.choices || {}, { status: "ready", imagesStatus: "ready", footnotesStatus: "ready", stage: "", error: "" });
      }
    })).catch((error) => { subscribed = null; throw error; });
    await subscribed;
    await pendingChoiceSave;
    if (!matches(request)) return;
    const cached = await request.invoke("book_redundancy_cache", { input: request.scope });
    if (!matches(request)) return;
    publishResult(request, cached.result, cached.choices || {}, {});
    await (operations.waitForRepoQueue || waitForRepoWriteQueueIdle)(projectRepoScope({ team, project }), { operationTypes: ["localEditorWrite"] });
    let selection = {};
    try {
      (operations.applyAiPreferences || applyStoredSelectedTeamAiActionPreferences)(null);
      selection = (operations.resolveModel || resolveAiReviewProviderAndModel)();
    } catch { /* Native detection reports incomplete AI work; image review still works. */ }
    if (!matches(request)) return;
    request.started = true;
    // Inventory always sees originals, never last time's export exclusions.
    const bookItems = bookExportItems({ ...current, book: { ...current.book, redundancy: null } });
    await request.invoke("start_book_redundancy", { input: { requestId: request.id, login: request.scope.login,
      providerId: selection.providerId || null, modelId: selection.modelId || "",
      export: { ...request.scope, repoName: project.name, chapterId: current.chapterId || "",
        chapterIds: bookItems.filter((item) => item.kind === "chapter").map((item) => item.chapterId),
        projectTitle: current.projectTitle, bookItems, format: "pdf", outputPath: "", projectFullName: project.fullName || null },
    } });
  } catch (error) { fail(request, formatErrorForDisplay(error)); }
}
function fail(request, error) {
  const review = modal()?.book?.redundancy;
  const imagesReady = request.imagesPublished && review?.imagesStatus === "ready";
  publish(request, { status: "error", imagesStatus: imagesReady ? "ready" : "error", footnotesStatus: "error", error,
    result: imagesReady ? { ...review.result, footnotes: [] } : null });
}
/** Returns whether the choice was recorded. */
export function setBookRedundancyChoice(id, included, operations = {}) {
  const current = modal(), request = active;
  if (!request || !matches(request)) return false;
  const review = current.book.redundancy;
  if (review?.status !== "ready" && !(id.startsWith("image:") && review?.imagesStatus === "ready")) return false;
  const choices = { ...current.book.redundancy.choices, [id]: included };
  request.saveError = null;
  // Leave the checkbox, focus and scrolling list mounted.
  state.editorChapter = { ...state.editorChapter, exportModal: { ...current, pdfFontStatus: "idle", pdfFontInspectionKey: "",
    book: { ...current.book, redundancy: { ...current.book.redundancy, choices } },
  } };
  queueChoiceSave(request, choices, operations.invoke || request.invoke);
  return true;
}

function publishResult(request, result, choices, patch) {
  const migrated = migrateBookRedundancyChoices(result, choices);
  publish(request, { ...patch, result, choices: migrated });
  if (migrated !== choices) queueChoiceSave(request, migrated);
}
function queueChoiceSave(request, choices, invokeCommand = request.invoke) {
  const version = (request.choiceVersion || 0) + 1;
  request.choiceVersion = version;
  request.saveError = null;
  pendingChoiceSave = pendingChoiceSave.catch(() => {}).then(async () => {
    if (getActiveStorageLogin() !== request.login) return;
    await invokeCommand("book_redundancy_cache", { input: { ...request.scope, choices } });
    if (request.choiceVersion === version) {
      request.saveError = null;
      if (matches(request) && modal().book.redundancy.choiceSaveError) publish(request, { choiceSaveError: "" });
    }
  }).catch((error) => {
    if (request.choiceVersion !== version) return;
    request.saveError = error;
    publish(request, { choiceSaveError: formatErrorForDisplay(error) });
  });
}
export function retryBookRedundancyChoiceSave() {
  if (active && matches(active) && (modal().book.redundancy?.status === "ready" || modal().book.redundancy?.imagesStatus === "ready")) queueChoiceSave(active, modal().book.redundancy.choices);
}

export async function flushBookRedundancyChoices() {
  const request = active;
  if (!request) return false;
  while (true) {
    const pending = pendingChoiceSave;
    await pending;
    if (!matches(request)) return false;
    if (pending !== pendingChoiceSave) continue;
    if (request.saveError) throw request.saveError;
    return true;
  }
}
