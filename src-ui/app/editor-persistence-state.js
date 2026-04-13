import { rowFieldsEqual } from "./editor-row-persistence-model.js";
import {
  cloneRowFields,
  cloneRowFieldStates,
  normalizeFieldState,
} from "./editor-utils.js";
import { normalizeEditorRow } from "./editor-state-flow.js";

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

export function applyEditorRowConflictDetected(row, payload = {}) {
  if (!row) {
    return row;
  }

  return {
    ...row,
    freshness: "conflict",
    saveStatus: "conflict",
    saveError: "Translation text changed on disk.",
    remotelyDeleted: false,
    conflictState: {
      baseFields: cloneRowFields(payload?.baseFields),
      remoteRow: payload?.row ? normalizeEditorRow(payload.row) : null,
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
