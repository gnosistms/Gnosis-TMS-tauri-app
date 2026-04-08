export const EDITOR_ROW_GAP_PX = 24;
export const EDITOR_VIRTUALIZATION_MIN_ROWS = 25;
export const EDITOR_VIRTUALIZATION_OVERSCAN_PX = 900;
export const EDITOR_VIRTUALIZATION_INITIAL_VIEWPORT_PX = 900;

function clampIndex(index, count) {
  if (count <= 0) {
    return 0;
  }

  return Math.min(Math.max(index, 0), count - 1);
}

export function estimateEditorRowHeight(
  row,
  collapsedLanguageCodes = new Set(),
  fontSizePx = 22,
) {
  const sections = Array.isArray(row?.sections) ? row.sections : [];
  const expandedSections = sections.filter((section) => !collapsedLanguageCodes.has(section.code)).length;
  const collapsedSections = sections.length - expandedSections;
  const lineHeight = Math.max(fontSizePx * 1.5, 32);

  return Math.ceil(
    44
    + expandedSections * Math.max(118, lineHeight + 78)
    + collapsedSections * 34
    + Math.max(0, sections.length - 1) * 16,
  );
}

export function buildEditorRowHeights(
  rows,
  rowHeightById = new Map(),
  collapsedLanguageCodes = new Set(),
  fontSizePx = 22,
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
