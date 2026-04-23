import { editorFieldImageEqual, normalizeEditorFieldImage } from "./editor-images.js";
import { normalizeEditorRow } from "./editor-state-flow.js";
import { cloneRowFields, cloneRowFieldStates, cloneRowImages, normalizeFieldState } from "./editor-utils.js";

function stringValue(map, key) {
  return typeof map?.[key] === "string" ? map[key] : String(map?.[key] ?? "");
}

function unionKeys(...maps) {
  return [...new Set(
    maps.flatMap((value) =>
      Object.keys(value && typeof value === "object" ? value : {}),
    ),
  )];
}

function mergeStringSlices(contentKind, baseMap, localMap, remoteMap) {
  const mergedMap = cloneRowFields(remoteMap);
  const conflicts = [];

  for (const languageCode of unionKeys(baseMap, localMap, remoteMap)) {
    const baseValue = stringValue(baseMap, languageCode);
    const localValue = stringValue(localMap, languageCode);
    const remoteValue = stringValue(remoteMap, languageCode);
    const localChanged = localValue !== baseValue;
    const remoteChanged = remoteValue !== baseValue;

    if (!localChanged) {
      mergedMap[languageCode] = remoteValue;
      continue;
    }

    if (!remoteChanged || localValue === remoteValue) {
      mergedMap[languageCode] = localValue;
      continue;
    }

    conflicts.push({ languageCode, contentKind });
  }

  return {
    mergedMap,
    conflicts,
  };
}

function imageValue(map, key) {
  return normalizeEditorFieldImage(map?.[key]);
}

function mergeImageSlices(baseImages, localImages, remoteImages) {
  const mergedImages = cloneRowImages(remoteImages);
  let hasUnsupportedConflict = false;

  for (const languageCode of unionKeys(baseImages, localImages, remoteImages)) {
    const baseValue = imageValue(baseImages, languageCode);
    const localValue = imageValue(localImages, languageCode);
    const remoteValue = imageValue(remoteImages, languageCode);
    const localChanged = !editorFieldImageEqual(localValue, baseValue);
    const remoteChanged = !editorFieldImageEqual(remoteValue, baseValue);

    if (!localChanged) {
      if (remoteValue) {
        mergedImages[languageCode] = remoteValue;
      } else {
        delete mergedImages[languageCode];
      }
      continue;
    }

    if (!remoteChanged || editorFieldImageEqual(localValue, remoteValue)) {
      if (localValue) {
        mergedImages[languageCode] = localValue;
      } else {
        delete mergedImages[languageCode];
      }
      continue;
    }

    hasUnsupportedConflict = true;
  }

  return {
    mergedImages,
    hasUnsupportedConflict,
  };
}

function mergeFieldStates(baseFieldStates, localFieldStates, remoteFieldStates) {
  const mergedFieldStates = cloneRowFieldStates(remoteFieldStates);
  let hasUnsupportedConflict = false;
  const candidateCodes = unionKeys(baseFieldStates, localFieldStates, remoteFieldStates);
  const flags = ["reviewed", "pleaseCheck"];

  for (const languageCode of candidateCodes) {
    const nextFieldState = normalizeFieldState(mergedFieldStates[languageCode]);
    for (const flag of flags) {
      const baseValue = normalizeFieldState(baseFieldStates?.[languageCode])[flag];
      const localValue = normalizeFieldState(localFieldStates?.[languageCode])[flag];
      const remoteValue = normalizeFieldState(remoteFieldStates?.[languageCode])[flag];
      const localChanged = localValue !== baseValue;
      const remoteChanged = remoteValue !== baseValue;

      if (!localChanged) {
        nextFieldState[flag] = remoteValue;
        continue;
      }

      if (!remoteChanged || localValue === remoteValue) {
        nextFieldState[flag] = localValue;
        continue;
      }

      hasUnsupportedConflict = true;
    }

    mergedFieldStates[languageCode] = nextFieldState;
  }

  return {
    mergedFieldStates,
    hasUnsupportedConflict,
  };
}

export function mergeEditorRowVersions(input = {}) {
  const remoteRow = input?.remoteRow ? normalizeEditorRow(input.remoteRow) : null;
  if (!remoteRow) {
    return {
      status: "missing-remote-row",
      remoteRow: null,
      conflicts: [],
    };
  }

  const fieldMerge = mergeStringSlices(
    "field",
    cloneRowFields(input?.baseFields),
    cloneRowFields(input?.localFields),
    remoteRow.fields,
  );
  const footnoteMerge = mergeStringSlices(
    "footnote",
    cloneRowFields(input?.baseFootnotes),
    cloneRowFields(input?.localFootnotes),
    remoteRow.footnotes,
  );
  const imageCaptionMerge = mergeStringSlices(
    "image-caption",
    cloneRowFields(input?.baseImageCaptions),
    cloneRowFields(input?.localImageCaptions),
    remoteRow.imageCaptions,
  );
  const imageMerge = mergeImageSlices(
    cloneRowImages(input?.baseImages),
    cloneRowImages(input?.localImages),
    remoteRow.images,
  );
  const fieldStateMerge = mergeFieldStates(
    cloneRowFieldStates(input?.baseFieldStates),
    cloneRowFieldStates(input?.localFieldStates),
    remoteRow.fieldStates,
  );

  const conflicts = [
    ...fieldMerge.conflicts,
    ...footnoteMerge.conflicts,
    ...imageCaptionMerge.conflicts,
  ];
  if (conflicts.length > 0) {
    return {
      status: "conflict",
      remoteRow,
      conflicts,
    };
  }

  if (imageMerge.hasUnsupportedConflict || fieldStateMerge.hasUnsupportedConflict) {
    return {
      status: "unsupported",
      remoteRow,
      conflicts: [],
    };
  }

  return {
    status: "merged",
    remoteRow,
    mergedFields: fieldMerge.mergedMap,
    mergedFootnotes: footnoteMerge.mergedMap,
    mergedImageCaptions: imageCaptionMerge.mergedMap,
    mergedImages: imageMerge.mergedImages,
    mergedFieldStates: fieldStateMerge.mergedFieldStates,
    conflicts: [],
  };
}

export function mergeDirtyEditorRowWithRemote(row, remoteRow) {
  return mergeEditorRowVersions({
    baseFields: row?.baseFields,
    baseFootnotes: row?.baseFootnotes,
    baseImageCaptions: row?.baseImageCaptions,
    baseImages: row?.baseImages ?? row?.persistedImages,
    baseFieldStates: row?.persistedFieldStates,
    localFields: row?.fields,
    localFootnotes: row?.footnotes,
    localImageCaptions: row?.imageCaptions,
    localImages: row?.images,
    localFieldStates: row?.fieldStates,
    remoteRow,
  });
}
