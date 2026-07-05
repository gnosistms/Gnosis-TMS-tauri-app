// Flat item model for the projects page list.
//
// The projects screen renders one visual "card" per project, but the DOM is a
// flat sequence of sibling row items so the list can be virtualized: a project
// contributes a header item plus, while expanded, one item per file row and
// per deleted-files-section row. Card chrome (borders, radius, shadow) is
// composed from per-item segment classes at render time.
//
// Item keys are stable across renders and encode the owning project so a
// scroll anchor that points at a vanished row (file deleted, project
// collapsed) can fall back to the project header.

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

export function projectHeaderItemKey(projectId) {
  return `p:${projectId}`;
}

export function parseProjectsListItemProjectId(itemKey) {
  if (typeof itemKey !== "string") {
    return "";
  }

  const separatorIndex = itemKey.indexOf(":");
  if (separatorIndex < 0) {
    return "";
  }

  const rest = itemKey.slice(separatorIndex + 1);
  const chapterSeparatorIndex = rest.indexOf(":");
  return chapterSeparatorIndex < 0 ? rest : rest.slice(0, chapterSeparatorIndex);
}

function pushProjectItems(items, project, options) {
  const projectId = String(project?.id ?? "");
  const expanded = options.expandedProjects.has(projectId);
  const headerItem = {
    type: "project-header",
    key: projectHeaderItemKey(projectId),
    projectId,
    project,
    isCardStart: true,
    isCardEnd: !expanded,
  };
  items.push(headerItem);
  if (!expanded) {
    return;
  }

  const allFiles = Array.isArray(project.chapters) ? project.chapters : [];
  const files = allFiles.filter((chapter) => chapter?.status !== "deleted").sort(compareFilesByName);
  const deletedFiles = allFiles.filter((chapter) => chapter?.status === "deleted").sort(compareFilesByName);
  const firstBodyLength = items.length;

  for (const chapter of files) {
    items.push({
      type: "project-file",
      key: `f:${projectId}:${chapter.id}`,
      projectId,
      project,
      chapter,
      isCardStart: false,
      isCardEnd: false,
      isBodyStart: items.length === firstBodyLength,
    });
  }

  if (deletedFiles.length > 0) {
    items.push({
      type: "deleted-toggle",
      key: `dt:${projectId}`,
      projectId,
      project,
      deletedFileCount: deletedFiles.length,
      isCardStart: false,
      isCardEnd: false,
      isBodyStart: items.length === firstBodyLength,
    });

    if (options.expandedDeletedFiles.has(projectId)) {
      if (options.canPermanentlyDeleteFiles) {
        items.push({
          type: "deleted-clear",
          key: `dc:${projectId}`,
          projectId,
          project,
          isCardStart: false,
          isCardEnd: false,
          isBodyStart: false,
        });
      }

      let isFirstDeletedFile = true;
      for (const chapter of deletedFiles) {
        items.push({
          type: "deleted-file",
          key: `df:${projectId}:${chapter.id}`,
          projectId,
          project,
          chapter,
          isCardStart: false,
          isCardEnd: false,
          isBodyStart: false,
          isFirstDeletedFile,
        });
        isFirstDeletedFile = false;
      }
    }
  }

  if (items.length === firstBodyLength) {
    items.push({
      type: "project-empty-body",
      key: `e:${projectId}`,
      projectId,
      project,
      isCardStart: false,
      isCardEnd: false,
      isBodyStart: true,
    });
  }

  items[items.length - 1].isCardEnd = true;
}

/**
 * Build the flat item list for the active projects stack.
 *
 * `source` needs `projects`, `expandedProjects`, and `expandedDeletedFiles`
 * (the app state object satisfies this). `options.canPermanentlyDeleteFiles`
 * controls whether the "Clear all deleted files" row exists, mirroring the
 * render-time capability gate.
 */
export function buildProjectsListItems(source, options = {}) {
  const projects = Array.isArray(source?.projects) ? source.projects : [];
  const expandedProjects = source?.expandedProjects instanceof Set ? source.expandedProjects : new Set();
  const expandedDeletedFiles = source?.expandedDeletedFiles instanceof Set ? source.expandedDeletedFiles : new Set();
  const items = [];

  for (const project of projects) {
    pushProjectItems(items, project, {
      expandedProjects,
      expandedDeletedFiles,
      canPermanentlyDeleteFiles: options.canPermanentlyDeleteFiles === true,
    });
  }

  return items;
}

// Estimated heights feed the virtualizer before an item has been measured.
// They include the item's own vertical padding (inter-card gap on card-start
// items, body paddings) so spacer math stays additive; real heights replace
// them after first render.
const PROJECTS_LIST_CARD_GAP_PX = 16;
const PROJECTS_LIST_BODY_TOP_PADDING_PX = 24;
const PROJECTS_LIST_BODY_BOTTOM_PADDING_PX = 28;

export const PROJECTS_VIRTUALIZATION_MIN_ITEMS = 60;
export const PROJECTS_VIRTUALIZATION_OVERSCAN_PX = 600;
export const PROJECTS_VIRTUALIZATION_INITIAL_VIEWPORT_PX = 900;

/**
 * Pre-DOM window calculation for the initial HTML of a full screen render.
 * `scrollTop` is list-relative (caller subtracts the list's own offset in the
 * scroll container). No inter-item gap: spacing is padding inside the items.
 */
export function calculateProjectsVirtualWindow(itemHeights, scrollTop, viewportHeight) {
  const itemCount = Array.isArray(itemHeights) ? itemHeights.length : 0;
  if (itemCount === 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
    };
  }

  const safeViewportHeight =
    Number.isFinite(viewportHeight) && viewportHeight > 0
      ? viewportHeight
      : PROJECTS_VIRTUALIZATION_INITIAL_VIEWPORT_PX;
  const safeScrollTop = Number.isFinite(scrollTop) && scrollTop > 0 ? scrollTop : 0;
  const targetStart = Math.max(0, safeScrollTop - PROJECTS_VIRTUALIZATION_OVERSCAN_PX);
  const targetEnd = safeScrollTop + safeViewportHeight + PROJECTS_VIRTUALIZATION_OVERSCAN_PX;

  let startIndex = itemCount - 1;
  let topSpacerHeight = 0;
  let cursorTop = 0;
  for (let index = 0; index < itemCount; index += 1) {
    const itemBottom = cursorTop + (itemHeights[index] ?? 0);
    if (itemBottom >= targetStart) {
      startIndex = index;
      topSpacerHeight = cursorTop;
      break;
    }

    cursorTop = itemBottom;
    topSpacerHeight = cursorTop;
  }

  let endIndex = startIndex + 1;
  let visibleTop = topSpacerHeight;
  for (let index = startIndex; index < itemCount; index += 1) {
    const itemBottom = visibleTop + (itemHeights[index] ?? 0);
    endIndex = index + 1;
    if (itemBottom >= targetEnd) {
      break;
    }

    visibleTop = itemBottom;
  }

  let bottomSpacerHeight = 0;
  for (let index = endIndex; index < itemCount; index += 1) {
    bottomSpacerHeight += itemHeights[index] ?? 0;
  }

  return {
    startIndex,
    endIndex,
    topSpacerHeight,
    bottomSpacerHeight,
  };
}

export function estimateProjectsListItemHeight(item) {
  let height = 0;
  switch (item?.type) {
    case "project-header":
      height = 63;
      break;
    case "project-file":
      height = 40 + (item.isBodyStart ? PROJECTS_LIST_BODY_TOP_PADDING_PX : 12);
      break;
    case "project-empty-body":
      height = PROJECTS_LIST_BODY_TOP_PADDING_PX + PROJECTS_LIST_BODY_BOTTOM_PADDING_PX;
      break;
    case "deleted-toggle":
      height = 27 + 18 + (item.isBodyStart ? PROJECTS_LIST_BODY_TOP_PADDING_PX : 0);
      break;
    case "deleted-clear":
      height = 28;
      break;
    case "deleted-file":
      height = 30 + (item.isFirstDeletedFile ? 10 : 12);
      break;
    default:
      height = 40;
      break;
  }

  if (item?.isCardStart) {
    height += PROJECTS_LIST_CARD_GAP_PX;
  }
  if (item?.isCardEnd && item?.type !== "project-header") {
    height += PROJECTS_LIST_BODY_BOTTOM_PADDING_PX;
  }

  return height;
}
