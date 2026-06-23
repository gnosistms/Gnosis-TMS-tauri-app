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

function renderExportSelect({ label, selectAttribute, placeholder, options, value }) {
  return `
    <label class="field editor-export-modal__field">
      <span class="field__label">${escapeHtml(label)}</span>
      <select class="field__input" ${selectAttribute}>
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
    return {
      bodyMarkup: `
        ${supportingText(`Click Save to export a ${option.label} file.`)}
        ${fileExportLanguageSection(option, modal, appState)}
      `,
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
