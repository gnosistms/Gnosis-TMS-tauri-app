import {
  escapeHtml,
  loadingPrimaryButton,
  renderCollapseChevron,
  secondaryButton,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import {
  EDITOR_EXPORT_CATEGORIES,
  findEditorExportOption,
} from "../app/editor-export-flow.js";
import { selectedWordPressPost } from "../app/editor-export-wordpress-flow.js";

function renderExportOption(option, selectedOptionId) {
  const classes = [
    "editor-export-modal__option",
    option.id === selectedOptionId ? "is-selected" : "",
  ].filter(Boolean).join(" ");
  return `
    <li>
      <button
        type="button"
        class="${classes}"
        data-action="select-editor-export-option:${escapeHtml(option.id)}"
        aria-pressed="${option.id === selectedOptionId ? "true" : "false"}"
      >${escapeHtml(option.label)}</button>
    </li>
  `;
}

function renderExportCategory(category, modal) {
  const expanded = Array.isArray(modal.expandedCategoryIds)
    && modal.expandedCategoryIds.includes(category.id);
  const optionsMarkup = expanded
    ? `<ul class="editor-export-modal__options">${category.options
      .map((option) => renderExportOption(option, modal.selectedOptionId))
      .join("")}</ul>`
    : "";

  return `
    <div class="editor-export-modal__category">
      <button
        type="button"
        class="editor-export-modal__category-toggle"
        data-action="toggle-editor-export-category:${escapeHtml(category.id)}"
        aria-expanded="${expanded ? "true" : "false"}"
      >
        ${renderCollapseChevron(expanded, "editor-export-modal__chevron")}
        <span>${escapeHtml(category.label)}</span>
      </button>
      ${optionsMarkup}
    </div>
  `;
}

function supportingText(text) {
  return `<p class="modal__supporting">${escapeHtml(text)}</p>`;
}

function renderWordPressPostResult(post, selectedPostId) {
  const classes = [
    "editor-export-modal__wordpress-post",
    post.id === selectedPostId ? "is-selected" : "",
  ].filter(Boolean).join(" ");
  const statusLabel = post.status && post.status !== "publish"
    ? ` <span class="editor-export-modal__wordpress-post-status">${escapeHtml(post.status)}</span>`
    : "";
  return `
    <li>
      <button
        type="button"
        class="${classes}"
        data-action="select-wordpress-post:${escapeHtml(String(post.id))}"
        aria-pressed="${post.id === selectedPostId ? "true" : "false"}"
      >${escapeHtml(post.title)}${statusLabel}</button>
    </li>
  `;
}

function renderWordPressSearchResults(wordpress) {
  if (wordpress.searchStatus === "searching") {
    return supportingText("Searching posts...");
  }
  if (wordpress.searchStatus !== "done") {
    return "";
  }
  if (wordpress.searchResults.length === 0) {
    return supportingText("No posts found.");
  }
  return `
    <ul class="editor-export-modal__wordpress-posts">
      ${wordpress.searchResults.map((post) => renderWordPressPostResult(post, wordpress.selectedPostId)).join("")}
    </ul>
  `;
}

function wordpressDetail(wordpress, isExporting) {
  if (!wordpress || wordpress.connectionStatus === "unknown" || wordpress.connectionStatus === "loading") {
    return {
      bodyMarkup: supportingText("Checking the WordPress.com connection..."),
      submitButton: "",
    };
  }

  if (wordpress.connectionStatus === "disconnected" || wordpress.connectionStatus === "connecting") {
    const message = wordpress.connectionStatus === "connecting"
      ? "Finish connecting to WordPress.com in your browser. We will bring you back here automatically."
      : "Connect your WordPress.com account to export this chapter as a post.";
    return {
      bodyMarkup: `
        ${supportingText(message)}
        <button class="button button--primary" data-action="connect-wordpress">
          <span>Connect WordPress.com</span>
        </button>
      `,
      submitButton: "",
    };
  }

  const blogLabel = wordpress.connection?.blogUrl || "your WordPress.com site";
  const selectedPost = selectedWordPressPost(wordpress);
  const createSection = wordpress.mode === "create"
    ? `
      <label class="field editor-export-modal__wordpress-field">
        <span class="field__label">Post title</span>
        <input
          class="field__input"
          type="text"
          value="${escapeHtml(wordpress.title)}"
          data-wordpress-title-input
        />
      </label>
      ${supportingText("A new draft post will be created. Publish it from WordPress when you are ready.")}
    `
    : "";
  const overwriteSection = wordpress.mode === "overwrite"
    ? `
      <div class="editor-export-modal__wordpress-search">
        <input
          class="field__input"
          type="text"
          placeholder="Search your posts"
          value="${escapeHtml(wordpress.searchQuery)}"
          data-wordpress-search-input
        />
        ${secondaryButton("Search", "search-wordpress-posts", { disabled: wordpress.searchStatus === "searching" })}
      </div>
      ${renderWordPressSearchResults(wordpress)}
      ${selectedPost
        ? `<p class="editor-export-modal__wordpress-warning" role="alert">Exporting will replace the content of &ldquo;${escapeHtml(selectedPost.title)}&rdquo; on ${escapeHtml(blogLabel)}. This cannot be undone.</p>`
        : supportingText("Search for the post to overwrite, then choose it from the results.")}
    `
    : "";

  return {
    bodyMarkup: `
      <p class="modal__supporting">
        Connected to <strong>${escapeHtml(blogLabel)}</strong>.
        <button type="button" class="editor-export-modal__wordpress-disconnect" data-action="disconnect-wordpress">Disconnect</button>
      </p>
      <div class="editor-export-modal__wordpress-modes">
        <label class="editor-export-modal__wordpress-mode">
          <input type="radio" name="wordpress-export-mode" value="create" data-wordpress-mode-input ${wordpress.mode === "create" ? "checked" : ""} />
          <span>Create a new draft post</span>
        </label>
        <label class="editor-export-modal__wordpress-mode">
          <input type="radio" name="wordpress-export-mode" value="overwrite" data-wordpress-mode-input ${wordpress.mode === "overwrite" ? "checked" : ""} />
          <span>Overwrite an existing post</span>
        </label>
      </div>
      ${createSection}
      ${overwriteSection}
      ${isExporting && wordpress.exportStage
        ? `<p class="modal__supporting editor-export-modal__wordpress-stage">${escapeHtml(wordpress.exportStage)}</p>`
        : ""}
    `,
    submitButton: loadingPrimaryButton({
      label: wordpress.mode === "overwrite" ? "Overwrite post" : "Export draft",
      loadingLabel: "Exporting...",
      action: "submit-editor-export",
      isLoading: isExporting,
    }),
  };
}

function exportDetail(option, isExporting, modal) {
  if (!option || option.available !== true) {
    return {
      bodyMarkup: supportingText("This export option is not available yet."),
      submitButton: "",
    };
  }

  if (option.kind === "link" && option.format === "wordpress") {
    return wordpressDetail(modal.wordpress, isExporting);
  }

  if (option.kind === "file") {
    return {
      bodyMarkup: supportingText(`Click Save to export a ${option.label} file.`),
      submitButton: loadingPrimaryButton({
        label: "Save",
        loadingLabel: "Saving...",
        action: "submit-editor-export",
        isLoading: isExporting,
      }),
    };
  }

  return {
    bodyMarkup: supportingText(`Click Copy to export ${option.label.toLowerCase()} data to the clipboard for pasting into other apps.`),
    submitButton: loadingPrimaryButton({
      label: "Copy",
      loadingLabel: "Copying...",
      action: "submit-editor-export",
      isLoading: isExporting,
    }),
  };
}

export function renderEditorExportModal(state) {
  const modal = state.editorChapter?.exportModal;
  if (!modal?.isOpen) {
    return "";
  }

  const isExporting = modal.status === "exporting";
  const option = findEditorExportOption(modal.selectedOptionId);
  const detail = exportDetail(option, isExporting, modal);
  const errorMarkup = modal.error
    ? `<p class="modal__error" role="alert">${escapeHtml(formatErrorForDisplay(modal.error))}</p>`
    : "";

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--editor-export">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">Export</p>
          <h2 class="modal__title">Export options</h2>
          <div class="editor-export-modal">
            <nav class="editor-export-modal__nav" aria-label="Export options">
              ${EDITOR_EXPORT_CATEGORIES.map((category) => renderExportCategory(category, modal)).join("")}
            </nav>
            <div class="editor-export-modal__detail">
              <p class="editor-export-modal__detail-heading">${escapeHtml(option?.label ?? "")}</p>
              ${detail.bodyMarkup}
              ${errorMarkup}
              <div class="modal__actions">
                ${secondaryButton("Cancel", "close-editor-export-options", { disabled: isExporting })}
                ${detail.submitButton}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  `;
}
