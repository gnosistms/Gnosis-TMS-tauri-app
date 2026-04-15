import {
  escapeHtml,
  loadingPrimaryButton,
  primaryButton,
  renderCollapseChevron,
  renderInlineStateBox,
  secondaryButton,
  tooltipAttributes,
} from "../lib/ui.js";
import { resolveVisibleEditorAiReview } from "../app/editor-ai-review-state.js";
import { normalizeEditorSidebarTab } from "../app/editor-comments.js";
import { findEditorHistoryPreviousEntry } from "../app/editor-history.js";
import { renderCommentsPane } from "./translate-comments-pane.js";
import { renderHistoryContent, renderHistoryPane } from "./translate-history-pane.js";

function renderSidebarTab(label, tab, activeTab) {
  const isActive = tab === activeTab;
  return `
    <button
      class="history-tabs__item${isActive ? " history-tabs__item--active" : ""}"
      type="button"
      data-action="switch-editor-sidebar-tab:${escapeHtml(tab)}"
      aria-pressed="${isActive ? "true" : "false"}"
    >
      ${escapeHtml(label)}
    </button>
  `;
}

function renderTranslatePane() {
  return `
    <div class="history-empty">
      <p>Translation tools are not available yet.</p>
    </div>
  `;
}

function renderReviewPane(editorChapter, rows, languages) {
  const expandedSectionKeys =
    editorChapter?.reviewExpandedSectionKeys instanceof Set
      ? editorChapter.reviewExpandedSectionKeys
      : new Set(["last-update", "ai-review"]);
  const activeRow = rows.find((row) => row.id === editorChapter?.activeRowId) ?? null;
  const activeLanguage =
    languages.find((language) => language.code === editorChapter?.activeLanguageCode) ?? null;
  const activeSection =
    activeRow?.sections?.find((section) => section.code === activeLanguage?.code) ?? null;
  const history =
    editorChapter?.history && typeof editorChapter.history === "object"
      ? editorChapter.history
      : {
          status: "idle",
          error: "",
          entries: [],
  };
  const previousEntry = findEditorHistoryPreviousEntry(history.entries, activeSection);
  const currentEntry = {
    plainText: activeSection?.text ?? "",
  };
  const isLastUpdateExpanded = expandedSectionKeys.has("last-update");
  const isAiReviewExpanded = expandedSectionKeys.has("ai-review");
  const lastUpdateSummaryTooltip = tooltipAttributes(
    isLastUpdateExpanded ? "Collapse this review section" : "Expand this review section",
    { align: "start" },
  );
  const summaryMeta = history.status === "loading"
    ? "Loading..."
    : history.status === "error"
      ? "Error"
      : previousEntry
        ? "Diff"
        : "Text only";
  const aiReview = resolveVisibleEditorAiReview(
    editorChapter,
    activeRow?.id ?? null,
    activeLanguage?.code ?? null,
    activeSection?.text ?? "",
  );
  const aiReviewSummaryTooltip = tooltipAttributes(
    isAiReviewExpanded ? "Collapse this review section" : "Expand this review section",
    { align: "start" },
  );
  const aiReviewMeta = aiReview.status === "loading"
    ? "Reviewing..."
    : aiReview.status === "applying"
      ? "Applying..."
      : aiReview.showSuggestion
        ? "Suggestion"
        : aiReview.status === "error"
          ? "Error"
          : "Review now";
  const aiReviewMessage = aiReview.isStale
    ? renderInlineStateBox({
      tone: "warning",
      message: "The text changed since the last AI review.",
    })
    : aiReview.status === "error"
      ? renderInlineStateBox({
        tone: "error",
        message: aiReview.error,
      })
      : "";
  const reviewNowButton = aiReview.status === "loading"
    ? loadingPrimaryButton({
      label: "Review now",
      loadingLabel: "Reviewing...",
      action: "review-editor-text-now",
      isLoading: true,
    })
    : primaryButton("Review now", "review-editor-text-now");
  const applyButton = secondaryButton(
    aiReview.status === "applying" ? "Applying..." : "Apply",
    "apply-editor-ai-review",
    {
      disabled: aiReview.status === "applying",
      compact: true,
      className: "button--replace-toolbar",
      tooltip: "Update the translation to match this AI suggested revision",
      tooltipOptions: { align: "start" },
    },
  );

  if (!activeRow || !activeLanguage || !activeSection) {
    return `
      <div class="history-empty">
        <p>Select a translation to view review tools.</p>
      </div>
    `;
  }

  return `
    <div class="history-stack">
      <section class="history-group">
        <button
          class="history-group__toggle"
          type="button"
          data-action="toggle-editor-review-section:last-update"
          aria-expanded="${isLastUpdateExpanded ? "true" : "false"}"
        >
          <span class="history-group__summary collapse-affordance"${lastUpdateSummaryTooltip}>
            ${renderCollapseChevron(isLastUpdateExpanded, "history-group__chevron")}
            <span class="history-group__author">Last update</span>
          </span>
          <span class="history-group__meta">${escapeHtml(summaryMeta)}</span>
        </button>
        ${
          isLastUpdateExpanded
            ? `
              <div class="history-group__entries">
                <article class="history-item">
                  <p class="history-item__content" lang="${escapeHtml(activeLanguage.code)}">${renderHistoryContent(currentEntry, previousEntry)}</p>
                  ${
                    history.status === "loading"
                      ? '<p class="history-item__meta">Loading previous version...</p>'
                      : history.status === "error"
                        ? `<p class="history-item__note">${escapeHtml(history.error || "Could not load the previous version.")}</p>`
                        : previousEntry
                          ? '<p class="history-item__meta">Compared with the previous version</p>'
                          : '<p class="history-item__meta">No previous version</p>'
                  }
                </article>
              </div>
            `
            : ""
        }
      </section>
      <section class="history-group">
        <button
          class="history-group__toggle"
          type="button"
          data-action="toggle-editor-review-section:ai-review"
          aria-expanded="${isAiReviewExpanded ? "true" : "false"}"
        >
          <span class="history-group__summary collapse-affordance"${aiReviewSummaryTooltip}>
            ${renderCollapseChevron(isAiReviewExpanded, "history-group__chevron")}
            <span class="history-group__author">AI Review</span>
          </span>
          <span class="history-group__meta">${escapeHtml(aiReviewMeta)}</span>
        </button>
        ${
          isAiReviewExpanded
            ? `
              <div class="history-group__entries">
                <article class="history-item">
                  ${
                    aiReview.showSuggestion
                      ? `
                        <p class="history-item__content" lang="${escapeHtml(activeLanguage.code)}">${renderHistoryContent({ plainText: aiReview.suggestedText }, currentEntry)}</p>
                        <div class="history-item__footer">
                          <div class="history-item__actions">
                            ${applyButton}
                          </div>
                          <p class="history-item__meta">Compared with the current text</p>
                        </div>
                      `
                      : `
                        ${aiReviewMessage}
                        <div class="history-item__footer">
                          <div class="history-item__actions">
                            ${reviewNowButton}
                          </div>
                        </div>
                      `
                  }
                </article>
              </div>
            `
            : ""
        }
      </section>
    </div>
  `;
}

export function renderTranslateSidebar(editorChapter, rows, languages, session) {
  const activeTab = normalizeEditorSidebarTab(editorChapter?.sidebarTab);
  const body = activeTab === "translate"
    ? renderTranslatePane()
    : activeTab === "comments"
    ? renderCommentsPane(editorChapter, rows, session)
    : activeTab === "review"
      ? renderReviewPane(editorChapter, rows, languages)
      : renderHistoryPane(editorChapter, rows, languages);

  return `
    <aside class="translate-sidebar card card--history">
      <div class="card__body">
        <div class="history-tabs">
          ${renderSidebarTab("Translate", "translate", activeTab)}
          ${renderSidebarTab("Review", "review", activeTab)}
          ${renderSidebarTab("History", "history", activeTab)}
          ${renderSidebarTab("Comments", "comments", activeTab)}
        </div>
        ${body}
      </div>
    </aside>
  `;
}
