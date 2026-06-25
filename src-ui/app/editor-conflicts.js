import { rowFootnotesEqual } from "./editor-row-persistence-model.js";
import { editorFieldImageEqual, imageUrlIsResolvable } from "./editor-images.js";

function normalizeConflictText(value) {
  return typeof value === "string" ? value : String(value ?? "");
}

function normalizeLanguageCode(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function imageUrlConflicted(localImage, remoteImage) {
  return (
    imageUrlIsResolvable(localImage)
    && imageUrlIsResolvable(remoteImage)
    && !editorFieldImageEqual(localImage, remoteImage)
  );
}

export function rowHasUnresolvedEditorConflict(row) {
  return (
    Boolean(row?.conflictState?.remoteRow)
    || row?.hasConflict === true
    || row?.freshness === "conflict"
    || row?.saveStatus === "conflict"
    || row?.hasTextConflict === true
    || row?.textConflict?.isUnresolved === true
    || row?.textConflict?.status === "unresolved"
    || row?.textConflictState === "unresolved"
    || row?.textConflictState === "conflict"
    || row?.translationConflictState === "unresolved"
    || row?.translationConflictState === "conflict"
  );
}

export function conflictedLanguageCodesForRow(row, languages = []) {
  const remoteFields = row?.conflictState?.remoteRow?.fields;
  const remoteFootnotes = row?.conflictState?.remoteRow?.footnotes;
  const remoteImageCaptions = row?.conflictState?.remoteRow?.imageCaptions;
  const remoteImages = row?.conflictState?.remoteRow?.images;
  const localFields = row?.fields;
  const localFootnotes = row?.footnotes;
  const localImageCaptions = row?.imageCaptions;
  const localImages = row?.images;
  const hasConflictPayload =
    (remoteFields && typeof remoteFields === "object")
    || (remoteFootnotes && typeof remoteFootnotes === "object")
    || (remoteImageCaptions && typeof remoteImageCaptions === "object")
    || (remoteImages && typeof remoteImages === "object");
  if (!hasConflictPayload) {
    return new Set();
  }

  const codes = new Set();
  const candidateCodes = Array.isArray(languages) && languages.length > 0
    ? languages.map((language) => normalizeLanguageCode(language?.code)).filter(Boolean)
    : [...new Set([
      ...Object.keys(localFields && typeof localFields === "object" ? localFields : {}),
      ...Object.keys(remoteFields && typeof remoteFields === "object" ? remoteFields : {}),
      ...Object.keys(localFootnotes && typeof localFootnotes === "object" ? localFootnotes : {}),
      ...Object.keys(remoteFootnotes && typeof remoteFootnotes === "object" ? remoteFootnotes : {}),
      ...Object.keys(localImageCaptions && typeof localImageCaptions === "object" ? localImageCaptions : {}),
      ...Object.keys(remoteImageCaptions && typeof remoteImageCaptions === "object" ? remoteImageCaptions : {}),
      ...Object.keys(localImages && typeof localImages === "object" ? localImages : {}),
      ...Object.keys(remoteImages && typeof remoteImages === "object" ? remoteImages : {}),
    ].filter(Boolean))];

  for (const code of candidateCodes) {
    if (
      normalizeConflictText(localFields?.[code]) !== normalizeConflictText(remoteFields?.[code])
      || !rowFootnotesEqual({ [code]: localFootnotes?.[code] }, { [code]: remoteFootnotes?.[code] })
      || normalizeConflictText(localImageCaptions?.[code]) !== normalizeConflictText(remoteImageCaptions?.[code])
      || imageUrlConflicted(localImages?.[code], remoteImages?.[code])
    ) {
      codes.add(code);
    }
  }

  return codes;
}

export function editorChapterHasUnresolvedConflicts(chapterState) {
  return Array.isArray(chapterState?.rows) && chapterState.rows.some((row) => rowHasUnresolvedEditorConflict(row));
}
