import {
  escapeHtml,
  renderCollapseChevron,
  secondaryButton,
  tooltipAttributes,
} from "../lib/ui.js";
import {
  buildEditorHistoryViewModel,
  editorHistoryEntryMatchesSection,
  historyEntryCanUndoReplace,
} from "../app/editor-history.js";
import {
  formatHistoryTimestamp,
  renderHistoryContent,
  renderHistoryNote,
} from "./translate-history-shared.js";

function renderHistoryEntry(entry, previousEntry, activeLanguage, activeSection, canRestore, history, replaceUndoModal) {
  const isCurrentValue = editorHistoryEntryMatchesSection(entry, activeSection);
  const isRestoring =
    history.status === "restoring" && history.restoringCommitSha === entry.commitSha;
  const isUndoingReplace =
    replaceUndoModal?.status === "loading" && replaceUndoModal?.commitSha === entry.commitSha;
  const restoreButton = isCurrentValue
    ? secondaryButton("Current", "noop", {
      disabled: true,
      compact: true,
      className: "button--replace-toolbar",
    })
    : secondaryButton(
      isRestoring ? "Restoring..." : "Restore",
      `restore-editor-history:${entry.commitSha}`,
      {
        disabled: !canRestore || history.status === "restoring",
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
        disabled: history.status === "restoring" || replaceUndoModal?.status === "loading",
        compact: true,
        className: "button--replace-toolbar",
        tooltip: "Undo this batch replace commit",
        tooltipOptions: { align: "start" },
      },
    )
    : "";

  return `
    <article class="history-item">
      <p class="history-item__content" lang="${escapeHtml(activeLanguage.code)}">${renderHistoryContent(entry, previousEntry)}</p>
      ${renderHistoryNote(entry, previousEntry)}
      <div class="history-item__footer">
        <div class="history-item__actions">
          ${restoreButton}
          ${undoReplaceButton}
        </div>
        <p class="history-item__meta">${escapeHtml(formatHistoryTimestamp(entry.committedAt))}</p>
      </div>
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
  const canRestore =
    activeRow?.saveStatus === "idle"
    && activeSection?.markerSaveState?.status !== "saving"
    && activeRow?.textStyleSaveState?.status !== "saving";
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
                    const revisionLabel = `${group.entries.length} ${group.entries.length === 1 ? "revision" : "revisions"}`;

                    return `
                      <section class="history-group">
                        <${headingTag}${headingAttributes}>
                          <span class="history-group__summary collapse-affordance"${summaryTooltip}>
                            ${renderCollapseChevron(isExpanded, "history-group__chevron")}
                            <span class="history-group__author">${escapeHtml(group.authorName)}</span>
                          </span>
                          <span class="history-group__meta">${escapeHtml(revisionLabel)}</span>
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
