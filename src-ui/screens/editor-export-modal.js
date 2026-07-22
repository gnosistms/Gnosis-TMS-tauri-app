import {
  escapeHtml,
  loadingPrimaryButton,
  renderCollapseChevron,
  secondaryButton,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import {
  editorExportCategories,
  findEditorExportOption,
  PDF_PAPER_SIZES,
} from "../app/editor-export-flow.js";
import { selectedWordPressPost } from "../app/editor-export-wordpress-flow.js";
import {
  eligibleTeamCopyTargets,
  selectedTeamCopyProject,
} from "../app/editor-export-team-copy-flow.js";

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

function pdfFontDisclosure(modal) {
  if (modal.pdfFontStatus === "loading" || modal.pdfFontStatus === "idle") {
    return supportingText("Checking the required PDF fonts…");
  }
  if (modal.pdfFontStatus === "unsupported") {
    return `<p class="modal__error" role="alert">${escapeHtml(modal.pdfFontMessage || "PDF export does not support this language yet.")}</p>`;
  }
  if (modal.pdfFontStatus !== "ready") {
    return "";
  }
  const missingBytes = Number(modal.pdfFontMissingBytes) || 0;
  if (missingBytes === 0) {
    return supportingText("PDF fonts are installed. No download is required.");
  }
  const size = `${(missingBytes / 1_048_576).toFixed(1)} MB (${Math.round(missingBytes).toLocaleString("en-US")} bytes)`;
  const families = Array.isArray(modal.pdfFontFamilies) && modal.pdfFontFamilies.length > 0
    ? `${modal.pdfFontFamilies.join(" and ")} print fonts`
    : "PDF print fonts";
  return supportingText(`${families} (${size}) will be downloaded once and kept between app updates.`);
}

function renderPdfExportProgress(modal, isExporting) {
  if (!isExporting || !modal.pdfStage) {
    return "";
  }
  const current = Math.max(0, Number(modal.pdfProgressCurrent) || 0);
  const total = Math.max(0, Number(modal.pdfProgressTotal) || 0);
  const unit = String(modal.pdfProgressUnit ?? "");
  const indeterminate = modal.pdfProgressIndeterminate === true;
  const percentage = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  let valueLabel = "";
  if (!indeterminate && total > 0 && unit === "bytes") {
    valueLabel = `${(current / 1_048_576).toFixed(1)} of ${(total / 1_048_576).toFixed(1)} MB`;
  } else if (!indeterminate && total > 0 && unit === "items") {
    valueLabel = `${current} of ${total} images`;
  }
  const progressAttributes = indeterminate
    ? `aria-label="${escapeHtml(modal.pdfStage)}"`
    : `aria-label="${escapeHtml(modal.pdfStage)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percentage}"`;
  const bar = indeterminate || total > 0
    ? `
      <div class="editor-export-modal__pdf-progress-track${indeterminate ? " is-indeterminate" : ""}" role="progressbar" ${progressAttributes}>
        <span class="editor-export-modal__pdf-progress-fill" style="${indeterminate ? "" : `width: ${percentage}%`}"></span>
      </div>
    `
    : "";
  return `
    <div class="editor-export-modal__pdf-progress" aria-live="polite">
      <div class="editor-export-modal__pdf-progress-header">
        <span>${escapeHtml(modal.pdfStage)}</span>
        ${valueLabel ? `<span>${escapeHtml(valueLabel)}</span>` : ""}
      </div>
      ${bar}
    </div>
  `;
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
          placeholder="Search posts or paste URL"
          value="${escapeHtml(wordpress.searchQuery)}"
          data-wordpress-search-input
        />
        ${secondaryButton("Search", "search-wordpress-posts", { disabled: wordpress.searchStatus === "searching" })}
      </div>
      ${renderWordPressSearchResults(wordpress)}
      ${selectedPost
        ? `<p class="editor-export-modal__wordpress-warning" role="alert">Exporting will replace the content of &ldquo;${escapeHtml(selectedPost.title)}&rdquo; on ${escapeHtml(blogLabel)}.</p>`
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

function renderExportSelect({ label, selectAttribute, placeholder, options, value, disabled = false }) {
  return `
    <label class="field editor-export-modal__field">
      <span class="field__label">${escapeHtml(label)}</span>
      <select class="field__input" ${selectAttribute} ${disabled ? "disabled" : ""}>
        <option value="" ${value ? "" : "selected"}>${escapeHtml(placeholder)}</option>
        ${options
          .map((option) => `
            <option value="${escapeHtml(option.value)}" ${option.value === value ? "selected" : ""}>${escapeHtml(option.label)}</option>
          `)
          .join("")}
      </select>
    </label>
  `;
}

// Copy-and-paste and WordPress exports serialize the editor's in-memory rows;
// file and team-copy exports read the repo, so they work from the projects
// page too.
function exportChapterOpenInEditor(modal, appState) {
  return Boolean(modal?.chapterId) && appState?.editorChapter?.chapterId === modal.chapterId;
}

function exportChapterLanguages(modal, appState) {
  const projects = [
    ...(Array.isArray(appState?.projects) ? appState.projects : []),
    ...(Array.isArray(appState?.deletedProjects) ? appState.deletedProjects : []),
  ];
  for (const project of projects) {
    const chapter = (Array.isArray(project?.chapters) ? project.chapters : [])
      .find((entry) => entry?.id === modal?.chapterId);
    if (chapter) {
      return Array.isArray(chapter.languages) ? chapter.languages : [];
    }
  }
  return [];
}

function fileExportLanguageSection(option, modal, appState) {
  // The editor follows the preview toolbar language; XLSX exports every
  // language column at once.
  if (exportChapterOpenInEditor(modal, appState) || option.format === "xlsx") {
    return "";
  }

  const languages = exportChapterLanguages(modal, appState);
  if (languages.length === 0) {
    return "";
  }
  return renderExportSelect({
    label: "Export language",
    selectAttribute: "data-editor-export-language-select",
    placeholder: "Select",
    options: languages.map((language) => ({
      value: language.code,
      label: `${language.name || language.code} (${language.code})`,
    })),
    value: String(modal.languageCode ?? ""),
  });
}

function pdfPaperSizeSection(modal, isExporting) {
  return renderExportSelect({
    label: "Paper size",
    selectAttribute: "data-editor-export-paper-size-select",
    placeholder: "Select",
    options: PDF_PAPER_SIZES,
    value: String(modal.pdfPaperSize || "us-letter"),
    disabled: isExporting,
  });
}

function teamCopyProjectSection(teamCopy) {
  if (!teamCopy.targetTeamId) {
    return supportingText("Choose the team to copy this chapter to.");
  }
  if (teamCopy.projectsStatus === "loading") {
    return supportingText("Loading that team's projects...");
  }
  if (teamCopy.projectsStatus !== "done") {
    return "";
  }
  if (teamCopy.projects.length === 0) {
    return supportingText("That team has no projects yet. Create one there first.");
  }
  return renderExportSelect({
    label: "Project",
    selectAttribute: "data-team-copy-project-select",
    placeholder: "Select",
    options: teamCopy.projects.map((project) => ({
      value: project.id,
      label: project.title || project.name,
    })),
    value: teamCopy.targetProjectId,
  });
}

function teamCopyDetail(teamCopy, isExporting, appState) {
  const targets = eligibleTeamCopyTargets(appState);
  if (targets.length === 0) {
    return {
      bodyMarkup: supportingText(
        "You are not a member of a team where you can add files.",
      ),
      submitButton: "",
    };
  }

  const resolvedTeamCopy = teamCopy ?? {
    targetTeamId: "",
    projectsStatus: "idle",
    projects: [],
    targetProjectId: "",
    copyTitle: "",
    copyStage: "",
  };
  const selectedProject = selectedTeamCopyProject(resolvedTeamCopy);
  const selectedTeam = targets.find((team) => team.id === resolvedTeamCopy.targetTeamId) ?? null;

  return {
    bodyMarkup: `
      ${supportingText("Copy this chapter, including every language and its images, into a project on any team where you can add files — including this one.")}
      ${renderExportSelect({
        label: "Team",
        selectAttribute: "data-team-copy-team-select",
        placeholder: "Select",
        options: targets.map((team) => ({
          value: team.id,
          label: team.name || team.githubOrg || team.id,
        })),
        value: resolvedTeamCopy.targetTeamId,
      })}
      ${teamCopyProjectSection(resolvedTeamCopy)}
      ${selectedProject
        ? `
          <label class="field editor-export-modal__field">
            <span class="field__label">File name</span>
            <input
              class="field__input"
              type="text"
              value="${escapeHtml(resolvedTeamCopy.copyTitle ?? "")}"
              data-team-copy-title-input
            />
          </label>
        `
        : ""}
      ${selectedProject && selectedTeam
        ? supportingText(
          `The copy will appear as a new file in ${selectedProject.title || selectedProject.name} (${selectedTeam.name || selectedTeam.githubOrg || selectedTeam.id}).`,
        )
        : ""}
      ${isExporting && resolvedTeamCopy.copyStage
        ? `<p class="modal__supporting editor-export-modal__team-copy-stage">${escapeHtml(resolvedTeamCopy.copyStage)}</p>`
        : ""}
    `,
    submitButton: loadingPrimaryButton({
      label: "Copy chapter",
      loadingLabel: "Copying...",
      action: "submit-editor-export",
      isLoading: isExporting,
    }),
  };
}

const FOOTNOTE_LINKS_TOOLTIP =
  "When a footnote contains a link like “click here to read more”, the website "
  + "URL isn’t visible when printed on paper. If you are exporting for print, this "
  + "option should be checked so that “click here to read more” will be followed "
  + "by (http://website.com/url) so that readers can type the address by hand if they "
  + "want to read it.";

// Print-oriented options (DOCX, RTF, plain text, Vellum) offer a fallback that prints
// each footnote link's URL in parentheses, since a hyperlink is useless on paper.
function footnoteLinkFallbackSection(option, modal) {
  if (option.printLinkFallback !== true) {
    return "";
  }
  const checked = modal?.footnoteLinksAsPlainText === true;
  return `
    <label class="field__checkbox editor-export-modal__footnote-links" title="${escapeHtml(FOOTNOTE_LINKS_TOOLTIP)}">
      <input
        type="checkbox"
        data-editor-export-footnote-links-toggle
        ${checked ? "checked" : ""}
      />
      <span>Show links in footnotes as plain text</span>
    </label>
  `;
}

const OMIT_CUSTOM_HTML_TOOLTIP =
  "Sections of editor text that are styled as custom HTML are usually intended for "
  + "export to electronic formats only. Check this to omit those sections from the "
  + "output. (recommended)";

// Formats that cannot render raw HTML (DOCX, RTF, TXT, Markdown, XLSX, plain text,
// Vellum) offer to omit custom-HTML rows, which are usually meant for the web.
function omitCustomHtmlSection(option, modal) {
  if (option.omitCustomHtmlOption !== true) {
    return "";
  }
  const checked = modal?.omitCustomHtml === true;
  return `
    <label class="field__checkbox editor-export-modal__omit-custom-html" title="${escapeHtml(OMIT_CUSTOM_HTML_TOOLTIP)}">
      <input
        type="checkbox"
        data-editor-export-omit-custom-html-toggle
        ${checked ? "checked" : ""}
      />
      <span>Omit custom HTML</span>
    </label>
  `;
}

function exportDetail(option, isExporting, modal, appState) {
  if (!option || option.available !== true) {
    return {
      bodyMarkup: supportingText("This export option is not available yet."),
      submitButton: "",
    };
  }

  // Options that serialize the editor's in-memory rows need the chapter open
  // in the editor; from the projects page they point the user there instead.
  const editorOnly = option.kind === "copy"
    || (option.kind === "link" && option.format === "wordpress");
  if (editorOnly && !exportChapterOpenInEditor(modal, appState)) {
    return {
      bodyMarkup: supportingText("Open the file in the editor to use this export option."),
      submitButton: "",
    };
  }

  if (option.kind === "link" && option.format === "wordpress") {
    return wordpressDetail(modal.wordpress, isExporting);
  }

  if (option.kind === "link" && option.format === "team") {
    return teamCopyDetail(modal.teamCopy, isExporting, appState);
  }

  if (option.kind === "file") {
    const pdfProgress = option.format === "pdf" ? renderPdfExportProgress(modal, isExporting) : "";
    const pdfDisclosure = option.format === "pdf" ? pdfFontDisclosure(modal) : "";
    const pdfReady = option.format !== "pdf" || modal.pdfFontStatus === "ready" || isExporting;
    return {
      bodyMarkup: `
        ${supportingText(`Click Save to export a ${option.label} file.`)}
        ${pdfDisclosure}
        ${fileExportLanguageSection(option, modal, appState)}
        ${option.format === "pdf" ? pdfPaperSizeSection(modal, isExporting) : ""}
        ${footnoteLinkFallbackSection(option, modal)}
        ${omitCustomHtmlSection(option, modal)}
        ${pdfProgress}
      `,
      submitButton: pdfReady ? loadingPrimaryButton({
        label: "Save",
        loadingLabel: "Saving...",
        action: "submit-editor-export",
        isLoading: isExporting,
      }) : "",
    };
  }

  return {
    bodyMarkup: `
      ${supportingText(`Click Copy to export ${option.label.toLowerCase()} data to the clipboard for pasting into other apps.`)}
      ${footnoteLinkFallbackSection(option, modal)}
      ${omitCustomHtmlSection(option, modal)}
    `,
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

  const isExporting = modal.status === "exporting" || modal.status === "cancelling";
  const isCancelling = modal.status === "cancelling";
  const option = findEditorExportOption(modal.selectedOptionId);
  const canCancelPdf = isExporting && Boolean(modal.pdfJobId);
  const detail = exportDetail(option, isExporting, modal, state);
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
              ${editorExportCategories().map((category) => renderExportCategory(category, modal)).join("")}
            </nav>
            <div class="editor-export-modal__detail">
              <p class="editor-export-modal__detail-heading">${escapeHtml(option?.label ?? "")}</p>
              ${detail.bodyMarkup}
              ${errorMarkup}
              <div class="modal__actions">
                ${secondaryButton(isCancelling ? "Cancelling…" : canCancelPdf ? "Cancel export" : "Cancel", "close-editor-export-options", {
                  disabled: isCancelling || (isExporting && !canCancelPdf),
                })}
                ${detail.submitButton}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  `;
}
