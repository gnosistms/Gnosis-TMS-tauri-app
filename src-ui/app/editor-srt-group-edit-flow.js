import { state } from "./state.js";
import { srtGroupForRow, srtGroupingEnabled } from "./editor-srt-grouping.js";
import { createSrtGroupText, normalizeSrtGroupText, composeSrtGroupText, srtGroupEditHasChanges, srtGroupEditMatchesMembers } from "./editor-srt-group-text.js";
import { repairSrtGroupMarkers } from "./editor-srt-marker-repair.js";

function editKey(rowId, code) { return `${rowId}:${code}`; }

export function beginSrtGroupEdit(rowId, code) {
  const chapter = state.editorChapter;
  if (!srtGroupingEnabled(chapter)) return null;
  const members = srtGroupForRow(chapter, rowId);
  if (members.length < 2) return null;
  const firstRowId = members[0].rowId;
  const key = editKey(firstRowId, code);
  const existing = chapter.srtGroupEdits?.[key];
  if (existing && srtGroupEditMatchesMembers(existing, members)) return existing;
  const spec = createSrtGroupText(members.map((row) => row.fields?.[code] ?? ""));
  const edit = { ...spec, key, firstRowId, languageCode: code,
    memberRowIds: members.map((row) => row.rowId), draft: spec.text, savedDraft: spec.text,
    baseFields: Object.fromEntries(members.map((row) => [row.rowId, row.baseFields?.[code] ?? row.persistedFields?.[code] ?? row.fields?.[code] ?? ""])),
    originalTexts: members.map((row) => row.fields?.[code] ?? ""),
    version: 0, error: "", composing: false };
  state.editorChapter = { ...chapter, srtGroupEdits: { ...chapter.srtGroupEdits, [key]: edit } };
  return edit;
}

export function updateSrtGroupDraft(rowId, code, draft, options = {}) {
  const edit = beginSrtGroupEdit(rowId, code);
  if (!edit) return false;
  state.editorChapter = { ...state.editorChapter, srtGroupEdits: {
    ...state.editorChapter.srtGroupEdits,
    [edit.key]: { ...edit, draft, forceSave: edit.needsMarkerReview === true || options.forceSave === true, version: edit.version + 1, error: "" },
  } };
  return true;
}

export function pendingSrtGroupEdits(chapter, options = {}) {
  return Object.values(chapter?.srtGroupEdits ?? {}).filter((edit) =>
    srtGroupEditHasChanges(edit)
    && (!options.rowIds || edit.memberRowIds.some((id) => options.rowIds.includes(id)))
    && (!options.excludeRowId || !edit.memberRowIds.includes(options.excludeRowId)));
}

export function validateSrtGroupEdits(chapter, options = {}) {
  const edits = pendingSrtGroupEdits(chapter, options);
  return edits.map((edit) => ({ edit, ...repairSrtGroupMarkers(edit.draft, edit.markers, edit.originalTexts ?? Object.values(edit.baseFields ?? {})) }));
}

export function proposeSrtMarkerRepair(result) {
  const { edit, text, error } = result;
  state.editorChapter = { ...state.editorChapter,
    activeRowId: edit.firstRowId, activeLanguageCode: edit.languageCode,
    mainFieldEditor: { rowId: edit.firstRowId, languageCode: edit.languageCode },
    srtMarkerModal: { key: edit.key, valid: !error, count: edit.markers.length },
    srtGroupEdits: { ...state.editorChapter.srtGroupEdits,
      [edit.key]: { ...edit, draft: text, error, needsMarkerReview: true, forceSave: true, version: edit.version + 1 },
    },
  };
}

export function dismissSrtMarkerModal(render) {
  const chapter = state.editorChapter;
  const edit = chapter.srtGroupEdits?.[chapter.srtMarkerModal?.key];
  state.editorChapter = { ...chapter, srtMarkerModal: null,
    ...(edit ? { mainFieldEditor: { rowId: edit.firstRowId, languageCode: edit.languageCode },
      pendingSelection: { rowId: edit.firstRowId, languageCode: edit.languageCode, offset: 0 } } : {}),
  };
  render?.();
}

export function setSrtGroupEditError(key, error) {
  const edit = state.editorChapter?.srtGroupEdits?.[key];
  if (!edit) return;
  state.editorChapter = { ...state.editorChapter, srtGroupEdits: {
    ...state.editorChapter.srtGroupEdits, [key]: { ...edit, error },
  } };
}

export function finishSrtGroupEdits(chapterId, saved) {
  if (state.editorChapter?.chapterId !== chapterId) return;
  const edits = { ...state.editorChapter.srtGroupEdits };
  for (const result of saved) {
    const current = edits[result.edit.key];
    if (!current) continue;
    // The old textarea is left alone while typing. A subsequent render shows
    // the restored boundaries; an in-flight save cannot overwrite newer input.
    const parts = current.memberRowIds.map((id) => state.editorChapter.rows.find((row) => row.rowId === id)?.persistedFields?.[current.languageCode] ?? "");
    const text = composeSrtGroupText(parts, current.markers);
    edits[result.edit.key] = { ...current,
      draft: current.version === result.edit.version ? text : current.draft,
      savedDraft: text, error: "", forceSave: false,
      needsMarkerReview: current.version !== result.edit.version && current.needsMarkerReview === true,
      baseFields: Object.fromEntries(current.memberRowIds.map((id, index) => [id, parts[index]])) };
    if (current.version === result.edit.version && (state.editorChapter.mainFieldEditor?.rowId !== current.firstRowId
      || state.editorChapter.mainFieldEditor?.languageCode !== current.languageCode)) delete edits[result.edit.key];
  }
  state.editorChapter = { ...state.editorChapter, srtGroupEdits: edits };
}

export function rebaseSrtGroupEditsAfterResolution(rowId) {
  const chapter = state.editorChapter;
  const row = chapter?.rows?.find((candidate) => candidate.rowId === rowId);
  if (!row || row.freshness === "conflict" || row.conflictState) return;
  const edits = { ...chapter.srtGroupEdits };
  for (const edit of Object.values(edits)) {
    const index = edit.memberRowIds.indexOf(rowId);
    if (index < 0) continue;
    const normalized = normalizeSrtGroupText(edit.draft, edit.markers);
    if (normalized.parts) normalized.parts[index] = row.fields?.[edit.languageCode] ?? "";
    edits[edit.key] = { ...edit, version: edit.version + 1,
      draft: normalized.parts ? composeSrtGroupText(normalized.parts, edit.markers) : edit.draft,
      baseFields: { ...edit.baseFields, [rowId]: row.baseFields?.[edit.languageCode] ?? row.persistedFields?.[edit.languageCode] ?? "" }, error: "",
    };
  }
  state.editorChapter = { ...chapter, srtGroupEdits: edits };
}
