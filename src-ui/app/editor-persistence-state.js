import { mergeEditorRowVersions } from "./editor-row-merge.js";
import { rowHasPersistedChanges, rowTextContentEqual } from "./editor-row-persistence-model.js";
import { normalizeEditorRowTextStyle } from "./editor-row-text-style.js";
import {
  cloneRowFields,
  cloneRowFieldStates,
  cloneRowFootnotes,
  cloneRowImages,
  normalizeEditorContentKind,
  normalizeFieldState,
} from "./editor-utils.js";
import { applyEditorFootnoteText } from "./editor-footnotes.js";
import { normalizeEditorRow } from "./editor-state-flow.js";
import { cloneRowTimings, rowTimingsEqual } from "./editor-timing.js";

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

export function applyEditorRowFieldValue(row, languageCode, nextValue, contentKind = "field", options = {}) {
  if (!row || !languageCode) {
    return row;
  }

  const normalizedContentKind = normalizeEditorContentKind(contentKind);
  const fields = cloneRowFields(row.fields);
  const footnotes = cloneRowFootnotes(row.footnotes);
  const imageCaptions = cloneRowFields(row.imageCaptions);
  const attributions = cloneRowFields(row.attributions);
  if (normalizedContentKind === "footnote") {
    footnotes[languageCode] = applyEditorFootnoteText(
      footnotes[languageCode],
      options?.marker,
      nextValue,
    );
  } else if (normalizedContentKind === "attribution") {
    attributions[languageCode] = nextValue;
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
          attributions,
          row.persistedAttributions,
        )
        ? "idle"
        : "dirty";

  return {
    ...row,
    fields,
    footnotes,
    imageCaptions,
    attributions,
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
              attributions,
              row.persistedAttributions,
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
    lastUpdate: payload?.lastUpdate ?? row.lastUpdate ?? null,
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

  const persistedTextStyle = normalizeEditorRowTextStyle(row.persistedTextStyle ?? row.textStyle);
  const textStyle = normalizeEditorRowTextStyle(nextTextStyle);
  return {
    ...row,
    textStyle,
    persistedTextStyle,
    textStyleSaveState: {
      status: "saving",
      textStyle,
      persistedTextStyle,
      error: "",
    },
  };
}

export function applyEditorRowTextStyleStaleSaved(row, payload) {
  if (!row) {
    return row;
  }
  const textStyle = normalizeEditorRowTextStyle(
    payload && typeof payload === "object" ? payload.textStyle : payload,
  );

  return {
    ...applyEditorRowTextStyleSaved(row, payload),
    textStyle: row.textStyle,
    persistedTextStyle: textStyle,
    lastUpdate: payload?.lastUpdate ?? row.lastUpdate ?? null,
    textStyleSaveState: {
      ...(row.textStyleSaveState ?? {}),
      status: row.textStyleSaveState?.status === "saving" ? "saving" : "idle",
      persistedTextStyle: textStyle,
      error: "",
    },
  };
}

export function applyEditorRowTextStyleSaved(row, payload) {
  if (!row) {
    return row;
  }
  const textStyle = payload && typeof payload === "object" ? payload.textStyle : payload;
  const normalizedTextStyle = normalizeEditorRowTextStyle(textStyle);

  const converted = row.persistedTextStyle === "quote" && normalizedTextStyle !== "quote";
  const fields = cloneRowFields(row.fields);
  const attributions = cloneRowFields(row.attributions);
  if (converted) {
    for (const [code, attribution] of Object.entries(attributions)) {
      if (attribution) fields[code] = fields[code] ? `${fields[code].trimEnd()}\n\n${attribution}` : attribution;
      attributions[code] = "";
    }
  }
  // The command reads the latest disk row. Adopt its text for untouched columns;
  // retain any typing that happened while the style write was in flight.
  for (const [code, text] of Object.entries(payload?.fields ?? {})) {
    if ((row.fields?.[code] ?? "") === (row.persistedFields?.[code] ?? "")) fields[code] = text;
  }
  for (const [code, text] of Object.entries(payload?.attributions ?? {})) {
    if ((row.attributions?.[code] ?? "") === (row.persistedAttributions?.[code] ?? "")) attributions[code] = text;
  }
  return {
    ...row,
    fields,
    attributions,
    ...(payload?.fields ? {
      baseFields: cloneRowFields(payload.fields),
      persistedFields: cloneRowFields(payload.fields),
      baseAttributions: cloneRowFields(payload.attributions),
      persistedAttributions: cloneRowFields(payload.attributions),
    } : {}),
    textStyle: normalizedTextStyle,
    persistedTextStyle: normalizedTextStyle,
    lastUpdate: payload?.lastUpdate ?? row.lastUpdate ?? null,
    textStyleSaveState: {
      status: "idle",
      textStyle: null,
      persistedTextStyle: normalizedTextStyle,
      error: "",
    },
  };
}

export function applyEditorRowTextStyleSaveFailed(row, previousTextStyle, message = "") {
  if (!row) {
    return row;
  }
  const rollbackTextStyle = normalizeEditorRowTextStyle(previousTextStyle ?? row.persistedTextStyle ?? row.textStyle);
  const persistedTextStyle = normalizeEditorRowTextStyle(row.persistedTextStyle ?? rollbackTextStyle);

  return {
    ...row,
    textStyle: rollbackTextStyle,
    persistedTextStyle,
    textStyleSaveState: {
      status: "idle",
      textStyle: null,
      persistedTextStyle,
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

function buildMergedRowState(remoteRow, mergeResult) {
  const mergedRow = {
    ...remoteRow,
    fields: cloneRowFields(mergeResult?.mergedFields ?? remoteRow.fields),
    footnotes: cloneRowFootnotes(mergeResult?.mergedFootnotes ?? remoteRow.footnotes),
    imageCaptions: cloneRowFields(mergeResult?.mergedImageCaptions ?? remoteRow.imageCaptions),
    attributions: cloneRowFields(mergeResult?.mergedAttributions ?? remoteRow.attributions),
    images: cloneRowImages(mergeResult?.mergedImages ?? remoteRow.images),
    fieldStates: cloneRowFieldStates(mergeResult?.mergedFieldStates ?? remoteRow.fieldStates),
    baseFields: cloneRowFields(remoteRow.fields),
    baseFootnotes: cloneRowFootnotes(remoteRow.footnotes),
    baseImageCaptions: cloneRowFields(remoteRow.imageCaptions),
    baseAttributions: cloneRowFields(remoteRow.attributions),
    baseImages: cloneRowImages(remoteRow.images),
    persistedFields: cloneRowFields(remoteRow.fields),
    persistedFootnotes: cloneRowFootnotes(remoteRow.footnotes),
    persistedImageCaptions: cloneRowFields(remoteRow.imageCaptions),
    persistedAttributions: cloneRowFields(remoteRow.attributions),
    persistedImages: cloneRowImages(remoteRow.images),
    persistedFieldStates: cloneRowFieldStates(remoteRow.fieldStates),
    saveError: "",
    remotelyDeleted: false,
    conflictState: null,
  };
  const hasUnsavedTextChanges = !rowTextContentEqual(
    mergedRow.fields,
    mergedRow.footnotes,
    mergedRow.imageCaptions,
    mergedRow.persistedFields,
    mergedRow.persistedFootnotes,
    mergedRow.persistedImageCaptions,
    mergedRow.images,
    mergedRow.persistedImages,
    mergedRow.attributions,
    mergedRow.persistedAttributions,
  );

  return {
    ...mergedRow,
    saveStatus: hasUnsavedTextChanges ? "dirty" : "idle",
    freshness: rowHasPersistedChanges(mergedRow) ? "dirty" : "fresh",
  };
}

function preservePendingTextStyle(nextRow, previousRow) {
  if (!nextRow || previousRow?.textStyleSaveState?.status !== "saving") {
    return nextRow;
  }

  const persistedTextStyle = normalizeEditorRowTextStyle(nextRow.persistedTextStyle ?? nextRow.textStyle);
  return {
    ...nextRow,
    textStyle: normalizeEditorRowTextStyle(previousRow.textStyle),
    persistedTextStyle,
    textStyleSaveState: {
      ...previousRow.textStyleSaveState,
      status: "saving",
      persistedTextStyle,
      error: "",
    },
  };
}

function preservePendingMarker(nextRow, previousRow) {
  if (!nextRow || previousRow?.markerSaveState?.status !== "saving") {
    return nextRow;
  }

  const languageCode =
    typeof previousRow.markerSaveState.languageCode === "string"
      ? previousRow.markerSaveState.languageCode
      : "";
  if (!languageCode) {
    return nextRow;
  }

  return {
    ...nextRow,
    fieldStates: {
      ...cloneRowFieldStates(nextRow.fieldStates),
      [languageCode]: normalizeFieldState(previousRow.fieldStates?.[languageCode]),
    },
    markerSaveState: {
      ...previousRow.markerSaveState,
      status: "saving",
      error: "",
    },
  };
}

function preservePendingRowWrites(nextRow, previousRow) {
  return preservePendingMarker(preservePendingTextStyle(nextRow, previousRow), previousRow);
}

export function applyEditorRowMergedWithRemote(row, payloadRow, mergeResult) {
  if (!row || !payloadRow || mergeResult?.status !== "merged") {
    return row;
  }

  const remoteRow = normalizeEditorRow(payloadRow);
  return preservePendingRowWrites(buildMergedRowState(remoteRow, mergeResult), row);
}

export function applyEditorRowPersistSucceeded(row, payloadRow, persistedSnapshot = null) {
  if (!row || !payloadRow) {
    return row;
  }

  const normalizedRow = normalizeEditorRow(payloadRow);
  const hasPersistedSnapshot = persistedSnapshot && typeof persistedSnapshot === "object";
  const snapshotFields = cloneRowFields(persistedSnapshot?.fields ?? row.fields);
  const snapshotFootnotes = cloneRowFootnotes(persistedSnapshot?.footnotes ?? row.footnotes);
  const snapshotImageCaptions = cloneRowFields(persistedSnapshot?.imageCaptions ?? row.imageCaptions);
  const snapshotAttributions = cloneRowFields(persistedSnapshot?.attributions ?? row.attributions);
  const snapshotImages = cloneRowImages(persistedSnapshot?.images ?? row.images);
  const snapshotTimings = cloneRowTimings(persistedSnapshot?.timings ?? row.timings);
  const timingsChangedDuringSave = !rowTimingsEqual(row.timings, snapshotTimings);
  const rowChangedDuringSave = timingsChangedDuringSave || !rowTextContentEqual(
    row.fields,
    row.footnotes,
    row.imageCaptions,
    snapshotFields,
    snapshotFootnotes,
    snapshotImageCaptions,
    row.images,
    snapshotImages,
    row.attributions,
    snapshotAttributions,
  );
  if (rowChangedDuringSave) {
    const mergeResult = mergeEditorRowVersions({
      baseFields: snapshotFields,
      baseFootnotes: snapshotFootnotes,
      baseImageCaptions: snapshotImageCaptions,
      baseAttributions: snapshotAttributions,
      baseImages: snapshotImages,
      baseFieldStates: row.persistedFieldStates,
      localFields: row.fields,
      localFootnotes: row.footnotes,
      localImageCaptions: row.imageCaptions,
      localAttributions: row.attributions,
      localImages: row.images,
      localFieldStates: row.fieldStates,
      remoteRow: normalizedRow,
    });
    if (mergeResult.status === "merged") {
      const mergedRow = buildMergedRowState(normalizedRow, mergeResult);
      // Timing edited while the save was in flight: keep the newer local
      // override (it re-persists via the dirty check) instead of the saved one.
      return preservePendingRowWrites(
        timingsChangedDuringSave
          ? { ...mergedRow, timings: cloneRowTimings(row.timings) }
          : mergedRow,
        row,
      );
    }
  }

  if (!rowChangedDuringSave) {
    const savedFields = hasPersistedSnapshot ? snapshotFields : normalizedRow.fields;
    const savedFootnotes = hasPersistedSnapshot ? snapshotFootnotes : normalizedRow.footnotes;
    const savedImageCaptions = hasPersistedSnapshot ? snapshotImageCaptions : normalizedRow.imageCaptions;
    const savedAttributions = hasPersistedSnapshot ? snapshotAttributions : normalizedRow.attributions;
    const savedImages = hasPersistedSnapshot ? snapshotImages : normalizedRow.images;
    return preservePendingRowWrites({
      ...normalizedRow,
      fields: cloneRowFields(savedFields),
      footnotes: cloneRowFootnotes(savedFootnotes),
      imageCaptions: cloneRowFields(savedImageCaptions),
      attributions: cloneRowFields(savedAttributions),
      images: cloneRowImages(savedImages),
      baseFields: cloneRowFields(savedFields),
      baseFootnotes: cloneRowFootnotes(savedFootnotes),
      baseImageCaptions: cloneRowFields(savedImageCaptions),
      baseAttributions: cloneRowFields(savedAttributions),
      baseImages: cloneRowImages(savedImages),
      persistedFields: cloneRowFields(savedFields),
      persistedFootnotes: cloneRowFootnotes(savedFootnotes),
      persistedImageCaptions: cloneRowFields(savedImageCaptions),
      persistedAttributions: cloneRowFields(savedAttributions),
      persistedImages: cloneRowImages(savedImages),
      saveStatus: "idle",
      freshness: "fresh",
      conflictState: null,
    }, row);
  }

  return preservePendingRowWrites({
    ...normalizedRow,
    fields: cloneRowFields(row.fields),
    footnotes: cloneRowFootnotes(row.footnotes),
    imageCaptions: cloneRowFields(row.imageCaptions),
    attributions: cloneRowFields(row.attributions),
    timings: cloneRowTimings(row.timings),
    saveStatus: "dirty",
    freshness: "dirty",
    conflictState: null,
  }, row);
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
    {},
    {},
    row.attributions,
    row.persistedAttributions,
  );
  if (!textChangedLocally) {
    return preservePendingRowWrites({
      ...normalizedRow,
      conflictState: row?.conflictState ?? null,
    }, row);
  }

  return preservePendingRowWrites({
    ...normalizedRow,
    fields: cloneRowFields(row.fields),
    footnotes: cloneRowFootnotes(row.footnotes),
    imageCaptions: cloneRowFields(row.imageCaptions),
    attributions: cloneRowFields(row.attributions),
    saveStatus: row.saveStatus === "idle" ? "dirty" : row.saveStatus,
    saveError: row.saveStatus === "idle" ? "" : row.saveError,
    freshness:
      row.freshness === "stale" || row.freshness === "staleDirty"
        ? "staleDirty"
        : row.freshness === "fresh"
          ? "dirty"
          : row.freshness,
    conflictState: row?.conflictState ?? null,
  }, row);
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
  const nextFootnotes = cloneRowFootnotes(options?.localFootnotes ?? row.footnotes);
  const nextImageCaptions = cloneRowFields(options?.localImageCaptions ?? row.imageCaptions);
  const nextAttributions = cloneRowFields(options?.localAttributions ?? row.attributions);
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
    attributions: nextAttributions,
    freshness: "conflict",
    saveStatus: "conflict",
    saveError: "Translation text changed on disk.",
    remotelyDeleted: false,
    conflictState: {
      baseFields: cloneRowFields(payload?.baseFields),
      baseFootnotes: cloneRowFootnotes(payload?.baseFootnotes),
      baseImageCaptions: cloneRowFields(payload?.baseImageCaptions),
      baseAttributions: cloneRowFields(payload?.baseAttributions),
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
  const localFootnotes = cloneRowFootnotes(nextLocalFootnotes);
  const localImageCaptions = cloneRowFields(nextLocalImageCaptions);
  const localAttributions = cloneRowFields(options?.nextLocalAttributions ?? row.attributions);

  return {
    ...persistedRow,
    fields: localFields,
    footnotes: localFootnotes,
    imageCaptions: localImageCaptions,
    attributions: localAttributions,
    baseFields: cloneRowFields(persistedRow.fields),
    baseFootnotes: cloneRowFootnotes(persistedRow.footnotes),
    baseImageCaptions: cloneRowFields(persistedRow.imageCaptions),
    baseAttributions: cloneRowFields(persistedRow.attributions),
    persistedFields: cloneRowFields(persistedRow.fields),
    persistedFootnotes: cloneRowFootnotes(persistedRow.footnotes),
    persistedImageCaptions: cloneRowFields(persistedRow.imageCaptions),
    persistedAttributions: cloneRowFields(persistedRow.attributions),
    saveStatus: "conflict",
    freshness: "conflict",
    saveError: "",
    remotelyDeleted: false,
    conflictState: {
      baseFields: cloneRowFields(persistedRow.fields),
      baseFootnotes: cloneRowFootnotes(persistedRow.footnotes),
      baseImageCaptions: cloneRowFields(persistedRow.imageCaptions),
      baseAttributions: cloneRowFields(persistedRow.attributions),
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
  const localFootnotes = cloneRowFootnotes(nextLocalFootnotes);
  const localImageCaptions = cloneRowFields(nextLocalImageCaptions);
  const localAttributions = cloneRowFields(options?.nextLocalAttributions ?? row.attributions);
  const hasRemainingConflict = !rowTextContentEqual(
    localFields,
    localFootnotes,
    localImageCaptions,
    remoteRow.fields,
    remoteRow.footnotes,
    remoteRow.imageCaptions,
    {},
    {},
    localAttributions,
    remoteRow.attributions,
  );

  if (!hasRemainingConflict) {
    return {
      ...remoteRow,
      fields: localFields,
      footnotes: localFootnotes,
      imageCaptions: localImageCaptions,
      attributions: localAttributions,
      baseFields: cloneRowFields(remoteRow.fields),
      baseFootnotes: cloneRowFootnotes(remoteRow.footnotes),
      baseImageCaptions: cloneRowFields(remoteRow.imageCaptions),
      baseAttributions: cloneRowFields(remoteRow.attributions),
      persistedFields: cloneRowFields(remoteRow.fields),
      persistedFootnotes: cloneRowFootnotes(remoteRow.footnotes),
      persistedImageCaptions: cloneRowFields(remoteRow.imageCaptions),
      persistedAttributions: cloneRowFields(remoteRow.attributions),
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
    attributions: localAttributions,
    baseFields: cloneRowFields(remoteRow.fields),
    baseFootnotes: cloneRowFootnotes(remoteRow.footnotes),
    baseImageCaptions: cloneRowFields(remoteRow.imageCaptions),
    baseAttributions: cloneRowFields(remoteRow.attributions),
    persistedFields: cloneRowFields(remoteRow.fields),
    persistedFootnotes: cloneRowFootnotes(remoteRow.footnotes),
    persistedImageCaptions: cloneRowFields(remoteRow.imageCaptions),
    persistedAttributions: cloneRowFields(remoteRow.attributions),
    saveStatus: "conflict",
    freshness: "conflict",
    saveError: "Translation text changed on disk.",
    remotelyDeleted: false,
    conflictState: {
      baseFields: cloneRowFields(remoteRow.fields),
      baseFootnotes: cloneRowFootnotes(remoteRow.footnotes),
      baseImageCaptions: cloneRowFields(remoteRow.imageCaptions),
      baseAttributions: cloneRowFields(remoteRow.attributions),
      remoteRow,
      remoteVersion: normalizeConflictRemoteVersion(options?.remoteVersion ?? row?.conflictState?.remoteVersion ?? null),
    },
  };
}
