// Keep response validation independent of provider and UI state. A partial or
// ambiguous cue assignment must never become a partial sentence write.
export function srtGroupSnapshot(members) {
  return JSON.stringify(members.map((row) => [row.rowId, row.fields, row.footnotes, row.imageCaptions,
    row.lifecycleState ?? "active", row.freshness ?? "fresh"]));
}

export function validSrtGroupAiResults(rows, payload, kind) {
  const expected = new Set(rows.map((row) => row.rowId));
  const seen = new Set();
  if (payload?.unknownRowIds?.length || !Array.isArray(payload?.rows)) return false;
  for (const row of payload.rows) {
    if (!expected.has(row?.rowId) || seen.has(row.rowId)) return false;
    if (kind === "translate" ? typeof row.translatedText !== "string"
      : typeof row.suggestedText !== "string" || typeof row.reviewed !== "boolean") return false;
    seen.add(row.rowId);
  }
  return seen.size === expected.size;
}
