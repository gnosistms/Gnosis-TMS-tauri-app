import { rowTextContentEqual } from "./editor-row-persistence-model.js";
import { normalizeEditorRowTextStyle } from "./editor-row-text-style.js";
import {
  cloneRowFields,
  cloneRowFieldStates,
  cloneRowImages,
  normalizeEditorContentKind,
  normalizeFieldState,
} from "./editor-utils.js";
import { normalizeEditorRow } from "./editor-state-flow.js";

function normalizeConflictRemoteVersion(remoteVersion) {
  if (!remoteVersion || typeof remoteVersion !== "object") {
    return null;
  }

  const authorName =
    typeof remoteVersion.authorName === "string" && remoteVersion.authorName.trim()
      ? remoteVersion.authorName
      : "";
  const committedAt =
    typeof remoteVersion.committedAt === "string" && remoteVersion.committedAt.trim()
      ? remoteVersion.committedAt
      : "";
  const commitSha =
    typeof remoteVersion.commitSha === "string" && remoteVersion.commitSha.trim()
      ? remoteVersion.commitSha
      : "";

  if (!authorName && !committedAt && !commitSha) {
    return null;
  }

  return {
    authorName,
    committedAt,
    commitSha,
  };
}

export function applyEditorRowFieldValue(row, languageCode, nextValue, contentKind = "field") {
  if (!row || !languageCode) {
    return row;
  }

  const normalizedContentKind = normalizeEditorContentKind(contentKind);
  const fields = cloneRowFields(row.fields);
  const footnotes = cloneRowFields(row.footnotes);
  const imageCaptions = cloneRowFields(row.imageCaptions);
  if (normalizedContentKind === "footnote") {
    footnotes[languageCode] = nextValue;
  } else if (normalizedContentKind === "image-caption") {
    imageCaptions[languageCode] = nextValue;
  } else {
    fields[languageCode] = nextValue;
  }
  const nextSaveStatus =
    row.saveStatus === "saving"
      ? "dirty"
      : row.saveStatus === "conflict"
        ? "conflict"
      : rowTextContentEqual(
          fields,
          footnotes,
          imageCaptions,
          row.persistedFields,
          row.persistedFootnotes,
          row.persistedImageCaptions,
          row.images,
          row.persistedImages,
        )
        ? "idle"
        : "dirty";

  return {
    ...row,
    fields,
    footnotes,
    imageCaptions,
    freshness:
      row.freshness === "conflict"
        ? "conflict"
        : row.freshness === "stale" || row.freshness === "staleDirty"
          ? "staleDirty"
          : rowTextContentEqual(
              fields,
              footnotes,
              imageCaptions,
              row.persistedFields,
              row.persistedFootnotes,
              row.persistedImageCaptions,
              row.images,
              row.persistedImages,
            )
            ? "fresh"
            : "dirty",
    saveStatus: nextSaveStatus,
    saveError: "",
  };
}

export function applyEditorRowMarkerSaving(row, languageCode, kind, nextFieldState) {
  if (!row || !languageCode || !kind) {
    return row;
  }

  return {
    ...row,
    fieldStates: {
      ...cloneRowFieldStates(row.fieldStates),
      [languageCode]: normalizeFieldState(nextFieldState),
    },
    markerSaveState: {
      status: "saving",
      languageCode,
      kind,
      error: "",
    },
  };
}

export function applyEditorRowMarkerSaved(row, languageCode, payload) {
  if (!row || !languageCode) {
    return row;
  }

  const nextFieldState = normalizeFieldState({
    reviewed: payload?.reviewed,
    pleaseCheck: payload?.pleaseCheck,
  });

  return {
    ...row,
    fieldStates: {
      ...cloneRowFieldStates(row.fieldStates),
      [languageCode]: nextFieldState,
    },
    persistedFieldStates: {
      ...cloneRowFieldStates(row.persistedFieldStates),
      [languageCode]: nextFieldState,
    },
    markerSaveState: {
      status: "idle",
      languageCode: null,
      kind: null,
      error: "",
    },
  };
}

export function applyEditorRowMarkerSaveFailed(row, languageCode, previousFieldState, message = "") {
  if (!row || !languageCode) {
    return row;
  }

  return {
    ...row,
    fieldStates: {
      ...cloneRowFieldStates(row.fieldStates),
      [languageCode]: normalizeFieldState(previousFieldState),
    },
    markerSaveState: {
      status: "idle",
      languageCode: null,
      kind: null,
      error: message,
    },
  };
}

export function applyEditorRowTextStyleSaving(row, nextTextStyle) {
  if (!row) {
    return row;
  }

  return {
    ...row,
    textStyle: normalizeEditorRowTextStyle(nextTextStyle),
    textStyleSaveState: {
      status: "saving",
      error: "",
    },
  };
}

export function applyEditorRowTextStyleSaved(row, textStyle) {
  if (!row) {
    return row;
  }

  return {
    ...row,
    textStyle: normalizeEditorRowTextStyle(textStyle),
    textStyleSaveState: {
      status: "idle",
      error: "",
    },
  };
}

export function applyEditorRowTextStyleSaveFailed(row, previousTextStyle, message = "") {
  if (!row) {
    return row;
  }

  return {
    ...row,
    textStyle: normalizeEditorRowTextStyle(previousTextStyle),
    textStyleSaveState: {
      status: "idle",
      error: message,
    },
  };
}

export function applyEditorRowPersistRequested(row) {
  if (!row) {
    return row;
  }

  return {
    ...row,
    saveStatus: "saving",
    saveError: "",
  };
}

export function applyEditorRowPersistQueuedWhileSaving(row) {
  if (!row || row.saveStatus !== "saving") {
    return row;
  }

  return {
    ...row,
    saveStatus: "dirty",
  };
}

export function applyEditorRowPersistReset(row) {
  if (!row) {
    return row;
  }

  return {
    ...row,
    saveStatus: row.freshness === "conflict" ? "conflict" : "idle",
    saveError: "",
  };
}

export function applyEditorRowPersistSucceeded(row, payloadRow) {
  if (!row || !payloadRow) {
    return row;
  }

  const normalizedRow = normalizeEditorRow(payloadRow);
  const rowChangedDuringSave = !rowTextContentEqual(
    row.fields,
    row.footnotes,
    row.imageCaptions,
    normalizedRow.fields,
    normalizedRow.footnotes,
    normalizedRow.imageCaptions,
  );

  return {
    ...normalizedRow,
    fields: rowChangedDuringSave ? cloneRowFields(row.fields) : normalizedRow.fields,
    footnotes: rowChangedDuringSave ? cloneRowFields(row.footnotes) : normalizedRow.footnotes,
    imageCaptions: rowChangedDuringSave ? cloneRowFields(row.imageCaptions) : normalizedRow.imageCaptions,
    saveStatus: rowChangedDuringSave ? "dirty" : "idle",
    freshness: rowChangedDuringSave ? "dirty" : "fresh",
    conflictState: null,
  };
}

export function applyEditorRowImageSaved(row, payloadRow) {
  if (!row || !payloadRow) {
    return row;
  }

  const normalizedRow = normalizeEditorRow(payloadRow);
  const textChangedLocally = !rowTextContentEqual(
    row.fields,
    row.footnotes,
    row.imageCaptions,
    row.persistedFields,
    row.persistedFootnotes,
    row.persistedImageCaptions,
  );
  if (!textChangedLocally) {
    return {
      ...normalizedRow,
      conflictState: row?.conflictState ?? null,
    };
  }

  return {
    ...normalizedRow,
    fields: cloneRowFields(row.fields),
    footnotes: cloneRowFields(row.footnotes),
    imageCaptions: cloneRowFields(row.imageCaptions),
    saveStatus: row.saveStatus === "idle" ? "dirty" : row.saveStatus,
    saveError: row.saveStatus === "idle" ? "" : row.saveError,
    freshness:
      row.freshness === "stale" || row.freshness === "staleDirty"
        ? "staleDirty"
        : row.freshness === "fresh"
          ? "dirty"
          : row.freshness,
    conflictState: row?.conflictState ?? null,
  };
}

export function applyEditorRowPersistFailed(row, message = "") {
  if (!row) {
    return row;
  }

  return {
    ...row,
    saveStatus: "error",
    saveError: message,
  };
}

export function applyEditorRowConflictDetected(row, payload = {}, options = {}) {
  if (!row) {
    return row;
  }

  const nextFields = cloneRowFields(options?.localFields ?? row.fields);
  const nextFootnotes = cloneRowFields(options?.localFootnotes ?? row.footnotes);
  const nextImageCaptions = cloneRowFields(options?.localImageCaptions ?? row.imageCaptions);
  const remoteVersion =
    normalizeConflictRemoteVersion(
      payload?.conflictRemoteVersion
      ?? payload?.remoteVersion
      ?? options?.remoteVersion
      ?? row?.conflictState?.remoteVersion
      ?? null,
    );

  return {
    ...row,
    fields: nextFields,
    footnotes: nextFootnotes,
    imageCaptions: nextImageCaptions,
    freshness: "conflict",
    saveStatus: "conflict",
    saveError: "Translation text changed on disk.",
    remotelyDeleted: false,
    conflictState: {
      baseFields: cloneRowFields(payload?.baseFields),
      baseFootnotes: cloneRowFields(payload?.baseFootnotes),
      baseImageCaptions: cloneRowFields(payload?.baseImageCaptions),
      remoteRow: payload?.row ? normalizeEditorRow(payload.row) : null,
      remoteVersion,
    },
  };
}

export function applyEditorRowConflictResolvedWithRemote(row) {
  if (!row?.conflictState?.remoteRow) {
    return row;
  }

  return {
    ...normalizeEditorRow(row.conflictState.remoteRow),
    conflictState: null,
  };
}

export function applyEditorConflictResolutionSavedLocally(
  row,
  payloadRow,
  nextLocalFields,
  nextLocalFootnotes,
  nextLocalImageCaptions,
  options = {},
) {
  if (!row || !payloadRow) {
    return row;
  }

  const persistedRow = normalizeEditorRow(payloadRow);
  const localFields = cloneRowFields(nextLocalFields);
  const localFootnotes = cloneRowFields(nextLocalFootnotes);
  const localImageCaptions = cloneRowFields(nextLocalImageCaptions);

  return {
    ...persistedRow,
    fields: localFields,
    footnotes: localFootnotes,
    imageCaptions: localImageCaptions,
    baseFields: cloneRowFields(persistedRow.fields),
    baseFootnotes: cloneRowFields(persistedRow.footnotes),
    baseImageCaptions: cloneRowFields(persistedRow.imageCaptions),
    persistedFields: cloneRowFields(persistedRow.fields),
    persistedFootnotes: cloneRowFields(persistedRow.footnotes),
    persistedImageCaptions: cloneRowFields(persistedRow.imageCaptions),
    saveStatus: "conflict",
    freshness: "conflict",
    saveError: "",
    remotelyDeleted: false,
    conflictState: {
      baseFields: cloneRowFields(persistedRow.fields),
      baseFootnotes: cloneRowFields(persistedRow.footnotes),
      baseImageCaptions: cloneRowFields(persistedRow.imageCaptions),
      remoteRow: row?.conflictState?.remoteRow ? normalizeEditorRow(row.conflictState.remoteRow) : null,
      remoteVersion: normalizeConflictRemoteVersion(options?.remoteVersion ?? row?.conflictState?.remoteVersion ?? null),
    },
  };
}

export function applyEditorRowConflictSaveSucceeded(
  row,
  payloadRow,
  nextLocalFields,
  nextLocalFootnotes,
  nextLocalImageCaptions,
  options = {},
) {
  if (!row || !payloadRow) {
    return row;
  }

  const remoteRow = normalizeEditorRow(payloadRow);
  const localFields = cloneRowFields(nextLocalFields);
  const localFootnotes = cloneRowFields(nextLocalFootnotes);
  const localImageCaptions = cloneRowFields(nextLocalImageCaptions);
  const hasRemainingConflict = !rowTextContentEqual(
    localFields,
    localFootnotes,
    localImageCaptions,
    remoteRow.fields,
    remoteRow.footnotes,
    remoteRow.imageCaptions,
  );

  if (!hasRemainingConflict) {
    return {
      ...remoteRow,
      fields: localFields,
      footnotes: localFootnotes,
      imageCaptions: localImageCaptions,
      baseFields: cloneRowFields(remoteRow.fields),
      baseFootnotes: cloneRowFields(remoteRow.footnotes),
      baseImageCaptions: cloneRowFields(remoteRow.imageCaptions),
      persistedFields: cloneRowFields(remoteRow.fields),
      persistedFootnotes: cloneRowFields(remoteRow.footnotes),
      persistedImageCaptions: cloneRowFields(remoteRow.imageCaptions),
      saveStatus: "idle",
      freshness: "fresh",
      conflictState: null,
    };
  }

  return {
    ...remoteRow,
    fields: localFields,
    footnotes: localFootnotes,
    imageCaptions: localImageCaptions,
    baseFields: cloneRowFields(remoteRow.fields),
    baseFootnotes: cloneRowFields(remoteRow.footnotes),
    baseImageCaptions: cloneRowFields(remoteRow.imageCaptions),
    persistedFields: cloneRowFields(remoteRow.fields),
    persistedFootnotes: cloneRowFields(remoteRow.footnotes),
    persistedImageCaptions: cloneRowFields(remoteRow.imageCaptions),
    saveStatus: "conflict",
    freshness: "conflict",
    saveError: "Translation text changed on disk.",
    remotelyDeleted: false,
    conflictState: {
      baseFields: cloneRowFields(remoteRow.fields),
      baseFootnotes: cloneRowFields(remoteRow.footnotes),
      baseImageCaptions: cloneRowFields(remoteRow.imageCaptions),
      remoteRow,
      remoteVersion: normalizeConflictRemoteVersion(options?.remoteVersion ?? row?.conflictState?.remoteVersion ?? null),
    },
  };
}
