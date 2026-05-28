import {
  escapeHtml,
  iconAction,
  sectionSeparator,
  textAction,
  tooltipAttributes,
} from "../lib/ui.js";
import { resolveChapterSourceWordCount } from "../app/translate-flow.js";
import {
  projectHasPendingDeletedFileMutation,
  resourceHasPendingLifecycleMutation,
} from "../app/project-page-write-state.js";
import { renderChapterStatusBadge } from "./project-chapter-status-badge.js";
import { renderChapterGlossarySelect } from "./project-glossary-selector.js";
import {
  LUCIDE_FOLDER_PEN_ICON,
  LUCIDE_LIST_PLUS_ICON,
  LUCIDE_SQUARE_ARROW_RIGHT_EXIT_ICON,
  LUCIDE_TRASH_2_ICON,
} from "./project-icons.js";

export function compareFilesByName(left, right) {
  const leftName = typeof left?.name === "string" ? left.name.trim() : "";
  const rightName = typeof right?.name === "string" ? right.name.trim() : "";
  const nameComparison = leftName.localeCompare(rightName, undefined, {
    sensitivity: "base",
    numeric: true,
  });
  if (nameComparison !== 0) {
    return nameComparison;
  }

  return String(left?.id ?? "").localeCompare(String(right?.id ?? ""), undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function renderActiveChapterRow(chapter, options) {
  const sourceWordCount = resolveChapterSourceWordCount(chapter);
  const sourceWordText = sourceWordCount > 0 ? `${sourceWordCount} source words` : "";
  const hasImportedEditorConflicts = chapter.hasImportedEditorConflicts === true;

  return `
    <div class="chapter-table__row chapter-table__row--file">
      <div class="chapter-table__title-wrap chapter-table__title-wrap--interactive" data-action="open-translate:${chapter.id}"${tooltipAttributes("Open")}>
        <button class="chapter-table__name-button" data-action="open-translate:${chapter.id}">
          ${escapeHtml(chapter.name)}
        </button>
        ${
          sourceWordText
            ? `<span class="chapter-table__meta">${escapeHtml(sourceWordText)}</span>`
            : ""
        }
        ${
          hasImportedEditorConflicts
            ? `<span class="chapter-table__conflict-badge">Has conflicts</span>`
            : ""
        }
      </div>
      <div class="chapter-table__actions">
        ${renderChapterStatusBadge(chapter, {
          disabled:
            options.offlineMode
            || options.lifecycleActionsDisabled
            || options.glossaryChangesDisabled
            || options.disableContentActions
            || !options.canManageProjects,
        })}
        ${renderChapterGlossarySelect(chapter, options.glossaryOptions, {
          disabled:
            options.offlineMode
            || options.lifecycleActionsDisabled
            || options.glossaryChangesDisabled
            || options.disableContentActions
            || !options.canManageProjects,
        })}
        ${options.canManageProjects ? iconAction("Add translations", `add-translation-to-file:${chapter.id}`, LUCIDE_LIST_PLUS_ICON, {
          disabled: options.localRepoUnavailable || options.disableContentActions,
          tooltip: "Add translations",
        }) : ""}
        ${options.canDownloadFiles ? iconAction("Export", `export-file:${chapter.id}`, LUCIDE_SQUARE_ARROW_RIGHT_EXIT_ICON, {
          disabled: options.localRepoUnavailable || options.disableContentActions,
          iconClassName: "icon-action__icon--rotate-left",
          tooltip: "Export",
        }) : ""}
        ${options.canManageProjects ? iconAction("Rename", `rename-file:${chapter.id}`, LUCIDE_FOLDER_PEN_ICON, {
          disabled: options.offlineMode || options.lifecycleActionsDisabled || options.disableContentActions,
          tooltip: "Rename",
        }) : ""}
        ${options.canManageProjects ? iconAction("Delete", `delete-file:${chapter.id}`, LUCIDE_TRASH_2_ICON, {
          disabled: options.offlineMode || options.lifecycleActionsDisabled || options.disableContentActions,
          tooltip: "Delete",
        }) : ""}
      </div>
    </div>
  `;
}

function renderDeletedChapterRow(chapter, options) {
  return `
    <div class="chapter-table__row chapter-table__row--file chapter-table__row--deleted">
      <div class="chapter-table__title-wrap">
        <span class="chapter-table__name">${escapeHtml(chapter.name)}</span>
      </div>
      <div class="chapter-table__actions">
        ${options.canManageProjects ? textAction("Restore", `restore-file:${chapter.id}`, {
          disabled: options.offlineMode || options.lifecycleActionsDisabled || options.disableContentActions,
        }) : ""}
        ${options.canPermanentlyDeleteFiles ? textAction("Delete", `delete-deleted-file:${chapter.id}`, {
          disabled:
            options.localHardDeleteActionsDisabled
            || options.disableContentActions
            || resourceHasPendingLifecycleMutation(chapter),
        }) : ""}
      </div>
    </div>
  `;
}

function renderDeletedFilesSection(project, deletedFiles, options) {
  if (deletedFiles.length === 0) {
    return "";
  }

  return `
    <div class="project-files__deleted">
      ${sectionSeparator({
        label: options.showDeletedFiles ? "Hide deleted files" : "Show deleted files",
        action: `toggle-deleted-files:${project.id}`,
        isOpen: options.showDeletedFiles,
      })}
      ${
        options.showDeletedFiles
          ? `
            ${
              options.canPermanentlyDeleteFiles
                ? `<div class="chapter-table__actions">
                    ${textAction("Clear all deleted files", `clear-deleted-files:${project.id}`, {
                      disabled:
                        options.localHardDeleteActionsDisabled
                        || options.disableContentActions
                        || projectHasPendingDeletedFileMutation(project),
                    })}
                  </div>`
                : ""
            }
            <div class="chapter-table chapter-table--deleted">
              ${deletedFiles.map((chapter) => renderDeletedChapterRow(chapter, options)).join("")}
            </div>
          `
          : ""
      }
    </div>
  `;
}

export function renderProjectFilesBody(project, options = {}) {
  const allFiles = Array.isArray(project.chapters) ? project.chapters : [];
  const files = allFiles.filter((chapter) => chapter?.status !== "deleted").sort(compareFilesByName);
  const deletedFiles = allFiles.filter((chapter) => chapter?.status === "deleted").sort(compareFilesByName);

  return `
    <div class="expandable-card__body">
      <div class="chapter-table">
        ${files.map((chapter) => renderActiveChapterRow(chapter, options)).join("")}
      </div>
      ${renderDeletedFilesSection(project, deletedFiles, options)}
    </div>
  `;
}

export function visibleProjectFileCount(project) {
  return (Array.isArray(project?.chapters) ? project.chapters : [])
    .filter((chapter) => chapter?.status !== "deleted")
    .length;
}
