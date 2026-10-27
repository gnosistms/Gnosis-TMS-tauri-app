import { buildEditorLastUpdate } from "./editor-review-last-update.js";
import { serializeEditorFootnotesForLegacy } from "./editor-footnotes.js";

export function buildSrtGroupLastUpdate(chapter, row, section) {
  const code = section?.code;
  const members = row.srtGroup.members;
  const memberRowIds = members.map((member) => member.rowId);
  const history = chapter.history ?? {};
  const group = history.group;
  const matches = group?.languageCode === code
    && group.memberRowIds.length === memberRowIds.length
    && group.memberRowIds.every((id, index) => id === memberRowIds[index]);
  const fragments = members.map((member, index) => {
    const currentEntry = {
      plainText: section?.srtParts?.[index] ?? member.fields?.[code] ?? "",
      footnote: serializeEditorFootnotesForLegacy(member.footnotes?.[code]),
      imageCaption: member.imageCaptions?.[code] ?? "",
      image: member.images?.[code] ?? null,
      textStyle: member.textStyle ?? "paragraph",
      reviewed: member.fieldStates?.[code]?.reviewed === true,
      pleaseCheck: member.fieldStates?.[code]?.pleaseCheck === true,
    };
    const entries = matches
      ? history.rowId === member.rowId ? history.entries : group.entriesByRowId[member.rowId]
      : [];
    return { rowId: member.rowId, ...buildEditorLastUpdate({ entries }, currentEntry) };
  });
  const showsPendingLocalSave = fragments.some((fragment) => fragment.showsPendingLocalSave);
  const pendingLocalSaveIsOverdue = fragments.some((fragment) => fragment.pendingLocalSaveIsOverdue);
  const showsCurrentEntry = fragments.some((fragment) => fragment.showsCurrentEntry);
  return { fragments, markers: section?.srtMarkers ?? [],
    history: matches ? group : { status: "loading", error: "" },
    showsPendingLocalSave, pendingLocalSaveIsOverdue, showsCurrentEntry,
    lastUpdateHeadingLabel: showsPendingLocalSave
      ? pendingLocalSaveIsOverdue ? "Local save stalled" : "Saving locally..."
      : showsCurrentEntry ? "Current text" : "Last update",
    lastUpdateBaselineEntry: fragments.some((fragment) => fragment.lastUpdateBaselineEntry) ? {} : null,
  };
}
