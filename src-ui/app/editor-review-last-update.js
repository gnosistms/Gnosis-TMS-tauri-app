import { historyLastUpdateHeadingLabel, isOptimisticEditorHistoryEntry } from "./editor-history.js";
import { editorFieldImageEqual } from "./editor-images.js";
import { normalizeEditorRowTextStyle } from "./editor-row-text-style.js";

const PENDING_LOCAL_SAVE_ERROR_AFTER_MS = 10_000;

function editorReviewEntriesHaveSameContent(leftEntry, rightEntry) {
  if (!leftEntry || !rightEntry) {
    return false;
  }

  return (
    String(leftEntry.plainText ?? "") === String(rightEntry.plainText ?? "")
    && String(leftEntry.footnote ?? "") === String(rightEntry.footnote ?? "")
    && String(leftEntry.imageCaption ?? "") === String(rightEntry.imageCaption ?? "")
    && editorFieldImageEqual(leftEntry.image, rightEntry.image)
    && normalizeEditorRowTextStyle(leftEntry.textStyle) === normalizeEditorRowTextStyle(rightEntry.textStyle)
  );
}

function findLastCommittedReviewContentUpdate(entries) {
  const committedEntries = entries.filter((entry) => !isOptimisticEditorHistoryEntry(entry));
  if (committedEntries.length === 0) {
    return { entry: null, baselineEntry: null };
  }

  // Marker toggles and comment writes can create newer row revisions without
  // changing anything rendered in Last update. Walk to the oldest revision in
  // the newest equal-content run: that is the commit which introduced the
  // current text/image/style state. The next entry is its meaningful baseline.
  let contentUpdateIndex = 0;
  while (
    contentUpdateIndex + 1 < committedEntries.length
    && editorReviewEntriesHaveSameContent(
      committedEntries[contentUpdateIndex],
      committedEntries[contentUpdateIndex + 1],
    )
  ) {
    contentUpdateIndex += 1;
  }

  return {
    entry: committedEntries[contentUpdateIndex],
    baselineEntry: committedEntries[contentUpdateIndex + 1] ?? null,
  };
}

function pendingLocalSaveAgeMs(entry) {
  const committedAtMs = Date.parse(entry?.committedAt ?? "");
  if (!Number.isFinite(committedAtMs)) {
    return 0;
  }
  return Math.max(0, Date.now() - committedAtMs);
}

export function buildEditorLastUpdate(history, currentEntry) {
  const historyEntries = Array.isArray(history.entries) ? history.entries : [];
  const newestPendingLocalSaveEntry =
    historyEntries.find((entry) => isOptimisticEditorHistoryEntry(entry)) ?? null;
  const newestCommittedEntry =
    historyEntries.find((entry) => !isOptimisticEditorHistoryEntry(entry)) ?? null;
  const committedContentUpdate = findLastCommittedReviewContentUpdate(historyEntries);
  const lastCommittedEntry = committedContentUpdate.entry;
  const previousEntry = committedContentUpdate.baselineEntry;
  const pendingLocalSaveEntry =
    newestPendingLocalSaveEntry
    && (
      !newestCommittedEntry
      || !editorReviewEntriesHaveSameContent(newestPendingLocalSaveEntry, newestCommittedEntry)
    )
      ? newestPendingLocalSaveEntry
      : null;
  const currentEntryMatchesPendingSave =
    pendingLocalSaveEntry
    && editorReviewEntriesHaveSameContent(pendingLocalSaveEntry, currentEntry);
  const currentEntryMatchesLastCommit =
    lastCommittedEntry
    && editorReviewEntriesHaveSameContent(lastCommittedEntry, currentEntry);
  const showsPendingLocalSave = Boolean(currentEntryMatchesPendingSave);
  const pendingLocalSaveIsOverdue =
    showsPendingLocalSave
    && pendingLocalSaveAgeMs(pendingLocalSaveEntry) >= PENDING_LOCAL_SAVE_ERROR_AFTER_MS;
  const showsCurrentEntry = !showsPendingLocalSave && !currentEntryMatchesLastCommit;
  const lastUpdateEntry = showsPendingLocalSave
    ? pendingLocalSaveEntry
    : showsCurrentEntry
      ? currentEntry
      : lastCommittedEntry;
  const lastUpdateBaselineEntry = showsPendingLocalSave
    ? lastCommittedEntry
    : showsCurrentEntry
    ? lastCommittedEntry
    : previousEntry;
  const lastUpdateHeadingLabel = showsPendingLocalSave
    ? pendingLocalSaveIsOverdue
      ? "Local save stalled"
      : "Saving locally..."
    : showsCurrentEntry
    ? "Current text"
    : historyLastUpdateHeadingLabel(lastUpdateEntry);
  return { currentEntry, lastUpdateEntry, lastUpdateBaselineEntry, lastUpdateHeadingLabel,
    showsPendingLocalSave, pendingLocalSaveIsOverdue, showsCurrentEntry };
}
