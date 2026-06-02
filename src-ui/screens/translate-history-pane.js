import {
  escapeHtml,
  renderInlineStateBox,
  renderCollapseChevron,
  secondaryButton,
  tooltipAttributes,
} from "../lib/ui.js";
import {
  buildEditorHistoryViewModel,
  editorHistoryEntryMatchesSection,
  historyEntryCanUndoReplace,
  isOptimisticEditorHistoryEntry,
} from "../app/editor-history.js";
import {
  formatHistoryTimestamp,
  renderHistoryEntryContent,
  renderHistoryNote,
} from "./translate-history-shared.js";

const PENDING_LOCAL_SAVE_ERROR_AFTER_MS = 10_000;

function pendingLocalSaveAgeMs(entry) {
  const committedAtMs = Date.parse(entry?.committedAt ?? "");
  if (!Number.isFinite(committedAtMs)) {
    return 0;
  }
  return Math.max(0, Date.now() - committedAtMs);
}

function pendingLocalSaveIsOverdue(entry) {
  return isOptimisticEditorHistoryEntry(entry)
    && pendingLocalSaveAgeMs(entry) >= PENDING_LOCAL_SAVE_ERROR_AFTER_MS;
}

function renderHistoryEntry(entry, previousEntry, activeLanguage, activeSection, canRestore, history, replaceUndoModal) {
  const isCurrentValue = editorHistoryEntryMatchesSection(entry, activeSection);
  const isRestoring =
    history.status === "restoring" && history.restoringCommitSha === entry.commitSha;
  const isUndoingReplace =
    replaceUndoModal?.status === "loading" && replaceUndoModal?.commitSha === entry.commitSha;
  const isOptimisticEntry = isOptimisticEditorHistoryEntry(entry);
  const restoreButton = isOptimisticEntry
    ? ""
    : isCurrentValue
    ? secondaryButton("Current", "noop", {
      disabled: true,
      compact: true,
      className: "button--replace-toolbar",
    })
    : secondaryButton(
      isRestoring ? "Restoring..." : "Restore",
      `restore-editor-history:${entry.commitSha}`,
      {
        disabled: !canRestore,
        compact: true,
        className: "button--replace-toolbar",
        tooltip: "Restore this version to the editor",
        tooltipOptions: { align: "start" },
      },
    );
  const undoReplaceButton = historyEntryCanUndoReplace(entry)
    ? secondaryButton(
      isUndoingReplace ? "Undoing..." : "Undo replace",
      `open-editor-replace-undo:${entry.commitSha}`,
      {
        disabled: replaceUndoModal?.status === "loading",
        compact: true,
        className: "button--replace-toolbar",
        tooltip: "Undo this batch replace commit",
        tooltipOptions: { align: "start" },
      },
    )
    : "";
  const pendingLocalSaveMessage = pendingLocalSaveIsOverdue(entry)
    ? renderInlineStateBox({
      tone: "error",
      message: "This edit is not committed locally yet, and the local save has not finished.",
      help: "The save operation is still running in the background. Leaving the editor is blocked until it finishes or reports an error.",
    })
    : "";
  const entryFooter = isOptimisticEntry
    ? ""
    : `
      <div class="history-item__footer">
        <div class="history-item__actions">
          ${restoreButton}
          ${undoReplaceButton}
        </div>
        <p class="history-item__meta">${escapeHtml(formatHistoryTimestamp(entry.committedAt))}</p>
      </div>
    `;

  return `
    <article class="history-item">
      ${pendingLocalSaveMessage}
      ${renderHistoryEntryContent(entry, previousEntry, activeLanguage.code)}
      ${renderHistoryNote(entry, previousEntry, { includeStatusNote: !isOptimisticEntry })}
      ${entryFooter}
    </article>
  `;
}

export function renderHistoryPane(editorChapter, rows, languages) {
  const activeRow = rows.find((row) => row.id === editorChapter?.activeRowId) ?? null;
  const activeLanguage =
    languages.find((language) => language.code === editorChapter?.activeLanguageCode) ?? null;
  const activeSection = activeRow?.sections?.find((section) => section.code === activeLanguage?.code) ?? null;
  const activeHistorySection = activeSection
    ? {
        ...activeSection,
        footnote: activeSection?.footnote ?? "",
        imageCaption: activeSection?.imageCaption ?? "",
        image: activeSection?.image ?? null,
        textStyle: activeRow?.textStyle ?? "paragraph",
      }
    : null;
  const history =
    editorChapter?.history && typeof editorChapter.history === "object"
      ? editorChapter.history
      : {
          status: "idle",
          error: "",
          entries: [],
          restoringCommitSha: null,
        };
  const replaceUndoModal =
    editorChapter?.replaceUndoModal && typeof editorChapter.replaceUndoModal === "object"
      ? editorChapter.replaceUndoModal
      : {
          isOpen: false,
          status: "idle",
          error: "",
          commitSha: null,
        };
  const expandedGroupKeys = history.expandedGroupKeys instanceof Set ? history.expandedGroupKeys : new Set();
  const canRestore = Boolean(activeRow && activeSection);
  const historyView = buildEditorHistoryViewModel(history.entries, expandedGroupKeys);
  const historyGroups = historyView.groups;
  const olderVisibleEntryByCommitSha = historyView.olderVisibleEntryByCommitSha;

  return !activeRow || !activeLanguage
    ? `
      <div class="history-empty">
        <p>Select a translation to view its Git history.</p>
      </div>
    `
    : `
      ${
        history.status === "error"
          ? `
            <div class="history-empty">
              <p>${escapeHtml(history.error || "Could not load the Git history for this translation.")}</p>
            </div>
          `
          : history.status !== "loading" && historyGroups.length === 0
            ? `
              <div class="history-empty">
                <p>No committed history exists for this translation yet.</p>
              </div>
            `
            : `
              <div class="history-stack">
                ${historyGroups
                  .map((group) => {
                    const isExpandable = group.entries.length > 1;
                    const isExpanded = isExpandable && expandedGroupKeys.has(group.key);
                    const visibleEntries = isExpanded ? group.entries : [group.entries[0]];
                    const headingTag = isExpandable ? "button" : "div";
                    const headingAttributes = isExpandable
                      ? ` class="history-group__toggle" type="button" data-action="toggle-editor-history-group:${escapeHtml(group.key)}" aria-expanded="${isExpanded ? "true" : "false"}"`
                      : ' class="history-group__toggle history-group__toggle--static"';
                    const summaryTooltip = isExpandable
                      ? tooltipAttributes(
                        isExpanded ? "Collapse this group of revisions" : "Expand this group of revisions",
                        { align: "start" },
                      )
                      : "";
                    const isPendingLocalSaveGroup = group.entries.some((entry) => isOptimisticEditorHistoryEntry(entry));
                    const pendingLocalSaveGroupIsOverdue =
                      isPendingLocalSaveGroup && pendingLocalSaveIsOverdue(group.entries[0]);
                    const groupAuthorLabel = isPendingLocalSaveGroup
                      ? pendingLocalSaveGroupIsOverdue
                        ? "Local save stalled"
                        : "Saving locally..."
                      : group.authorName;
                    const revisionLabel = `${group.entries.length} ${group.entries.length === 1 ? "revision" : "revisions"}`;
                    const groupMetaHtml = isPendingLocalSaveGroup
                      ? pendingLocalSaveGroupIsOverdue
                        ? "Error"
                        : '<span class="history-group__spinner button__spinner" aria-hidden="true"></span>'
                      : escapeHtml(revisionLabel);

                    return `
                      <section class="history-group">
                        <${headingTag}${headingAttributes}>
                          <span class="history-group__summary collapse-affordance"${summaryTooltip}>
                            ${renderCollapseChevron(isExpanded, "history-group__chevron")}
                            <span class="history-group__author">${escapeHtml(groupAuthorLabel)}</span>
                          </span>
                          <span class="history-group__meta">${groupMetaHtml}</span>
                        </${headingTag}>
                        <div class="history-group__entries">
                          ${visibleEntries
                            .map((entry) =>
                              renderHistoryEntry(
                                entry,
                                olderVisibleEntryByCommitSha.get(entry.commitSha) ?? null,
                                activeLanguage,
                                activeHistorySection,
                                canRestore,
                                history,
                                replaceUndoModal,
                              ),
                            )
                            .join("")}
                        </div>
                      </section>
                    `;
                  })
                  .join("")}
              </div>
            `
      }
    `;
}
