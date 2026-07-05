// Row-scoped rendering for editor mutations (scroll ownership redesign, P3).
//
// Mutations confined to one row render through `translate-visible-rows` row
// patching, which preserves the viewport by construction — no snapshot
// threading, no post-render scroll restore. The one exception: while filters
// are active, a row change can alter filtered membership (reviewed, has-image,
// has-footnote, search text...), and a patch cannot add or remove row cards,
// so those renders fall back to the full translate body.

import { editorChapterFiltersAreActive } from "./editor-filters.js";
import { state } from "./state.js";

export function renderEditorRowScoped(render, rowIdOrIds, reason) {
  const rowIds = (Array.isArray(rowIdOrIds) ? rowIdOrIds : [rowIdOrIds])
    .filter((rowId, index, ids) => typeof rowId === "string" && rowId && ids.indexOf(rowId) === index);
  if (rowIds.length === 0) {
    return;
  }

  if (editorChapterFiltersAreActive(state.editorChapter?.filters)) {
    render?.({ scope: "translate-body" });
    return;
  }

  render?.({
    scope: "translate-visible-rows",
    rowIds,
    reason,
  });
}
