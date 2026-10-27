import { escapeHtml } from "../lib/ui.js";
import { historyAuthorLabel } from "../app/editor-history.js";
import { formatHistoryTimestamp, renderHistoryContent, renderHistoryEntryContent, renderHistoryNote } from "./translate-history-shared.js";

export function renderSrtGroupLastUpdate(model, languageCode) {
  const text = model.fragments.map((fragment, index) => {
    const marker = index ? `<span class="translation-srt-marker">${escapeHtml(model.markers[index - 1] ?? `⟦${index}⟧`)}</span>` : "";
    return marker + renderHistoryContent(fragment.lastUpdateEntry, fragment.lastUpdateBaselineEntry);
  }).join("");
  const details = model.fragments.map((fragment, index) => {
    const entry = fragment.lastUpdateEntry;
    const baseline = fragment.lastUpdateBaselineEntry;
    const metadata = entry?.commitSha
      ? `${historyAuthorLabel(entry)}${entry.committedAt ? ` · ${formatHistoryTimestamp(entry.committedAt)}` : ""}`
      : "Current text";
    const attachments = renderHistoryEntryContent(entry, baseline, languageCode, { includeMainText: false });
    const note = renderHistoryNote(entry, baseline, { includeMarkers: false, includeStatusNote: !fragment.showsPendingLocalSave });
    return `<div data-srt-review-fragment="${escapeHtml(fragment.rowId)}">
      <p class="history-item__meta">Fragment ${index + 1}: ${escapeHtml(metadata)}</p>
      ${attachments}${note}
    </div>`;
  }).join("");
  const status = model.history.status === "loading"
    ? '<p class="history-item__meta">Loading previous versions...</p>'
    : model.history.status === "error"
      ? `<p class="history-item__note">${escapeHtml(model.history.error || "Could not load previous versions for every fragment.")}</p>`
      : '<p class="history-item__meta">Latest change to each fragment.</p>';
  return `<p class="history-item__content" data-srt-review-combined lang="${escapeHtml(languageCode)}">${text}</p>${details}${status}`;
}
