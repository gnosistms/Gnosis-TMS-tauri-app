import { createEditorConflictResolutionModalState } from "./state.js";
import { cloneRowFields } from "./editor-utils.js";

export function normalizeEditorConflictResolutionValue(value) {
  return typeof value === "string" ? value : String(value ?? "");
}

export function buildEditorConflictResolutionModalState(row, languageCode) {
  const localText = normalizeEditorConflictResolutionValue(row?.fields?.[languageCode]);
  const remoteText = normalizeEditorConflictResolutionValue(
    row?.conflictState?.remoteRow?.fields?.[languageCode],
  );
  const localFootnote = normalizeEditorConflictResolutionValue(row?.footnotes?.[languageCode]);
  const remoteFootnote = normalizeEditorConflictResolutionValue(
    row?.conflictState?.remoteRow?.footnotes?.[languageCode],
  );
  const localImageCaption = normalizeEditorConflictResolutionValue(row?.imageCaptions?.[languageCode]);
  const remoteImageCaption = normalizeEditorConflictResolutionValue(
    row?.conflictState?.remoteRow?.imageCaptions?.[languageCode],
  );

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
    remoteVersion: row?.conflictState?.remoteVersion ?? null,
  };
}

export function buildEditorConflictResolutionSaveState(row, languageCode, modal) {
  const remoteFields = cloneRowFields(row?.conflictState?.remoteRow?.fields);
  const remoteFootnotes = cloneRowFields(row?.conflictState?.remoteRow?.footnotes);
  const remoteImageCaptions = cloneRowFields(row?.conflictState?.remoteRow?.imageCaptions);
  const nextLocalFields = {
    ...cloneRowFields(row?.fields),
    [languageCode]: normalizeEditorConflictResolutionValue(modal?.finalText),
  };
  const nextLocalFootnotes = {
    ...cloneRowFields(row?.footnotes),
    [languageCode]: normalizeEditorConflictResolutionValue(modal?.finalFootnote),
  };
  const nextLocalImageCaptions = {
    ...cloneRowFields(row?.imageCaptions),
    [languageCode]: normalizeEditorConflictResolutionValue(modal?.finalImageCaption),
  };

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
  };
}

export function buildEditorConflictResolutionVersionCopyText(modal, side) {
  const isLocal = side === "local";
  const text = normalizeEditorConflictResolutionValue(
    isLocal ? modal?.localText : modal?.remoteText,
  );
  const footnote = normalizeEditorConflictResolutionValue(
    isLocal ? modal?.localFootnote : modal?.remoteFootnote,
  );
  const imageCaption = normalizeEditorConflictResolutionValue(
    isLocal ? modal?.localImageCaption : modal?.remoteImageCaption,
  );
  if (!text && !footnote && !imageCaption) {
    return "";
  }

  const parts = [text, footnote, imageCaption].filter(Boolean);
  return parts.join("\n\n");
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
