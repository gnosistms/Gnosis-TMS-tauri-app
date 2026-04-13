function cloneExpandedDeletedRowGroupIds(expandedDeletedRowGroupIds) {
  return expandedDeletedRowGroupIds instanceof Set
    ? new Set(expandedDeletedRowGroupIds)
    : new Set();
}

export function deletedRowGroupIdFromRange(rows, startIndex, endIndex) {
  if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || startIndex > endIndex) {
    return null;
  }

  const groupRowIds = (Array.isArray(rows) ? rows : [])
    .slice(startIndex, endIndex + 1)
    .map((row) => row?.rowId)
    .filter(Boolean);
  return groupRowIds.length > 0 ? groupRowIds.join(":") : null;
}

export function deletedRowGroupIdAfterSoftDelete(rows, rowId) {
  const items = Array.isArray(rows) ? rows : [];
  const rowIndex = items.findIndex((row) => row?.rowId === rowId);
  if (rowIndex < 0) {
    return null;
  }

  let startIndex = rowIndex;
  let endIndex = rowIndex;
  while (startIndex > 0 && items[startIndex - 1]?.lifecycleState === "deleted") {
    startIndex -= 1;
  }
  while (endIndex + 1 < items.length && items[endIndex + 1]?.lifecycleState === "deleted") {
    endIndex += 1;
  }

  const groupRowIds = items
    .slice(startIndex, endIndex + 1)
    .map((row) => row?.rowId)
    .filter(Boolean);
  if (!groupRowIds.includes(rowId)) {
    groupRowIds.splice(rowIndex - startIndex, 0, rowId);
  }
  return groupRowIds.length > 0 ? groupRowIds.join(":") : null;
}

function deletedRowGroupBoundsForRow(rows, rowId) {
  const items = Array.isArray(rows) ? rows : [];
  const rowIndex = items.findIndex((row) => row?.rowId === rowId);
  if (rowIndex < 0 || items[rowIndex]?.lifecycleState !== "deleted") {
    return null;
  }

  let startIndex = rowIndex;
  let endIndex = rowIndex;
  while (startIndex > 0 && items[startIndex - 1]?.lifecycleState === "deleted") {
    startIndex -= 1;
  }
  while (endIndex + 1 < items.length && items[endIndex + 1]?.lifecycleState === "deleted") {
    endIndex += 1;
  }

  return {
    rowIndex,
    startIndex,
    endIndex,
  };
}

function existingDeletedRowGroupIds(rows) {
  const items = Array.isArray(rows) ? rows : [];
  const groupIds = new Set();
  let index = 0;
  while (index < items.length) {
    if (items[index]?.lifecycleState !== "deleted") {
      index += 1;
      continue;
    }

    const startIndex = index;
    while (index + 1 < items.length && items[index + 1]?.lifecycleState === "deleted") {
      index += 1;
    }
    const groupId = deletedRowGroupIdFromRange(items, startIndex, index);
    if (groupId) {
      groupIds.add(groupId);
    }
    index += 1;
  }

  return groupIds;
}

export function compactExpandedDeletedRowGroupIds(rows, expandedDeletedRowGroupIds) {
  const validGroupIds = existingDeletedRowGroupIds(rows);
  return new Set(
    [...cloneExpandedDeletedRowGroupIds(expandedDeletedRowGroupIds)].filter((groupId) =>
      validGroupIds.has(groupId)
    ),
  );
}

function deletedRowGroupIdsAdjacentToSoftDelete(rows, rowId) {
  const items = Array.isArray(rows) ? rows : [];
  const rowIndex = items.findIndex((row) => row?.rowId === rowId);
  if (rowIndex < 0) {
    return [];
  }

  const groupIds = [];

  if (rowIndex > 0 && items[rowIndex - 1]?.lifecycleState === "deleted") {
    let startIndex = rowIndex - 1;
    while (startIndex > 0 && items[startIndex - 1]?.lifecycleState === "deleted") {
      startIndex -= 1;
    }
    const leftGroupId = items
      .slice(startIndex, rowIndex)
      .map((row) => row?.rowId)
      .filter(Boolean)
      .join(":");
    if (leftGroupId) {
      groupIds.push(leftGroupId);
    }
  }

  if (rowIndex + 1 < items.length && items[rowIndex + 1]?.lifecycleState === "deleted") {
    let endIndex = rowIndex + 1;
    while (endIndex + 1 < items.length && items[endIndex + 1]?.lifecycleState === "deleted") {
      endIndex += 1;
    }
    const rightGroupId = items
      .slice(rowIndex + 1, endIndex + 1)
      .map((row) => row?.rowId)
      .filter(Boolean)
      .join(":");
    if (rightGroupId) {
      groupIds.push(rightGroupId);
    }
  }

  return [...new Set(groupIds)];
}

export function expandedDeletedRowGroupIdsAfterSoftDelete(
  previousRows,
  rowId,
  expandedDeletedRowGroupIds,
  nextRows,
) {
  const nextExpandedDeletedRowGroupIds = cloneExpandedDeletedRowGroupIds(expandedDeletedRowGroupIds);
  const adjacentGroupIds = deletedRowGroupIdsAdjacentToSoftDelete(previousRows, rowId);
  const nextGroupId = deletedRowGroupIdAfterSoftDelete(previousRows, rowId);
  const shouldStayOpen = adjacentGroupIds.some((groupId) => nextExpandedDeletedRowGroupIds.has(groupId));

  for (const groupId of adjacentGroupIds) {
    nextExpandedDeletedRowGroupIds.delete(groupId);
  }

  if (nextGroupId && shouldStayOpen) {
    nextExpandedDeletedRowGroupIds.add(nextGroupId);
  }

  return compactExpandedDeletedRowGroupIds(nextRows, nextExpandedDeletedRowGroupIds);
}

export function expandedDeletedRowGroupIdsAfterRestore(
  previousRows,
  rowId,
  expandedDeletedRowGroupIds,
  nextRows,
) {
  const nextExpandedDeletedRowGroupIds = cloneExpandedDeletedRowGroupIds(expandedDeletedRowGroupIds);
  const bounds = deletedRowGroupBoundsForRow(previousRows, rowId);
  if (!bounds) {
    return compactExpandedDeletedRowGroupIds(nextRows, nextExpandedDeletedRowGroupIds);
  }

  const previousGroupId = deletedRowGroupIdFromRange(previousRows, bounds.startIndex, bounds.endIndex);
  const shouldStayOpen = previousGroupId ? nextExpandedDeletedRowGroupIds.has(previousGroupId) : false;

  if (previousGroupId) {
    nextExpandedDeletedRowGroupIds.delete(previousGroupId);
  }

  const leftGroupId =
    bounds.startIndex <= bounds.rowIndex - 1
      ? deletedRowGroupIdFromRange(nextRows, bounds.startIndex, bounds.rowIndex - 1)
      : null;
  const rightGroupId =
    bounds.rowIndex + 1 <= bounds.endIndex
      ? deletedRowGroupIdFromRange(nextRows, bounds.rowIndex + 1, bounds.endIndex)
      : null;

  if (shouldStayOpen && leftGroupId) {
    nextExpandedDeletedRowGroupIds.add(leftGroupId);
  }
  if (shouldStayOpen && rightGroupId) {
    nextExpandedDeletedRowGroupIds.add(rightGroupId);
  }

  return compactExpandedDeletedRowGroupIds(nextRows, nextExpandedDeletedRowGroupIds);
}

export function expandedDeletedRowGroupIdsAfterPermanentDelete(
  previousRows,
  rowId,
  expandedDeletedRowGroupIds,
  nextRows,
) {
  const nextExpandedDeletedRowGroupIds = cloneExpandedDeletedRowGroupIds(expandedDeletedRowGroupIds);
  const bounds = deletedRowGroupBoundsForRow(previousRows, rowId);
  if (!bounds) {
    return compactExpandedDeletedRowGroupIds(nextRows, nextExpandedDeletedRowGroupIds);
  }

  const previousGroupId = deletedRowGroupIdFromRange(previousRows, bounds.startIndex, bounds.endIndex);
  const shouldStayOpen = previousGroupId ? nextExpandedDeletedRowGroupIds.has(previousGroupId) : false;

  if (previousGroupId) {
    nextExpandedDeletedRowGroupIds.delete(previousGroupId);
  }

  const nextGroupId =
    bounds.startIndex <= bounds.endIndex - 1
      ? deletedRowGroupIdFromRange(nextRows, bounds.startIndex, bounds.endIndex - 1)
      : null;

  if (shouldStayOpen && nextGroupId) {
    nextExpandedDeletedRowGroupIds.add(nextGroupId);
  }

  return compactExpandedDeletedRowGroupIds(nextRows, nextExpandedDeletedRowGroupIds);
}
