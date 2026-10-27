import { resolveVisibleEditorAiReview } from "../app/editor-ai-review-state.js";
import { buildEditorLastUpdate } from "../app/editor-review-last-update.js";
import { buildSrtGroupLastUpdate } from "../app/editor-srt-review-history.js";
import { renderSrtGroupLastUpdate } from "./translate-srt-review-last-update.js";
import { serializeEditorFootnotesForLegacy, mergeEditorFootnoteCorrections } from "../app/editor-footnotes.js";
import { srtGroupSnapshot } from "../app/editor-srt-group-ai.js";
import { pendingSrtGroupEdits } from "../app/editor-srt-group-edit-flow.js";
import {
  escapeHtml,
  loadingSpinnerKeyAttribute,
  renderInlineStateBox,
  secondaryButton,
  tooltipAttributes,
} from "../lib/ui.js";
import {
  renderHistoryContent,
  renderHistoryEntryContent,
  renderHistoryNote,
} from "./translate-history-shared.js";

function renderAiReviewPromptDetails(aiReview) {
  const promptText = typeof aiReview?.promptText === "string" ? aiReview.promptText.trim() : "";
  if (!promptText) {
    return "";
  }

  return `
    <details class="assistant-item__details">
      <summary>Show prompt</summary>
      <div class="assistant-item__details-body">
        <div class="assistant-item__section">
          <p class="assistant-item__section-label">Prompt</p>
          <pre class="assistant-item__pre">${escapeHtml(promptText)}</pre>
        </div>
      </div>
    </details>
  `;
}

function renderAiReviewModeButton({ label, action, reviewMode, tooltip, isLoading = false, disabled = false }) {
  const tooltipMarkup = tooltipAttributes(tooltip, { align: "start" });
  const reviewModeAttribute = reviewMode ? ` data-ai-review-mode="${escapeHtml(reviewMode)}"` : "";
  if (isLoading) {
    return `
      <button class="button button--primary button--loading" data-action="noop"${loadingSpinnerKeyAttribute(action)}${reviewModeAttribute} disabled aria-busy="true"${tooltipMarkup}>
        <span class="button__spinner" aria-hidden="true"></span>
        <span>${escapeHtml(label)}...</span>
      </button>
    `;
  }

  return `
    <button
      class="button button--primary${disabled ? " is-disabled" : ""}"
      data-action="${escapeHtml(action)}"
      ${reviewModeAttribute}
      ${disabled ? 'disabled aria-disabled="true"' : ""}
      ${tooltipMarkup}
    >
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

function renderAiReviewSuggestionSections(aiReview, currentEntry, activeLanguage, includeReviewedSnapshot = false) {
  // A clean review has no suggestion. Its input is the reviewed snapshot to
  // compare with later edits; omitted suggestion fields retain that input too.
  const reviewedText = (suggestion, source) => suggestion?.trim()
    ? suggestion
    : includeReviewedSnapshot ? source ?? "" : "";
  const text = reviewedText(aiReview.suggestedText, aiReview.sourceText);
  const footnote = reviewedText(aiReview.suggestedFootnote, aiReview.sourceFootnote);
  const imageCaption = reviewedText(aiReview.suggestedImageCaption, aiReview.sourceImageCaption);
  const sections = [];
  if (text.trim() || (includeReviewedSnapshot && currentEntry?.plainText?.trim())) {
    sections.push(`
      <p class="history-item__content" lang="${escapeHtml(activeLanguage.code)}">${renderHistoryContent({ plainText: text }, currentEntry)}</p>
    `);
  }
  if (footnote.trim() || (includeReviewedSnapshot && currentEntry?.footnote?.trim())) {
    sections.push(`
      <p class="history-item__meta">Footnote</p>
      <p class="history-item__content history-item__content--footnote" lang="${escapeHtml(activeLanguage.code)}">${renderHistoryContent({ plainText: footnote }, { plainText: currentEntry?.footnote ?? "" })}</p>
    `);
  }
  if (imageCaption.trim() || (includeReviewedSnapshot && currentEntry?.imageCaption?.trim())) {
    sections.push(`
      <p class="history-item__meta">Image caption</p>
      <p class="history-item__content" lang="${escapeHtml(activeLanguage.code)}">${renderHistoryContent({ plainText: imageCaption }, { plainText: currentEntry?.imageCaption ?? "" })}</p>
    `);
  }
  return sections.join("");
}

function renderSrtReviewSuggestions(review, group, language) {
  const code = language.code;
  const markers = group.sections.find((section) => section.code === code)?.srtMarkers ?? [];
  const text = review.results.map((result, index) => {
    const member = group.srtGroup.members[index];
    const marker = index ? `<span class="translation-srt-marker">${escapeHtml(markers[index - 1] ?? `⟦${index}⟧`)}</span>` : "";
    return marker + renderHistoryContent({ plainText: result.suggestedText }, { plainText: member.fields?.[code] ?? "" });
  }).join("");
  const attachments = review.results.map((result, index) => {
    const member = group.srtGroup.members[index];
    const note = mergeEditorFootnoteCorrections(member.footnotes?.[code], result.suggestedFootnotes ?? []);
    const sections = [];
    if (result.suggestedFootnotes?.length && note.ok) sections.push(`<p class="history-item__meta">Footnotes</p>
      <p class="history-item__content">${renderHistoryContent({ plainText: serializeEditorFootnotesForLegacy(note.footnotes) }, { plainText: serializeEditorFootnotesForLegacy(member.footnotes?.[code]) })}</p>`);
    if (result.suggestedImageCaption) sections.push(`<p class="history-item__meta">Image caption</p>
      <p class="history-item__content">${renderHistoryContent({ plainText: result.suggestedImageCaption }, { plainText: member.imageCaptions?.[code] ?? "" })}</p>`);
    return sections.length ? `<p class="history-item__meta">Fragment ${index + 1}</p>${sections.join("")}` : "";
  }).join("");
  return `<p class="history-item__content" data-srt-review-suggestion lang="${escapeHtml(code)}">${text}</p>${attachments}`;
}

export function renderReviewPane(editorChapter, rows, languages, offlineMode = false) {
  const activeRow = rows.find((row) => row.id === editorChapter?.activeRowId || row.srtGroup?.memberRowIds.includes(editorChapter?.activeRowId)) ?? null;
  const activeLanguage =
    languages.find((language) => language.code === editorChapter?.activeLanguageCode) ?? null;
  const activeSection = activeRow?.sections?.find((section) => section.code === activeLanguage?.code) ?? null;
  const historyRow = activeRow?.srtGroup?.members.find((row) => row.rowId === editorChapter.activeRowId) ?? activeRow;
  const historySection = historyRow?.sections?.find((section) => section.code === activeLanguage?.code) ?? activeSection;
  // History entries and AI review state carry footnotes in the persisted
  // labeled serialization; the section's plain text would falsely diff as a
  // change whenever marker labels are present.
  const activeSectionFootnote = serializeEditorFootnotesForLegacy(
    activeSection?.footnotes ?? activeSection?.footnote ?? "",
  );
  const history =
    editorChapter?.history && typeof editorChapter.history === "object"
      ? editorChapter.history
      : {
          status: "idle",
          error: "",
          entries: [],
  };
  const currentEntry = {
    plainText: historySection?.text ?? "",
    footnote: serializeEditorFootnotesForLegacy(historySection?.footnotes ?? historySection?.footnote ?? ""),
    imageCaption: historySection?.imageCaption ?? "",
    image: historySection?.image ?? null,
    reviewed: historySection?.reviewed === true,
    pleaseCheck: historySection?.pleaseCheck === true,
    textStyle: historyRow?.textStyle ?? "paragraph",
  };
  const groupLastUpdate = activeRow?.srtGroup
    ? buildSrtGroupLastUpdate(editorChapter, activeRow, activeSection) : null;
  const { lastUpdateEntry, lastUpdateBaselineEntry, lastUpdateHeadingLabel,
    showsPendingLocalSave, pendingLocalSaveIsOverdue, showsCurrentEntry } =
    groupLastUpdate ?? buildEditorLastUpdate(history, currentEntry);
  const lastUpdateHistory = groupLastUpdate?.history ?? history;
  const summaryMeta = showsPendingLocalSave
    ? pendingLocalSaveIsOverdue
      ? "Error"
      : ""
    : lastUpdateHistory.status === "loading"
    ? "Loading..."
    : lastUpdateHistory.status === "error"
      ? "Error"
      : lastUpdateBaselineEntry
        ? "Diff"
        : "Text only";
  const summaryMetaHtml = showsPendingLocalSave && !pendingLocalSaveIsOverdue
    ? '<span class="history-group__spinner button__spinner" aria-hidden="true"></span>'
    : escapeHtml(summaryMeta);
  let aiReview = resolveVisibleEditorAiReview(
    editorChapter,
    activeRow?.id ?? null,
    activeLanguage?.code ?? null,
    activeSection?.text ?? "",
    activeSectionFootnote,
    activeSection?.imageCaption ?? "",
  );
  const groupReview = activeRow?.srtGroup && editorChapter.srtGroupReview?.first === activeRow.id
    && editorChapter.srtGroupReview.targetCode === activeLanguage?.code ? editorChapter.srtGroupReview : null;
  if (groupReview && aiReview.status === "ready") {
    const stale = editorChapter.selectedSourceLanguageCode !== groupReview.sourceCode
      || srtGroupSnapshot(activeRow.srtGroup.members) !== groupReview.captured
      || pendingSrtGroupEdits(editorChapter, { rowIds: groupReview.memberRowIds }).length > 0;
    const corrections = groupReview.results.some((result, index) => !result.reviewed
      || result.suggestedText !== (activeRow.srtGroup.members[index]?.fields?.[activeLanguage.code] ?? "")
      || result.suggestedFootnotes?.length || result.suggestedImageCaption);
    aiReview = { ...aiReview, isStale: stale, showSuggestion: !stale && corrections,
      showLooksGoodMessage: !stale && !corrections,
      fullReviewPassed: !stale && !corrections && aiReview.reviewMode === "meaning",
      showGrammarReviewButton: stale || !corrections, showFullReviewButton: stale || !corrections };
  }
  const aiReviewMeta = offlineMode === true
    ? "Offline"
    : aiReview.status === "loading"
    ? "Reviewing..."
    : aiReview.status === "applying"
      ? "Applying..."
      : aiReview.showLooksGoodMessage
        ? aiReview.fullReviewPassed
          ? "Looks good!"
          : "Grammar okay"
      : aiReview.showSuggestion
        ? "Suggestion"
        : aiReview.status === "error"
          ? "Error"
          : "Review now";
  // Keep old results available for comparison without making them applicable
  // or treating a previously clean review as approval of the user's new edits.
  const showStaleReview = aiReview.isStale
    && (aiReview.status === "ready" || aiReview.status === "applying");
  const aiReviewMessage = aiReview.status === "error"
      ? renderInlineStateBox({
        tone: "error",
        message: aiReview.error,
      })
    : offlineMode === true
      ? renderInlineStateBox({
        message: "AI actions are unavailable offline.",
      })
      : "";
  const pendingLocalSaveMessage = showsPendingLocalSave && pendingLocalSaveIsOverdue
    ? renderInlineStateBox({
      tone: "error",
      message: "This edit is not committed locally yet, and the local save has not finished.",
      help: "The save operation is still running in the background. Leaving the editor is blocked until it finishes or reports an error.",
    })
    : "";
  const showFullReviewButton = aiReview.status === "loading"
    ? aiReview.reviewMode === "meaning"
    : aiReview.showFullReviewButton;
  const showGrammarReviewButton = aiReview.status === "loading"
    ? aiReview.reviewMode !== "meaning"
    : aiReview.showGrammarReviewButton;
  const reviewModeButtons = `
    ${showFullReviewButton
      ? renderAiReviewModeButton({
        label: "Full review",
        action: "review-editor-text-now:meaning",
        reviewMode: "meaning",
        tooltip: "Check to see if the translation is correct in addition to checking spelling and grammar.",
        isLoading: aiReview.status === "loading" && aiReview.reviewMode === "meaning",
        disabled: offlineMode === true || aiReview.status === "loading",
      })
      : ""}
    ${showGrammarReviewButton
      ? renderAiReviewModeButton({
        label: "Spelling and grammar only",
        action: "review-editor-text-now:grammar",
        reviewMode: "grammar",
        tooltip: "Check only for spelling and grammar errors.",
        isLoading: aiReview.status === "loading" && aiReview.reviewMode !== "meaning",
        disabled: offlineMode === true || aiReview.status === "loading",
      })
      : ""}
  `;
  const reviewModeButtonsFooter = reviewModeButtons.trim()
    ? `
      <div class="history-item__footer">
        <div class="history-item__actions">
          ${reviewModeButtons}
        </div>
      </div>
    `
    : "";
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
      <section class="history-group" data-editor-review-section="last-update">
        <div class="history-group__toggle history-group__toggle--static">
          <span class="history-group__summary">
            <span class="history-group__author">${escapeHtml(lastUpdateHeadingLabel)}</span>
          </span>
          <span class="history-group__meta">${summaryMetaHtml}</span>
        </div>
        <div class="history-group__entries">
          <article class="history-item">
            ${pendingLocalSaveMessage}
            ${groupLastUpdate ? renderSrtGroupLastUpdate(groupLastUpdate, activeLanguage.code) : `
            ${renderHistoryEntryContent(lastUpdateEntry, lastUpdateBaselineEntry, activeLanguage.code)}
            ${renderHistoryNote(lastUpdateEntry, lastUpdateBaselineEntry, {
              includeMarkers: false,
              includeStatusNote: !showsPendingLocalSave,
            })}
            ${
              history.status === "loading"
                ? '<p class="history-item__meta">Loading previous version...</p>'
                : lastUpdateHistory.status === "error"
                  ? `<p class="history-item__note">${escapeHtml(history.error || "Could not load the previous version.")}</p>`
                  : lastUpdateBaselineEntry
                    ? `<p class="history-item__meta">${showsCurrentEntry ? "Compared with the latest saved version" : "Compared with the previous commit"}</p>`
                    : '<p class="history-item__meta">No previous version</p>'
            }
            `}

          </article>
        </div>
      </section>
      <section class="history-group" data-editor-review-section="ai-review">
        <div class="history-group__toggle history-group__toggle--static">
          <span class="history-group__summary">
            <span class="history-group__author">AI Review</span>
          </span>
          <span class="history-group__meta">${escapeHtml(aiReviewMeta)}</span>
        </div>
        <div class="history-group__entries">
          <article class="history-item">
            ${
              aiReview.showSuggestion || showStaleReview
                ? `
                  ${groupReview ? renderSrtReviewSuggestions(groupReview, activeRow, activeLanguage) : renderAiReviewSuggestionSections(aiReview, currentEntry, activeLanguage, showStaleReview)}
                  ${aiReview.showSuggestion ? `<div class="history-item__footer">
                    <div class="history-item__actions">
                      ${applyButton}
                    </div>
                  </div>` : ""}
                  <p class="history-item__meta">Compared with the current text in the editor.</p>
                  ${renderAiReviewPromptDetails(aiReview)}
                  ${showStaleReview ? reviewModeButtonsFooter : ""}
                `
                : aiReview.showLooksGoodMessage
                  ? `
                    <p class="history-item__content" lang="${escapeHtml(activeLanguage.code)}">${escapeHtml(aiReview.fullReviewPassed ? "Your translation looks good!" : "Spelling and grammar look good!")}</p>
                    ${renderAiReviewPromptDetails(aiReview)}
                    ${reviewModeButtonsFooter}
                  `
                : `
                  ${aiReviewMessage}
                  ${renderAiReviewPromptDetails(aiReview)}
                  ${reviewModeButtonsFooter}
                `
            }
          </article>
        </div>
      </section>
    </div>
  `;
}
