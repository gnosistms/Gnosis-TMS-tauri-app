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
    remoteVersion: row?.conflictState?.remoteVersion ?? null,
  };
}

export function buildEditorConflictResolutionSaveState(row, languageCode, modal) {
  const remoteFields = cloneRowFields(row?.conflictState?.remoteRow?.fields);
  const remoteFootnotes = cloneRowFields(row?.conflictState?.remoteRow?.footnotes);
  const nextLocalFields = {
    ...cloneRowFields(row?.fields),
    [languageCode]: normalizeEditorConflictResolutionValue(modal?.finalText),
  };
  const nextLocalFootnotes = {
    ...cloneRowFields(row?.footnotes),
    [languageCode]: normalizeEditorConflictResolutionValue(modal?.finalFootnote),
  };

  return {
    remoteFields,
    remoteFootnotes,
    nextLocalFields,
    nextLocalFootnotes,
    fieldsToPersist: {
      ...remoteFields,
      [languageCode]: nextLocalFields[languageCode] ?? "",
    },
    footnotesToPersist: {
      ...remoteFootnotes,
      [languageCode]: nextLocalFootnotes[languageCode] ?? "",
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
  if (!text && !footnote) {
    return "";
  }

  return footnote ? `${text}${text ? "\n\n" : ""}${footnote}` : text;
}

export function editorConflictResolutionShowsFootnotes(modal) {
  const footnotes = [
    modal?.localFootnote,
    modal?.remoteFootnote,
    modal?.finalFootnote,
  ].map((value) => normalizeEditorConflictResolutionValue(value));

  return footnotes.some((footnote) => footnote.trim().length > 0) || new Set(footnotes).size > 1;
}
