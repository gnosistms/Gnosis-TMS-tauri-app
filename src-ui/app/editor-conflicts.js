function normalizeConflictText(value) {
  return typeof value === "string" ? value : String(value ?? "");
}

function normalizeLanguageCode(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
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
  const localFields = row?.fields;
  if (!remoteFields || typeof remoteFields !== "object" || !localFields || typeof localFields !== "object") {
    return new Set();
  }

  const codes = new Set();
  const candidateCodes = Array.isArray(languages) && languages.length > 0
    ? languages.map((language) => normalizeLanguageCode(language?.code)).filter(Boolean)
    : [...new Set([...Object.keys(localFields), ...Object.keys(remoteFields)].filter(Boolean))];

  for (const code of candidateCodes) {
    if (normalizeConflictText(localFields?.[code]) !== normalizeConflictText(remoteFields?.[code])) {
      codes.add(code);
    }
  }

  return codes;
}

export function editorChapterHasUnresolvedConflicts(chapterState) {
  return Array.isArray(chapterState?.rows) && chapterState.rows.some((row) => rowHasUnresolvedEditorConflict(row));
}
