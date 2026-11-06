import { normalizeEditorFootnotes, serializeEditorFootnotesForLegacy } from "./editor-footnotes.js";
import { buildConflictComparison } from "./editor-conflict-comparison.js";
import { conflictedLanguageCodesForRow } from "./editor-conflicts.js";

const FIELDS = [
  ["text", "Translation text", "Text"],
  ["attribution", "Attribution", "Attribution"],
  ["imageCaption", "Caption", "ImageCaption"],
  ["imageUrl", "Image, audio, or video URL", "ImageUrl"],
];

function passage(id, kind, label, base, local, remote, marker = null) {
  const comparison = kind === "imageUrl"
    ? { combined: null, localParagraphMigration: false, remoteParagraphMigration: false }
    : buildConflictComparison(base, local, remote, { footnote: kind === "footnote" });
  return {
    id, kind, label, marker, base, local, remote, ...comparison,
    changed: local !== remote,
    value: comparison.combined ?? remote,
    choice: local === remote ? "unchanged" : "",
  };
}

export function buildConflictReview(modal) {
  const items = FIELDS.map(([kind, label, suffix]) => passage(
    kind, kind, label, modal.hasSharedBase ? modal[`base${suffix}`] ?? "" : null,
    modal[`local${suffix}`] ?? "", modal[`remote${suffix}`] ?? "",
  ));
  const local = normalizeEditorFootnotes(modal.localFootnote);
  const remote = normalizeEditorFootnotes(modal.remoteFootnote);
  const base = normalizeEditorFootnotes(modal.baseFootnote);
  // Ambiguous legacy marker duplicates must remain a single editable field.
  const duplicate = [local, remote, base].some((notes) => new Set(notes.map((n) => n.marker)).size !== notes.length);
  if (duplicate) {
    items.push(passage("footnote", "footnote", "Footnotes", modal.hasSharedBase ? modal.baseFootnote ?? "" : null,
      modal.localFootnote ?? "", modal.remoteFootnote ?? ""));
  } else {
    const markers = [...new Set([...remote, ...local, ...base].map((n) => n.marker))];
    for (const marker of markers) {
      const get = (notes) => notes.find((n) => n.marker === marker)?.text ?? null;
      items.push(passage(`footnote-${marker}`, "footnote", `Footnote [${marker}]`,
        modal.hasSharedBase ? get(base) ?? "" : null, get(local), get(remote), marker));
    }
  }
  return items;
}

function syncReviewValues(modal, review) {
  const next = { ...modal, review };
  for (const [kind, , suffix] of FIELDS) {
    const entry = review.find((p) => p.kind === kind);
    if (entry) next[`final${suffix}`] = entry.value ?? "";
  }
  const notes = review.filter((p) => p.kind === "footnote");
  next.finalFootnote = notes.some((p) => p.marker === null)
    ? notes[0].value ?? ""
    : serializeEditorFootnotesForLegacy(notes.filter((p) => p.value !== null).map((p) => ({ marker: p.marker, text: p.value })));
  return next;
}

export function initializeConflictReview(modal) {
  return syncReviewValues(modal, buildConflictReview(modal));
}

export function chooseConflictPassage(modal, id, choice, manualValue) {
  if (!["local", "remote", "combined", "manual", "undo"].includes(choice)) return modal;
  const review = (modal.review ?? buildConflictReview(modal)).map((p) => {
    if (!p.changed || (id !== "all" && p.id !== id)) return p;
    if (choice === "combined" && p.combined === null) return p;
    const value = choice === "manual" ? String(manualValue ?? "")
      : choice === "undo" ? p.combined ?? p.remote : p[choice];
    return { ...p, choice: choice === "undo" ? "" : choice, value };
  });
  return syncReviewValues(modal, review);
}

export function conflictReviewPendingCount(modal) {
  return (modal.review ?? buildConflictReview(modal)).filter((p) => p.changed && !p.choice).length;
}

export function conflictReviewTargets(chapter) {
  return (chapter?.rows ?? []).flatMap((row, index) => [...conflictedLanguageCodesForRow(row, chapter.languages)]
    .map((languageCode) => ({ rowId: row.rowId, languageCode, rowNumber: index + 1 })));
}
