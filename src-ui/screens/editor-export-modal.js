import { renderProjectBookComposer, renderBookSettingsNotice, bookNavButton } from "./project-book-composer.js";
import {
  escapeHtml,
  loadingPrimaryButton,
  renderCollapseChevron,
  secondaryButton,
  tooltipAttributes,
} from "../lib/ui.js";
import { renderExportSelect, supportingText } from "./export-fields.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import {
  editorExportCategories,
  findEditorExportOption,
} from "../app/editor-export-flow.js";
import {
  DEFAULT_PDF_PAPER_SIZE,
  PDF_PAPER_SIZES,
} from "../app/editor-export-options.js";
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
        ${option.id === selectedOptionId ? "data-modal-initial-focus" : ""}
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
    return "";
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

function savedPdfFontSettings(modal, isExporting) {
  const fonts = Array.isArray(modal.pdfSavedFallbackFonts) ? modal.pdfSavedFallbackFonts : [];
  if (isExporting || modal.pdfFontStatus !== "ready" || fonts.length === 0) { return ""; }
  const expanded = modal.pdfSavedFontsExpanded === true;
  return `
    <div class="editor-export-modal__saved-fonts">
      <button type="button" class="text-action" data-action="toggle-pdf-saved-fonts" aria-expanded="${expanded}" ${modal.pdfForgettingFontId ? "disabled" : ""}>Saved fallback fonts</button>
      ${expanded ? `
        <p class="modal__supporting">These approvals apply to all documents on this computer. Forget an approval to review that font again on a future export.</p>
        <ul class="editor-export-modal__saved-font-list">
          ${fonts.map((font) => `<li>
            <span>${escapeHtml(font.family)}</span>
            ${secondaryButton(modal.pdfForgettingFontId === font.id ? "Forgetting…" : "Forget approval", `forget-pdf-font-approval:${font.id}`, { compact: true, disabled: Boolean(modal.pdfForgettingFontId) })}
          </li>`).join("")}
        </ul>
      ` : ""}
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

function renderWordPressAddSite(wordpress) {
  const addStage = wordpress.addStage ?? "idle";
  if (addStage === "inspecting" || addStage === "oauth" || addStage === "connecting") {
    return supportingText(addStage === "oauth"
      ? "Finish connecting to WordPress.com in your browser."
      : "Connecting to the WordPress site...");
  }
  if (addStage === "credentials") {
    const insecure = String(wordpress.inspection?.siteUrl ?? "").startsWith("http://");
    return `
      ${supportingText(`Connect directly to ${wordpress.inspection?.siteUrl || "this WordPress site"}. Application Passwords are recommended; a normal password works only when the site supports it.`)}
      <label class="field editor-export-modal__wordpress-field">
        <span class="field__label">WordPress username</span>
        <input class="field__input" type="text" value="${escapeHtml(wordpress.username ?? "")}" data-wordpress-username-input />
      </label>
      <label class="field editor-export-modal__wordpress-field">
        <span class="field__label">Application password or site password</span>
        <input class="field__input" type="password" value="${escapeHtml(wordpress.password ?? "")}" data-wordpress-password-input />
      </label>
      ${insecure ? `
        <label class="editor-export-modal__wordpress-http-warning">
          <input type="checkbox" data-wordpress-insecure-input ${wordpress.allowInsecure ? "checked" : ""} />
          I understand that credentials will be sent to ${escapeHtml(wordpress.inspection.siteUrl)} without encryption.
        </label>
      ` : ""}
      <p class="modal__supporting">
        <button type="button" class="text-link" data-action="connect-wordpress">Use WordPress.com login instead</button>
      </p>
      <div class="editor-export-modal__wordpress-actions">
        ${secondaryButton("Cancel", "cancel-add-wordpress-site")}
        <button class="button button--primary" data-action="save-self-hosted-wordpress-site" ${insecure && !wordpress.allowInsecure ? "disabled aria-disabled=\"true\"" : ""}>Connect site</button>
      </div>
    `;
  }
  return `
    <label class="field editor-export-modal__wordpress-field">
      <span class="field__label">WordPress site address</span>
      <input class="field__input" type="url" placeholder="https://example.com" value="${escapeHtml(wordpress.siteUrl ?? "")}" data-wordpress-site-url-input data-modal-enter-action="inspect-wordpress-site" />
    </label>
    ${addStage === "inconclusive" ? `<p class="modal__supporting">
      <button type="button" class="text-link" data-action="connect-wordpress">Use WordPress.com login instead</button>
    </p>` : ""}
    <div class="editor-export-modal__wordpress-actions">
      ${secondaryButton("Cancel", "cancel-add-wordpress-site")}
      <button class="button button--primary" data-action="inspect-wordpress-site">Continue</button>
    </div>
  `;
}

function renderWordPressSitePicker(wordpress) {
  if ((wordpress.addStage ?? "idle") !== "idle") return renderWordPressAddSite(wordpress);
  const sites = wordpress.connections ?? [];
  return `
    ${supportingText(sites.length ? "Choose a connected WordPress site for this file." : "Connect a WordPress site to export this file.")}
    ${sites.length ? `<ul class="editor-export-modal__wordpress-sites">
      ${sites.map((site) => `<li>
        <button type="button" class="editor-export-modal__wordpress-site" data-action="select-wordpress-site:${escapeHtml(site.siteId)}">
          <strong>${escapeHtml(site.displayName || site.siteUrl)}</strong>
          ${site.displayName ? `<span>${escapeHtml(site.siteUrl)}</span>` : ""}
        </button>
        <button type="button" class="editor-export-modal__wordpress-forget" data-action="forget-wordpress-site:${escapeHtml(site.siteId)}" ${tooltipAttributes("Forget this site")} aria-label="Forget this site">&times;</button>
      </li>`).join("")}
    </ul>` : ""}
    <button class="button button--primary" data-action="show-add-wordpress-site">Add a new site</button>
  `;
}

function wordpressDetail(wordpress, isExporting) {
  if (!wordpress || wordpress.connectionStatus === "unknown" || wordpress.connectionStatus === "loading") {
    return {
      bodyMarkup: supportingText("Checking the WordPress connections..."),
      submitButton: "",
    };
  }

  if (wordpress.connectionStatus === "disconnected") {
    return {
      bodyMarkup: renderWordPressSitePicker(wordpress),
      submitButton: "",
    };
  }

  if (wordpress.connectionStatus === "connecting") {
    return { bodyMarkup: supportingText("Finish connecting to WordPress.com in your browser. We will bring you back here automatically."), submitButton: "" };
  }

  if ((wordpress.addStage ?? "idle") !== "idle") {
    return { bodyMarkup: renderWordPressAddSite(wordpress), submitButton: "" };
  }

  const blogLabel = wordpress.connection?.siteUrl || wordpress.connection?.blogUrl || "your WordPress site";
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
          data-modal-enter-action="search-wordpress-posts"
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
        <button type="button" class="editor-export-modal__wordpress-switch" data-action="show-wordpress-site-picker">Switch site</button>
      </p>
      ${wordpress.reauthRequired ? `<p class="editor-export-modal__wordpress-warning" role="alert">${wordpress.authInProgress
        ? "Finish logging in through your browser, then return here."
        : `Log in again to continue with this site. <button type="button" class="button button--secondary" data-action="reconnect-wordpress">Log in again</button>`}</p>` : ""}
      <div class="editor-export-modal__wordpress-modes">
        <label class="editor-export-modal__wordpress-mode${wordpress.mode === "create" ? " is-selected" : ""}">
          <input type="radio" name="wordpress-export-mode" value="create" data-wordpress-mode-input ${wordpress.mode === "create" ? "checked" : ""} />
          <span class="editor-export-modal__wordpress-mode-copy">
            <span class="editor-export-modal__wordpress-mode-title">Create a new draft post</span>
          </span>
        </label>
        <label class="editor-export-modal__wordpress-mode${wordpress.mode === "overwrite" ? " is-selected" : ""}">
          <input type="radio" name="wordpress-export-mode" value="overwrite" data-wordpress-mode-input ${wordpress.mode === "overwrite" ? "checked" : ""} />
          <span class="editor-export-modal__wordpress-mode-copy">
            <span class="editor-export-modal__wordpress-mode-title">Overwrite an existing post</span>
          </span>
        </label>
      </div>
      ${createSection}
      ${overwriteSection}
      ${isExporting && wordpress.exportStage
        ? `<p class="modal__supporting editor-export-modal__wordpress-stage">${escapeHtml(wordpress.exportStage)}</p>`
        : ""}
    `,
    submitButton: `
      ${loadingPrimaryButton({
        label: wordpress.mode === "overwrite" ? "Overwrite post" : "Export draft",
        loadingLabel: "Exporting...",
        action: "submit-editor-export",
        isLoading: isExporting,
        modalDefault: true,
      })}
    `,
  };
}

// Single-chapter clipboard/WordPress exports need the editor; project exports
// read their own snapshots without opening a chapter.
function exportChapterOpenInEditor(modal, appState) {
  return !modal?.projectId && Boolean(modal?.chapterId) && appState?.editorChapter?.chapterId === modal.chapterId;
}

function exportChapterLanguages(modal, appState) {
  if (modal?.projectId) { return modal.languages ?? []; }
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
  if (modal.book || exportChapterOpenInEditor(modal, appState) || option.format === "xlsx") {
    return "";
  }

  const languages = exportChapterLanguages(modal, appState);
  if (languages.length === 0) {
    return "";
  }
  return renderExportSelect({
    id: "editor-export-language",
    label: "Export language",
    selectAttributes: { "data-editor-export-language-select": true },
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
    id: "editor-export-paper-size",
    label: "Paper size",
    selectAttributes: { "data-editor-export-paper-size-select": true },
    placeholder: "Select",
    options: PDF_PAPER_SIZES,
    value: String(modal.pdfPaperSize || DEFAULT_PDF_PAPER_SIZE),
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
    id: "editor-export-team-project",
    label: "Project",
    selectAttributes: { "data-team-copy-project-select": true },
    placeholder: "Select",
    options: teamCopy.projects.map((project) => ({
      value: project.id,
      label: project.title || project.name,
    })),
    value: teamCopy.targetProjectId,
  });
}

function teamCopyDetail(teamCopy, isExporting, appState, modal) {
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
      ${supportingText(modal?.projectId ? "Copy all project chapters in order, including every language and its images, into the selected project." : "Copy this chapter, including every language and its images, into a project on any team where you can add files — including this one.")}
      ${renderExportSelect({
        id: "editor-export-team",
        label: "Team",
        selectAttributes: { "data-team-copy-team-select": true },
        placeholder: "Select",
        options: targets.map((team) => ({
          value: team.id,
          label: team.name || team.githubOrg || team.id,
        })),
        value: resolvedTeamCopy.targetTeamId,
      })}
      ${teamCopyProjectSection(resolvedTeamCopy)}
      ${selectedProject && !modal?.projectId
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
          `${modal?.projectId ? "The copies will appear as new files" : "The copy will appear as a new file"} in ${selectedProject.title || selectedProject.name} (${selectedTeam.name || selectedTeam.githubOrg || selectedTeam.id}).`,
        )
        : ""}
      ${isExporting && resolvedTeamCopy.copyStage
        ? `<p class="modal__supporting editor-export-modal__team-copy-stage">${escapeHtml(resolvedTeamCopy.copyStage)}</p>`
        : ""}
    `,
    submitButton: loadingPrimaryButton({
      label: modal?.projectId ? "Copy chapters" : "Copy chapter",
      loadingLabel: "Copying...",
      action: "submit-editor-export",
      isLoading: isExporting,
      modalDefault: true,
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
    <label class="field__checkbox editor-export-modal__footnote-links" ${tooltipAttributes(FOOTNOTE_LINKS_TOOLTIP)}>
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
    <label class="field__checkbox editor-export-modal__omit-custom-html" ${tooltipAttributes(OMIT_CUSTOM_HTML_TOOLTIP)}>
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
  if (editorOnly && !modal.projectId && !exportChapterOpenInEditor(modal, appState)) {
    return {
      bodyMarkup: supportingText("Open the file in the editor to use this export option."),
      submitButton: "",
    };
  }

  if (option.kind === "link" && option.format === "wordpress") {
    const detail = wordpressDetail(modal.wordpress, isExporting);
    if (modal.projectId) detail.bodyMarkup = fileExportLanguageSection(option, modal, appState) + detail.bodyMarkup;
    return detail;
  }

  if (option.kind === "link" && option.format === "team") {
    return teamCopyDetail(modal.teamCopy, isExporting, appState, modal);
  }

  if (option.kind === "file") {
    const pdfProgress = option.format === "pdf" ? renderPdfExportProgress(modal, isExporting) : "";
    const pdfDisclosure = option.format === "pdf" ? pdfFontDisclosure(modal) : "";
    const pdfReady = option.format !== "pdf" || modal.pdfFontStatus === "ready" || isExporting;
    const pdfChecking = option.format === "pdf" && !isExporting
      && ["idle", "loading"].includes(modal.pdfFontStatus);
    const article = ["html", "xlsx", "rtf", "srt"].includes(option.format) ? "an" : "a";
    return {
      bodyMarkup: `
        ${supportingText(option.format === "md"
          ? `Save ${modal.book ? "your arranged book" : modal.projectId ? "all chapters in sequence" : "this chapter"} as a Markdown (.md) file.`
          : `Save ${modal.book ? "your arranged book" : modal.projectId ? "all chapters in sequence" : "this chapter"} as ${article} ${option.label} file.`)}
        ${pdfDisclosure}
        ${fileExportLanguageSection(option, modal, appState)}
        ${option.format === "pdf" ? pdfPaperSizeSection(modal, isExporting) : ""}
        ${footnoteLinkFallbackSection(option, modal)}
        ${omitCustomHtmlSection(option, modal)}
        ${option.format === "pdf" ? savedPdfFontSettings(modal, isExporting) : ""}
        ${pdfProgress}
      `,
      submitButton: pdfReady || pdfChecking ? loadingPrimaryButton({
        label: "Save",
        loadingLabel: pdfChecking ? "Save" : modal.pdfForgettingFontId ? "Updating fonts…" : "Saving...",
        action: "submit-editor-export",
        isLoading: pdfChecking || isExporting || Boolean(modal.pdfForgettingFontId),
        modalDefault: true,
      }) : "",
    };
  }

  return {
    bodyMarkup: `
      ${modal.projectId ? fileExportLanguageSection(option, modal, appState) : ""}
      ${supportingText(`Click Copy to export ${option.label.toLowerCase()} data to the clipboard for pasting into other apps.`)}
      ${footnoteLinkFallbackSection(option, modal)}
      ${omitCustomHtmlSection(option, modal)}
    `,
    submitButton: loadingPrimaryButton({
      label: "Copy",
      loadingLabel: "Copying...",
      action: "submit-editor-export",
      isLoading: isExporting,
      modalDefault: true,
    }),
  };
}

function renderPdfFontReview(modal) {
  const review = modal.pdfFontReview;
  const isPublishing = modal.status === "exporting";
  const isCancelling = modal.status === "cancelling";
  const families = Array.isArray(review.fontFamilies) ? review.fontFamilies.join(", ") : "installed fonts";
  const excerpts = (Array.isArray(review.excerpts) ? review.excerpts : [])
    .filter((excerpt) => /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/.test(excerpt.imageDataUrl ?? ""));
  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--pdf-font-review" role="dialog" aria-modal="true" aria-labelledby="pdf-font-review-title" aria-describedby="pdf-font-review-description" data-modal-dialog="editor-export" tabindex="-1">
        <div class="card__body modal-card__body">
          <h2 class="modal__title" id="pdf-font-review-title">Review fallback fonts</h2>
          <p class="modal__supporting" id="pdf-font-review-description">Some characters need an installed font: <strong>${escapeHtml(families)}</strong>. Review the highlighted characters below.</p>
          <p class="modal__supporting">Only affected passages are shown. The complete PDF will use these fonts without highlights.</p>
          <p class="modal__supporting">Your font choices will be remembered for future PDF exports on this computer.</p>
          <div class="pdf-font-review__excerpts" aria-label="Affected passages">
            ${excerpts.map((excerpt) => `
              <figure class="pdf-font-review__excerpt">
                <figcaption>${escapeHtml(excerpt.label)}</figcaption>
                <img src="${escapeHtml(excerpt.imageDataUrl)}" alt="${escapeHtml(excerpt.label)} with fallback characters highlighted" />
              </figure>
            `).join("")}
          </div>
          ${modal.error ? `<p class="modal__error" role="alert">${escapeHtml(formatErrorForDisplay(modal.error))}</p>` : ""}
          <div class="modal__actions">
            ${secondaryButton(isCancelling ? "Cancelling…" : "Cancel", "close-editor-export-options", {
              disabled: isCancelling, modalCancel: true, modalInitialFocus: true,
            })}
            ${excerpts.length > 0 ? loadingPrimaryButton({
              label: "Publish with these fonts", loadingLabel: "Publishing…", action: "submit-editor-export",
              isLoading: isPublishing || isCancelling,
            }) : ""}
          </div>
        </div>
      </section>
    </div>
  `;
}

export function renderEditorExportModal(state) {
  const modal = state.editorChapter?.exportModal;
  if (!modal?.isOpen) {
    return "";
  }
  if (modal.pdfFontReview) {
    return renderPdfFontReview(modal);
  }

  if (modal.projectId && modal.book && modal.page === 1) return renderProjectBookComposer(modal);

  const isExporting = modal.status === "exporting" || modal.status === "cancelling";
  const isCancelling = modal.status === "cancelling";
  const option = findEditorExportOption(modal.selectedOptionId, modal);
  const canCancelPdf = isExporting && Boolean(modal.pdfJobId);
  const detail = exportDetail(option, isExporting, modal, state);
  const errorMarkup = modal.error
    ? `<p class="modal__error" role="alert">${escapeHtml(formatErrorForDisplay(modal.error))}</p>`
    : "";
  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--editor-export" role="dialog" aria-modal="true" aria-labelledby="editor-export-modal-title" data-modal-dialog="editor-export" tabindex="-1">
        <div class="card__body modal-card__body modal-card__body--editor-export">
          <header class="editor-export-modal__header">
            ${modal.projectId && modal.book ? bookNavButton("previous", isExporting) : ""}
            <h2 class="modal__title" id="editor-export-modal-title">${modal.projectId ? "Export project" : "Export chapter"}</h2>
          </header>
          <div class="editor-export-modal">
            <nav class="editor-export-modal__nav" aria-label="Export options">
              ${editorExportCategories(modal).map((category) => renderExportCategory(category, modal)).join("")}
            </nav>
            <div class="editor-export-modal__detail">
              <p class="editor-export-modal__detail-heading">${escapeHtml(option?.label ?? "")}</p>
              ${!modal.book && modal.projectId ? supportingText(`${modal.chapterIds.length} files in project order.`) : ""}
              ${modal.projectId && !modal.languages.length && option?.format !== "team" ? `<p class="modal__error" role="alert">These files have no language in common. Add the same language to every file before exporting a combined document.</p>` : ""}
              ${detail.bodyMarkup}
              ${errorMarkup}
              <div class="modal__actions">
                ${secondaryButton(isCancelling ? "Cancelling…" : canCancelPdf ? "Cancel export" : "Cancel", "close-editor-export-options", {
                  disabled: isCancelling || (isExporting && !canCancelPdf),
                  modalCancel: true,
                })}
                ${modal.projectId && !modal.languages.length && option?.format !== "team" ? "" : detail.submitButton}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
    ${renderBookSettingsNotice(modal)}
  `;
}
