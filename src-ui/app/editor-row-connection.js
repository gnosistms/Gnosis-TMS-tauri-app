import { buildEditorScreenViewModel } from "./editor-screen-model.js";
import {
  createEditorHistoryState,
  createEditorMainFieldEditorState,
  createEditorPendingSelectionState,
} from "./state.js";

export function editorRowViewportDirection(bounds, viewport) {
  if (!bounds || !viewport || ![bounds.start, bounds.end, viewport.start, viewport.end].every(Number.isFinite)
    || bounds.end <= bounds.start || viewport.end <= viewport.start) {
    return null;
  }
  if (bounds.end <= viewport.start) return "above";
  if (bounds.start >= viewport.end) return "below";
  return "visible";
}

// Run before editor rendering, never from the pure view-model builder or scroll.
export function reconcileEditorRowConnection(appState) {
  const chapter = appState.editorChapter;
  if (appState.screen !== "translate" || !chapter?.activeRowId
    || !["ready", "refreshing"].includes(chapter.status)) return false;
  const model = buildEditorScreenViewModel(appState);
  if (model.contentRows.some((row) => row.kind === "row" && row.id === chapter.activeRowId)) return false;
  appState.editorChapter = {
    ...chapter,
    activeRowId: null,
    activeLanguageCode: null,
    mainFieldEditor: createEditorMainFieldEditorState(),
    pendingSelection: createEditorPendingSelectionState(),
    history: createEditorHistoryState(),
    // Keep the row-keyed comment draft; an inactive row cannot display it or
    // accept a late response. Reselecting that row can resume the draft.
    comments: { ...chapter.comments, status: "idle", requestKey: null, error: "", deletingCommentId: null },
  };
  return true;
}
