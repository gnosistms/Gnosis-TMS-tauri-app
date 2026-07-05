import {
  renderActiveChapterRow,
  renderClearDeletedFilesAction,
  renderDeletedChapterRow,
  renderDeletedFilesToggle,
} from "./project-chapter-list-render.js";
import {
  deriveProjectRenderState,
  renderProjectCardHeader,
} from "./project-list-render.js";

// Renders the flat item model from projects-list-model.js. Each item is a
// sibling row; card chrome (borders, radius, shadow, inter-card gap) comes
// from segment classes so any contiguous run of a project's items composes
// into the same visuals as the old single-article card.

const ITEM_TYPE_CLASS = {
  "project-header": "header",
  "project-file": "file",
  "project-empty-body": "empty-body",
  "deleted-toggle": "deleted-toggle",
  "deleted-clear": "deleted-clear",
  "deleted-file": "deleted-file",
};

function derivedStateForItem(item, context) {
  let derived = context.derivedByProjectId.get(item.projectId);
  if (!derived) {
    derived = deriveProjectRenderState(item.project, {
      ...context.projectOptions,
      showDeletedFiles: context.expandedDeletedFiles.has(item.projectId),
      syncSnapshot: context.syncSnapshotsByProjectId[item.projectId] ?? null,
    });
    context.derivedByProjectId.set(item.projectId, derived);
  }
  return derived;
}

function renderItemContent(item, derived) {
  switch (item.type) {
    case "project-file":
      return renderActiveChapterRow(item.chapter, derived.fileRowOptions);
    case "project-empty-body":
      return "";
    case "deleted-toggle":
      return renderDeletedFilesToggle(item.project, derived.fileRowOptions);
    case "deleted-clear":
      return renderClearDeletedFilesAction(item.project, derived.fileRowOptions);
    case "deleted-file":
      return renderDeletedChapterRow(item.chapter, derived.fileRowOptions);
    default:
      return "";
  }
}

export function createProjectsListRenderContext(state, projectOptions) {
  return {
    projectOptions,
    expandedProjects: state.expandedProjects instanceof Set ? state.expandedProjects : new Set(),
    expandedDeletedFiles: state.expandedDeletedFiles instanceof Set ? state.expandedDeletedFiles : new Set(),
    syncSnapshotsByProjectId: state.projectRepoSyncByProjectId ?? {},
    derivedByProjectId: new Map(),
  };
}

export function renderProjectsListItem(item, context, { isFirstItem = false } = {}) {
  const derived = derivedStateForItem(item, context);
  const expanded = context.expandedProjects.has(item.projectId);
  const itemClasses = [
    "project-vlist__item",
    item.isCardStart ? "project-vlist__item--card-start" : "",
    isFirstItem ? "project-vlist__item--first" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const cardClasses = [
    "project-vlist__card",
    `project-vlist__card--${ITEM_TYPE_CLASS[item.type] ?? "row"}`,
    item.isCardStart ? "project-vlist__card--start" : "",
    item.isCardEnd ? "project-vlist__card--end" : "",
    item.isBodyStart ? "project-vlist__card--body-start" : "",
    item.type === "deleted-file" && item.isFirstDeletedFile ? "project-vlist__card--deleted-file-first" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <div
      class="${itemClasses}"
      data-projects-item-key="${item.key}"
      data-projects-item-project="${item.projectId}"
    >
      <div class="${cardClasses}">
        ${
          item.type === "project-header"
            ? renderProjectCardHeader(item.project, expanded, derived)
            : renderItemContent(item, derived)
        }
      </div>
    </div>
  `;
}

export function renderProjectsListItemsRange(items, context, startIndex, endIndex) {
  const safeStart = Math.max(0, startIndex);
  const safeEnd = Math.min(Array.isArray(items) ? items.length : 0, endIndex);
  let markup = "";
  for (let index = safeStart; index < safeEnd; index += 1) {
    markup += renderProjectsListItem(items[index], context, { isFirstItem: index === 0 });
  }
  return markup;
}

export function renderProjectsVirtualList(items, context, windowState = null) {
  const itemCount = Array.isArray(items) ? items.length : 0;
  const startIndex = windowState ? windowState.startIndex : 0;
  const endIndex = windowState ? windowState.endIndex : itemCount;
  const topSpacerHeight = windowState ? windowState.topSpacerHeight : 0;
  const bottomSpacerHeight = windowState ? windowState.bottomSpacerHeight : 0;

  return `
    <section class="project-vlist" data-projects-virtual-list>
      <div
        class="project-vlist__spacer"
        data-projects-virtual-spacer="top"
        style="height: ${topSpacerHeight}px;"
      ></div>
      <div class="project-vlist__items" data-projects-virtual-items>
        ${renderProjectsListItemsRange(items, context, startIndex, endIndex)}
      </div>
      <div
        class="project-vlist__spacer"
        data-projects-virtual-spacer="bottom"
        style="height: ${bottomSpacerHeight}px;"
      ></div>
    </section>
  `;
}
