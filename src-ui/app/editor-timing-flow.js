// Blur handling for the subtitle timing inputs. Format is the only blocking
// check — an unparseable value keeps the user's text, shows an inline error,
// and persists nothing. Consistency errors (too short, overlaps) are derived
// at render time by the screen model, so after a valid edit this module only
// updates the row's timing override, re-renders the edited row plus its
// neighbors (their overlap marks may change), and rides the standard blur
// persistence path.

import { state } from "./state.js";
import {
  cloneRowTimings,
  effectiveRowTiming,
  formatTimingMs,
  parseTimingInput,
  timingValuesEqual,
} from "./editor-timing.js";
import { renderEditorRowScoped } from "./editor-row-scoped-render.js";

const TIMING_FORMAT_ERROR_MESSAGE = "Use the time format HH:MM:SS,mmm.";

function findEditorRow(rowId) {
  return (
    (Array.isArray(state.editorChapter?.rows) ? state.editorChapter.rows : []).find(
      (row) => row?.rowId === rowId,
    ) ?? null
  );
}

// The edited row plus its active neighbors: an edit here can add or clear
// overlap marks on the previous row's end and the next row's start.
function rowIdsWithActiveNeighbors(rowId) {
  const activeRows = (Array.isArray(state.editorChapter?.rows) ? state.editorChapter.rows : [])
    .filter((row) => row?.lifecycleState !== "deleted" && row?.rowId);
  const index = activeRows.findIndex((row) => row.rowId === rowId);
  if (index < 0) {
    return [rowId];
  }
  return [
    activeRows[index - 1]?.rowId,
    rowId,
    activeRows[index + 1]?.rowId,
  ].filter(Boolean);
}

function showTimingFormatError(input) {
  input.classList.add("translation-timing__input--error");
  input.setAttribute("data-timing-format-error", "true");
  input.title = TIMING_FORMAT_ERROR_MESSAGE;
}

function clearTimingFormatError(input) {
  input.removeAttribute("data-timing-format-error");
  input.removeAttribute("title");
}

export function applyEditorTimingFieldBlur(render, input, operations = {}) {
  const { updateEditorChapterRow, persistEditorRowOnBlur } = operations;
  if (
    !(input instanceof HTMLInputElement)
    || typeof updateEditorChapterRow !== "function"
    || typeof persistEditorRowOnBlur !== "function"
  ) {
    return;
  }

  const rowId = input.dataset.rowId ?? "";
  const languageCode = input.dataset.languageCode ?? "";
  const timingKind = input.dataset.timingKind === "end" ? "end" : "start";
  // Read-only sessions never reach here (the inputs render disabled), and the
  // persist path re-asserts write permission regardless.
  const row = findEditorRow(rowId);
  if (!row || !languageCode) {
    return;
  }

  const parsedMs = parseTimingInput(input.value);
  if (parsedMs === null) {
    showTimingFormatError(input);
    return;
  }
  clearTimingFormatError(input);

  const effective = effectiveRowTiming(row, languageCode) ?? { startMs: 0, endMs: 0 };
  const nextTiming =
    timingKind === "end"
      ? { startMs: effective.startMs, endMs: parsedMs }
      : { startMs: parsedMs, endMs: effective.endMs };

  if (timingValuesEqual(nextTiming, effectiveRowTiming(row, languageCode))) {
    // Same effective value (possibly typed in a different accepted format):
    // normalize the display and redraw the row so any leftover format-error
    // styling returns to the derived state.
    input.value = formatTimingMs(parsedMs);
    renderEditorRowScoped(render, rowId, "timing-unchanged");
    return;
  }

  updateEditorChapterRow(rowId, (currentRow) => ({
    ...currentRow,
    timings: {
      ...cloneRowTimings(currentRow.timings),
      [languageCode]: nextTiming,
    },
  }));
  renderEditorRowScoped(render, rowIdsWithActiveNeighbors(rowId), "timing-updated");
  void persistEditorRowOnBlur(render, rowId);
}
