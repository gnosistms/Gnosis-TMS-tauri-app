import { createEditorConflictResolutionModalState } from "./state.js";
import { serializeEditorFootnotesForLegacy } from "./editor-footnotes.js";
import { cloneRowFields, cloneRowFootnotes } from "./editor-utils.js";
import { editorFieldImageUrl, urlImageFromString } from "./editor-images.js";

export function normalizeEditorConflictResolutionValue(value) {
  return typeof value === "string" ? value : String(value ?? "");
}

function serializeFootnoteMap(footnotes) {
  return Object.fromEntries(
    Object.entries(footnotes && typeof footnotes === "object" ? footnotes : {}).map(([code, value]) => [
      code,
      serializeEditorFootnotesForLegacy(value),
    ]),
  );
}

export function buildEditorConflictResolutionModalState(row, languageCode) {
  const localText = normalizeEditorConflictResolutionValue(row?.fields?.[languageCode]);
  const remoteText = normalizeEditorConflictResolutionValue(
    row?.conflictState?.remoteRow?.fields?.[languageCode],
  );
  const localFootnote = serializeEditorFootnotesForLegacy(row?.footnotes?.[languageCode]);
  const remoteFootnote = serializeEditorFootnotesForLegacy(row?.conflictState?.remoteRow?.footnotes?.[languageCode]);
  const localImageCaption = normalizeEditorConflictResolutionValue(row?.imageCaptions?.[languageCode]);
  const remoteImageCaption = normalizeEditorConflictResolutionValue(
    row?.conflictState?.remoteRow?.imageCaptions?.[languageCode],
  );
  const localImageUrl = editorFieldImageUrl(row?.images?.[languageCode]);
  const remoteImageUrl = editorFieldImageUrl(row?.conflictState?.remoteRow?.images?.[languageCode]);

  return {
    ...createEditorConflictResolutionModalState(),
    isOpen: true,
    rowId: row?.rowId ?? null,
    languageCode,
    localText,
    remoteText,
    finalText: remoteText,
    localFootnote,
    remoteFootnote,
    finalFootnote: remoteFootnote,
    localImageCaption,
    remoteImageCaption,
    finalImageCaption: remoteImageCaption,
    localImageUrl,
    remoteImageUrl,
    finalImageUrl: remoteImageUrl,
    remoteVersion: row?.conflictState?.remoteVersion ?? null,
  };
}

export function buildEditorConflictResolutionSaveState(row, languageCode, modal) {
  const remoteFields = cloneRowFields(row?.conflictState?.remoteRow?.fields);
  const remoteFootnotes = serializeFootnoteMap(row?.conflictState?.remoteRow?.footnotes);
  const remoteImageCaptions = cloneRowFields(row?.conflictState?.remoteRow?.imageCaptions);
  const remoteImage = row?.conflictState?.remoteRow?.images?.[languageCode] ?? null;
  const resolvedImage = urlImageFromString(modal?.finalImageUrl);
  const nextLocalFields = {
    ...cloneRowFields(row?.fields),
    [languageCode]: normalizeEditorConflictResolutionValue(modal?.finalText),
  };
  const nextLocalFootnotes = {
    ...cloneRowFootnotes(row?.footnotes),
    [languageCode]: normalizeEditorConflictResolutionValue(modal?.finalFootnote),
  };
  const nextLocalImageCaptions = {
    ...cloneRowFields(row?.imageCaptions),
    [languageCode]: normalizeEditorConflictResolutionValue(modal?.finalImageCaption),
  };
  const resolvesImageConflict = editorConflictResolutionShowsImages(modal);

  return {
    remoteFields,
    remoteFootnotes,
    remoteImageCaptions,
    nextLocalFields,
    nextLocalFootnotes,
    nextLocalImageCaptions,
    fieldsToPersist: {
      ...remoteFields,
      [languageCode]: nextLocalFields[languageCode] ?? "",
    },
    footnotesToPersist: {
      ...remoteFootnotes,
      [languageCode]: nextLocalFootnotes[languageCode] ?? "",
    },
    imageCaptionsToPersist: {
      ...remoteImageCaptions,
      [languageCode]: nextLocalImageCaptions[languageCode] ?? "",
    },
    // Images are only threaded through the save when an image conflict is being
    // resolved, so unrelated rows never carry image writes into the merge command.
    imagesToPersist: resolvesImageConflict ? { [languageCode]: resolvedImage } : null,
    baseImages: resolvesImageConflict ? { [languageCode]: remoteImage } : null,
  };
}

export function buildEditorConflictResolutionVersionSelection(modal, side) {
  const isLocal = side === "local";
  return {
    finalText: normalizeEditorConflictResolutionValue(
      isLocal ? modal?.localText : modal?.remoteText,
    ),
    finalFootnote: normalizeEditorConflictResolutionValue(
      isLocal ? modal?.localFootnote : modal?.remoteFootnote,
    ),
    finalImageCaption: normalizeEditorConflictResolutionValue(
      isLocal ? modal?.localImageCaption : modal?.remoteImageCaption,
    ),
    finalImageUrl: normalizeEditorConflictResolutionValue(
      isLocal ? modal?.localImageUrl : modal?.remoteImageUrl,
    ),
  };
}

export function editorConflictResolutionShowsFootnotes(modal) {
  const footnotes = [
    modal?.localFootnote,
    modal?.remoteFootnote,
    modal?.finalFootnote,
  ].map((value) => normalizeEditorConflictResolutionValue(value));

  return footnotes.some((footnote) => footnote.trim().length > 0) || new Set(footnotes).size > 1;
}

export function editorConflictResolutionShowsImageCaptions(modal) {
  const imageCaptions = [
    modal?.localImageCaption,
    modal?.remoteImageCaption,
    modal?.finalImageCaption,
  ].map((value) => normalizeEditorConflictResolutionValue(value));

  return (
    imageCaptions.some((imageCaption) => imageCaption.trim().length > 0)
    || new Set(imageCaptions).size > 1
  );
}

export function editorConflictResolutionShowsImages(modal) {
  const imageUrls = [
    modal?.localImageUrl,
    modal?.remoteImageUrl,
    modal?.finalImageUrl,
  ].map((value) => normalizeEditorConflictResolutionValue(value));

  return imageUrls.some((url) => url.trim().length > 0) || new Set(imageUrls).size > 1;
}
