import { rowFieldsEqual } from "./editor-row-persistence-model.js";
import { normalizeEditorRowTextStyle } from "./editor-row-text-style.js";
import {
  cloneRowFields,
  cloneRowFieldStates,
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

export function applyEditorRowFieldValue(row, languageCode, nextValue) {
  if (!row || !languageCode) {
    return row;
  }

  const fields = {
    ...cloneRowFields(row.fields),
    [languageCode]: nextValue,
  };
  const nextSaveStatus =
    row.saveStatus === "saving"
      ? "dirty"
      : row.saveStatus === "conflict"
        ? "conflict"
      : rowFieldsEqual(fields, row.persistedFields)
        ? "idle"
        : "dirty";

  return {
    ...row,
    fields,
    freshness:
      row.freshness === "conflict"
        ? "conflict"
        : row.freshness === "stale" || row.freshness === "staleDirty"
          ? "staleDirty"
          : rowFieldsEqual(fields, row.persistedFields)
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
  const rowChangedDuringSave = !rowFieldsEqual(row.fields, normalizedRow.fields);

  return {
    ...normalizedRow,
    fields: rowChangedDuringSave ? cloneRowFields(row.fields) : normalizedRow.fields,
    saveStatus: rowChangedDuringSave ? "dirty" : "idle",
    freshness: rowChangedDuringSave ? "dirty" : "fresh",
    conflictState: null,
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
    freshness: "conflict",
    saveStatus: "conflict",
    saveError: "Translation text changed on disk.",
    remotelyDeleted: false,
    conflictState: {
      baseFields: cloneRowFields(payload?.baseFields),
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

export function applyEditorConflictResolutionSavedLocally(row, payloadRow, nextLocalFields, options = {}) {
  if (!row || !payloadRow) {
    return row;
  }

  const persistedRow = normalizeEditorRow(payloadRow);
  const localFields = cloneRowFields(nextLocalFields);

  return {
    ...persistedRow,
    fields: localFields,
    baseFields: cloneRowFields(persistedRow.fields),
    persistedFields: cloneRowFields(persistedRow.fields),
    saveStatus: "conflict",
    freshness: "conflict",
    saveError: "",
    remotelyDeleted: false,
    conflictState: {
      baseFields: cloneRowFields(persistedRow.fields),
      remoteRow: row?.conflictState?.remoteRow ? normalizeEditorRow(row.conflictState.remoteRow) : null,
      remoteVersion: normalizeConflictRemoteVersion(options?.remoteVersion ?? row?.conflictState?.remoteVersion ?? null),
    },
  };
}

export function applyEditorRowConflictSaveSucceeded(row, payloadRow, nextLocalFields, options = {}) {
  if (!row || !payloadRow) {
    return row;
  }

  const remoteRow = normalizeEditorRow(payloadRow);
  const localFields = cloneRowFields(nextLocalFields);
  const mergedCodes = new Set([...Object.keys(localFields), ...Object.keys(remoteRow.fields)]);
  const hasRemainingConflict = [...mergedCodes].some((code) => (localFields?.[code] ?? "") !== (remoteRow.fields?.[code] ?? ""));

  if (!hasRemainingConflict) {
    return {
      ...remoteRow,
      fields: localFields,
      baseFields: cloneRowFields(remoteRow.fields),
      persistedFields: cloneRowFields(remoteRow.fields),
      saveStatus: "idle",
      freshness: "fresh",
      conflictState: null,
    };
  }

  return {
    ...remoteRow,
    fields: localFields,
    baseFields: cloneRowFields(remoteRow.fields),
    persistedFields: cloneRowFields(remoteRow.fields),
    saveStatus: "conflict",
    freshness: "conflict",
    saveError: "Translation text changed on disk.",
    remotelyDeleted: false,
    conflictState: {
      baseFields: cloneRowFields(remoteRow.fields),
      remoteRow,
      remoteVersion: normalizeConflictRemoteVersion(options?.remoteVersion ?? row?.conflictState?.remoteVersion ?? null),
    },
  };
}
