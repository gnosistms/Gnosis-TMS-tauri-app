import { extractInlineMarkupBaseText } from "./editor-inline-markup.js";
import { rowHasUnresolvedEditorConflict } from "./editor-conflicts.js";
import { chapterHasSrtSourceFormat, effectiveRowTiming, rowIsSubtitleCue } from "./editor-timing.js";
import { joinSrtFragmentTexts, createSrtGroupText, normalizeSrtGroupText, srtGroupEditHasChanges, srtGroupEditMatchesMembers } from "./editor-srt-group-text.js";
const groupCache = new WeakMap();
export const SRT_PAUSE_THRESHOLDS_MS = [500, 750, 1000, 1500, 2000, 2500, 3000];

export function srtGroupingEnabled(chapter) {
  return chapter?.srtViewMode === "group-fragments" && chapterHasSrtSourceFormat(chapter.sourceFormats);
}

function sourceLanguage(chapter) {
  return chapter?.selectedSourceLanguageCode
    ?? chapter?.languages?.find((language) => language.role === "source")?.code
    ?? chapter?.languages?.[0]?.code ?? "";
}

function eligible(row, code) {
  const timing = effectiveRowTiming(row, code);
  return row.lifecycleState !== "deleted" && !row.remotelyDeleted
    && !rowHasUnresolvedEditorConflict(row) && !row.hasConflict
    && rowIsSubtitleCue(row) && timing && timing.endMs >= timing.startMs;
}

function endsSentence(text) {
  const base = extractInlineMarkupBaseText(text).trim().replace(/["'”’»」』）)\]}]+$/u, "");
  if (!/[.!?。？！…؟۔।॥။։]$/u.test(base)) return false;
  // Common abbreviations and initials at a cue edge are not sentence ends.
  if (/(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|e\.g|i\.e)|\b[A-Z])\.$/u.test(base)) return false;
  return true;
}

export function srtGroupsForChapter(chapter) {
  const rows = chapter?.rows ?? [];
  const code = sourceLanguage(chapter);
  const enabled = srtGroupingEnabled(chapter);
  const pauseThreshold = chapter?.srtPauseSplitEnabled === true
    ? (SRT_PAUSE_THRESHOLDS_MS.includes(chapter.srtPauseThresholdMs) ? chapter.srtPauseThresholdMs : 500)
    : null;
  const frozenEdits = Object.values(chapter?.srtGroupEdits ?? {}).filter((edit) => srtGroupEditHasChanges(edit)
    || (chapter.mainFieldEditor?.rowId === edit.firstRowId && chapter.mainFieldEditor?.languageCode === edit.languageCode));
  const freezeKey = frozenEdits.map((edit) => `${edit.key}:${edit.memberRowIds.join(":")}`).join("|");
  const cached = groupCache.get(rows);
  if (cached?.code === code && cached.enabled === enabled && cached.pauseThreshold === pauseThreshold && cached.freezeKey === freezeKey) return cached.groups;
  const remember = (groups) => {
    const byId = new Map();
    for (const members of groups) for (const row of members) byId.set(row.rowId, members);
    groupCache.set(rows, { code, enabled, pauseThreshold, freezeKey, groups, byId });
    return groups;
  };
  if (!enabled) return remember(rows.map((row) => [row]));
  const frozen = new Map();
  const separatedDraftMembers = new Set();
  const rowsById = new Map(rows.map((row) => [row.rowId, row]));
  const positions = new Map(rows.map((row, index) => [row.rowId, index]));
  for (const edit of frozenEdits) {
    const members = edit.memberRowIds.map((id) => rowsById.get(id));
    if (!srtGroupEditHasChanges(edit) && !srtGroupEditMatchesMembers(edit, members)) continue;
    if (members.every((row, index) => row && eligible(row, code)
      && positions.get(row.rowId) === positions.get(edit.memberRowIds[0]) + index)) frozen.set(members[0].rowId, members);
    else if (srtGroupEditHasChanges(edit)) for (const id of edit.memberRowIds) separatedDraftMembers.add(id);
  }
  const frozenMembers = new Set([...frozen.values()].flat().map((row) => row.rowId));
  const groups = [];
  let current = [];
  const flush = () => { if (current.length) groups.push(current); current = []; };
  for (const row of rows) {
    if (frozen.has(row.rowId)) { flush(); groups.push(frozen.get(row.rowId)); continue; }
    if (frozenMembers.has(row.rowId)) continue;
    if (!eligible(row, code) || separatedDraftMembers.has(row.rowId)) { flush(); groups.push([row]); continue; }
    const previous = current.at(-1);
    if (previous && (endsSentence(previous.fields?.[code] ?? "")
      || (pauseThreshold !== null && effectiveRowTiming(row, code).startMs - effectiveRowTiming(previous, code).endMs > pauseThreshold))) flush();
    current.push(row);
  }
  flush();
  return remember(groups);
}

export function srtGroupForRow(chapter, rowId) {
  if (!chapter) return [];
  srtGroupsForChapter(chapter);
  return groupCache.get(chapter.rows)?.byId.get(rowId) ?? [];
}

export function srtDisplayRowId(chapter, rowId) {
  return srtGroupingEnabled(chapter) ? srtGroupForRow(chapter, rowId)[0]?.rowId ?? rowId : rowId;
}

function editForMembers(chapter, members, code) {
  const edit = chapter.srtGroupEdits?.[`${members[0].rowId}:${code}`];
  return edit && srtGroupEditMatchesMembers(edit, members) ? edit : null;
}

export function combineSrtRows(members, languages, chapter = {}) {
  const first = members[0];
  const fields = {};
  const srtTexts = {};
  for (const { code } of languages) {
    const edit = editForMembers(chapter, members, code);
    const original = members.map((row) => row.fields?.[code] ?? "");
    const spec = edit ?? createSrtGroupText(original);
    const normalized = edit ? normalizeSrtGroupText(edit.draft, edit.markers) : null;
    const parts = normalized?.parts ?? original;
    fields[code] = normalized?.error ? edit.markers.reduce((text, marker) => text.replaceAll(marker, ""), edit.draft) : joinSrtFragmentTexts(parts, code);
    srtTexts[code] = { parts, markers: spec.markers, text: edit?.draft ?? spec.text };
  }
  return { ...first, fields, srtTexts, srtGroup: { key: members.map((row) => row.rowId).join(":"), memberRowIds: members.map((row) => row.rowId), members } };
}

export function projectSrtDisplayRows(rows, chapter, languages) {
  if (!srtGroupingEnabled(chapter)) return rows;
  return srtGroupsForChapter({ ...chapter, rows }).map((members) => {
    const combined = combineSrtRows(members, languages, chapter);
    if (members.length < 2) return { ...members[0], sections: members[0].sections?.map((section) => ({ ...section, showTiming: false })) };
    const sections = languages.map(({ code }) => {
      const originals = members.map((row) => row.sections?.find((section) => section.code === code));
      const first = originals[0] ?? { code };
      const edit = editForMembers(chapter, members, code);
      const originalTexts = members.map((row) => row.fields?.[code] ?? "");
      const spec = edit ?? createSrtGroupText(originalTexts);
      const normalized = edit ? normalizeSrtGroupText(edit.draft, edit.markers) : null;
      const parts = normalized?.parts ?? originalTexts;
      combined.fields[code] = normalized?.error
        ? edit.markers.reduce((text, marker) => text.replaceAll(marker, ""), edit.draft)
        : joinSrtFragmentTexts(parts, code);
      return { ...first,
        text: edit?.draft ?? spec.text,
        searchText: joinSrtFragmentTexts(originals.map((section) => section?.searchText ?? section?.text ?? ""), code),
        searchFootnote: originals.map((section) => section?.searchFootnote ?? section?.footnote ?? "").filter(Boolean).join("\n"),
        searchImageCaption: originals.map((section) => section?.searchImageCaption ?? section?.imageCaption ?? "").filter(Boolean).join("\n"),
        reviewed: originals.every((section) => section?.reviewed === true),
        pleaseCheck: originals.some((section) => section?.pleaseCheck === true),
        image: originals.find((section) => section?.image)?.image ?? null,
        hasVisibleFootnote: originals.some((section) => section?.hasVisibleFootnote),
        footnote: originals.map((section) => section?.footnote ?? "").filter(Boolean).join("\n"),
        hasVisibleImage: originals.some((section) => section?.hasVisibleImage),
        hasVisibleImageCaption: originals.some((section) => section?.hasVisibleImageCaption),
        isTextEditorOpen: originals.some((section) => section?.isTextEditorOpen) || Boolean(edit?.error) || edit?.needsMarkerReview === true,
        isActive: originals.some((section) => section?.isActive),
        timingStartError: originals.some((section) => section?.timingStartError),
        timingEndError: originals.some((section) => section?.timingEndError),
        showTiming: false, srtParts: parts, srtMarkers: spec.markers, srtError: edit?.error ?? "",
        srtNeedsMarkerReview: edit?.needsMarkerReview === true,
        srtAttachments: members.map((row, index) => ({ row, section: originals[index] })),
      };
    });
    return { ...combined, sections,
      saveStatus: members.some((row) => row.saveStatus === "error") ? "error"
        : members.some((row) => row.saveStatus === "saving") ? "saving"
        : members.some((row) => row.saveStatus === "dirty") ? "dirty" : members[0].saveStatus,
      saveError: members.find((row) => row.saveError)?.saveError ?? "",
      isStale: members.some((row) => row.isStale),
    };
  });
}

export function srtLinguisticRow(row, chapter) {
  if (!row || row.srtGroup || !srtGroupingEnabled(chapter)) return row;
  const members = srtGroupForRow(chapter, row.rowId);
  return members.length > 1 ? combineSrtRows(members, chapter.languages ?? [], chapter) : row;
}
