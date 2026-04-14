import {
  EDITOR_ROW_FILTER_MODE_SHOW_ALL,
  normalizeEditorChapterFilterState,
} from "./editor-filters.js";
import { normalizeEditorReplaceState } from "./editor-replace.js";

export function buildEditorShowRowInContextChapterState(editorChapter = {}) {
  const currentFilters = normalizeEditorChapterFilterState(editorChapter?.filters);
  const currentReplaceState = normalizeEditorReplaceState(editorChapter?.replace);
  return {
    ...editorChapter,
    filters: {
      ...currentFilters,
      searchQuery: "",
      rowFilterMode: EDITOR_ROW_FILTER_MODE_SHOW_ALL,
    },
    replace: {
      ...currentReplaceState,
      enabled: false,
      selectedRowIds: new Set(),
      status: "idle",
      error: "",
    },
  };
}
