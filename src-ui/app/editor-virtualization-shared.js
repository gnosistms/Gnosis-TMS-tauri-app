export const EDITOR_ROW_GAP_PX = 24;
export const EDITOR_VIRTUALIZATION_MIN_ROWS = 25;
export const EDITOR_VIRTUALIZATION_OVERSCAN_PX = 600;
export const EDITOR_VIRTUALIZATION_INITIAL_VIEWPORT_PX = 900;
export const EDITOR_VIRTUALIZATION_SCROLL_REASON = "scroll";

export function nextScheduledEditorRenderReason(currentReason, nextReason) {
  const normalizedCurrent = typeof currentReason === "string" ? currentReason : "";
  const normalizedNext = typeof nextReason === "string" ? nextReason : "";

  if (!normalizedCurrent) {
    return normalizedNext;
  }
  if (!normalizedNext) {
    return normalizedCurrent;
  }

  if (normalizedCurrent === EDITOR_VIRTUALIZATION_SCROLL_REASON && normalizedNext !== EDITOR_VIRTUALIZATION_SCROLL_REASON) {
    return normalizedNext;
  }

  return normalizedCurrent;
}

export function resolveEditorVirtualRangeState(virtualItems, totalSize = 0) {
  const items = Array.isArray(virtualItems) ? virtualItems : [];
  if (items.length === 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      topSpacerHeight: 0,
      bottomSpacerHeight: Math.max(0, Math.round(totalSize || 0)),
      rangeKey: "0:0",
    };
  }

  const firstItem = items[0];
  const lastItem = items[items.length - 1];
  const startIndex = Number.isInteger(firstItem?.index) ? firstItem.index : 0;
  const endIndex = Number.isInteger(lastItem?.index) ? lastItem.index + 1 : startIndex;
  const topSpacerHeight =
    Number.isFinite(firstItem?.start) && firstItem.start > 0
      ? firstItem.start
      : 0;
  const lastItemEnd =
    Number.isFinite(lastItem?.end) && lastItem.end > 0
      ? lastItem.end
      : topSpacerHeight;
  const bottomSpacerHeight = Math.max(0, (Number.isFinite(totalSize) ? totalSize : 0) - lastItemEnd);

  return {
    startIndex,
    endIndex,
    topSpacerHeight,
    bottomSpacerHeight,
    rangeKey: `${startIndex}:${endIndex}`,
  };
}

function clampIndex(index, count) {
  if (count <= 0) {
    return 0;
  }

  return Math.min(Math.max(index, 0), count - 1);
}

export function estimateEditorRowHeight(
  row,
  collapsedLanguageCodes = new Set(),
  fontSizePx = 20,
) {
  if (row?.kind === "deleted-group") {
    return 44;
  }

  const sections = Array.isArray(row?.sections) ? row.sections : [];
  const expandedSections = sections.filter((section) => !collapsedLanguageCodes.has(section.code)).length;
  const collapsedSections = sections.length - expandedSections;
  const expandedFootnotes = sections
    .filter((section) => !collapsedLanguageCodes.has(section.code))
    .filter((section) => section?.hasVisibleFootnote === true)
    .length;
  const expandedImages = sections
    .filter((section) => !collapsedLanguageCodes.has(section.code))
    .filter((section) => section?.image)
    .length;
  const expandedImageEditors = sections
    .filter((section) => !collapsedLanguageCodes.has(section.code))
    .filter((section) => section?.isImageUrlEditorOpen === true || section?.isImageUploadEditorOpen === true)
    .length;
  const expandedInvalidImageBanners = sections
    .filter((section) => !collapsedLanguageCodes.has(section.code))
    .filter((section) => section?.showInvalidImageUrl === true)
    .length;
  const lineHeight = Math.max(fontSizePx * 1.5, 32);

  return Math.ceil(
    44
    + expandedSections * Math.max(118, lineHeight + 78)
    + expandedFootnotes * Math.max(56, lineHeight + 18)
    + expandedImages * 126
    + expandedImageEditors * 92
    + expandedInvalidImageBanners * 64
    + collapsedSections * 34
    + Math.max(0, sections.length - 1) * 16,
  );
}

export function buildEditorRowHeights(
  rows,
  rowHeightById = new Map(),
  collapsedLanguageCodes = new Set(),
  fontSizePx = 20,
) {
  return rows.map((row) => rowHeightById.get(row.id) ?? estimateEditorRowHeight(row, collapsedLanguageCodes, fontSizePx));
}

function sumValues(values, startIndex, endIndexExclusive) {
  let total = 0;
  for (let index = startIndex; index < endIndexExclusive; index += 1) {
    total += values[index] ?? 0;
  }
  return total;
}

export function calculateEditorVirtualWindow(
  rowHeights,
  scrollTop,
  viewportHeight,
  pinnedRowIndex = -1,
) {
  const rowCount = Array.isArray(rowHeights) ? rowHeights.length : 0;
  if (rowCount === 0) {
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
      : EDITOR_VIRTUALIZATION_INITIAL_VIEWPORT_PX;
  const safeScrollTop = Number.isFinite(scrollTop) && scrollTop > 0 ? scrollTop : 0;
  const targetStart = Math.max(0, safeScrollTop - EDITOR_VIRTUALIZATION_OVERSCAN_PX);
  const targetEnd = safeScrollTop + safeViewportHeight + EDITOR_VIRTUALIZATION_OVERSCAN_PX;

  let startIndex = 0;
  let cursorTop = 0;
  for (let index = 0; index < rowCount; index += 1) {
    const rowBottom = cursorTop + rowHeights[index];
    if (rowBottom >= targetStart) {
      startIndex = index;
      break;
    }

    cursorTop = rowBottom + EDITOR_ROW_GAP_PX;
    startIndex = rowCount - 1;
  }

  let endIndex = startIndex + 1;
  let visibleTop = sumValues(rowHeights, 0, startIndex) + startIndex * EDITOR_ROW_GAP_PX;
  for (let index = startIndex; index < rowCount; index += 1) {
    const rowBottom = visibleTop + rowHeights[index];
    endIndex = index + 1;
    if (rowBottom >= targetEnd) {
      break;
    }

    visibleTop = rowBottom + EDITOR_ROW_GAP_PX;
  }

  if (Number.isInteger(pinnedRowIndex) && pinnedRowIndex >= 0) {
    const safePinnedIndex = clampIndex(pinnedRowIndex, rowCount);
    startIndex = Math.min(startIndex, safePinnedIndex);
    endIndex = Math.max(endIndex, safePinnedIndex + 1);
  }

  const rowsBefore = startIndex;
  const rowsAfter = rowCount - endIndex;
  const topSpacerHeight =
    sumValues(rowHeights, 0, startIndex) + rowsBefore * EDITOR_ROW_GAP_PX;
  const bottomSpacerHeight =
    sumValues(rowHeights, endIndex, rowCount) + rowsAfter * EDITOR_ROW_GAP_PX;

  return {
    startIndex,
    endIndex,
    topSpacerHeight,
    bottomSpacerHeight,
  };
}
