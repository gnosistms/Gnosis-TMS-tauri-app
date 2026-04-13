import { rowFieldsEqual } from "./editor-row-persistence-model.js";
import {
  cloneRowFields,
  cloneRowFieldStates,
  normalizeFieldState,
} from "./editor-utils.js";

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
      : rowFieldsEqual(fields, row.persistedFields)
        ? "idle"
        : "dirty";

  return {
    ...row,
    fields,
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
    saveStatus: "idle",
    saveError: "",
  };
}

export function applyEditorRowPersistSucceeded(row, fieldsToPersist) {
  if (!row) {
    return row;
  }

  const persistedFields = cloneRowFields(fieldsToPersist);
  const rowChangedDuringSave = !rowFieldsEqual(row.fields, fieldsToPersist);

  return {
    ...row,
    persistedFields,
    saveStatus: rowChangedDuringSave ? "dirty" : "idle",
    saveError: "",
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
