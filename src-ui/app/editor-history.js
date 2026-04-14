function historyAuthorLabel(entry) {
  if (String(entry?.operationType ?? "").trim().toLowerCase() === "import") {
    return "Import file";
  }

  return String(entry?.authorName ?? "").trim() || "Unknown author";
}

function isImportHistoryEntry(entry) {
  return String(entry?.operationType ?? "").trim().toLowerCase() === "import";
}

function buildMarkerRunActions(initialEntry, finalEntry) {
  const actions = [];
  if ((initialEntry?.reviewed === true) !== (finalEntry?.reviewed === true)) {
    actions.push({
      kind: "reviewed",
      enabled: finalEntry?.reviewed === true,
    });
  }

  if ((initialEntry?.pleaseCheck === true) !== (finalEntry?.pleaseCheck === true)) {
    actions.push({
      kind: "please-check",
      enabled: finalEntry?.pleaseCheck === true,
    });
  }

  return actions;
}

function isMarkerStateChangeOnly(previousEntry, currentEntry) {
  if (!previousEntry || !currentEntry) {
    return false;
  }

  if (isImportHistoryEntry(currentEntry)) {
    return false;
  }

  if (String(previousEntry?.plainText ?? "") !== String(currentEntry?.plainText ?? "")) {
    return false;
  }

  return (
    (previousEntry?.reviewed === true) !== (currentEntry?.reviewed === true)
    || (previousEntry?.pleaseCheck === true) !== (currentEntry?.pleaseCheck === true)
  );
}

function buildMarkerRunEntry(initialEntry, finalEntry) {
  const markerNoteActions = buildMarkerRunActions(initialEntry, finalEntry);
  if (markerNoteActions.length === 0) {
    return null;
  }

  return {
    ...finalEntry,
    statusNote: "",
    markerNoteActions,
  };
}

function compressHistoryEntries(entries) {
  const chronologicalEntries = [...entries].reverse();
  if (chronologicalEntries.length <= 1) {
    return [...entries];
  }

  const compressedChronologicalEntries = [chronologicalEntries[0]];
  let index = 1;

  while (index < chronologicalEntries.length) {
    const baselineEntry = chronologicalEntries[index - 1];
    const currentEntry = chronologicalEntries[index];

    if (!isMarkerStateChangeOnly(baselineEntry, currentEntry)) {
      compressedChronologicalEntries.push(currentEntry);
      index += 1;
      continue;
    }

    const runAuthor = historyAuthorLabel(currentEntry);
    let finalRunEntry = currentEntry;
    let previousRunEntry = currentEntry;
    let nextIndex = index + 1;

    while (nextIndex < chronologicalEntries.length) {
      const nextEntry = chronologicalEntries[nextIndex];
      if (historyAuthorLabel(nextEntry) !== runAuthor) {
        break;
      }
      if (!isMarkerStateChangeOnly(previousRunEntry, nextEntry)) {
        break;
      }

      finalRunEntry = nextEntry;
      previousRunEntry = nextEntry;
      nextIndex += 1;
    }

    const markerRunEntry = buildMarkerRunEntry(baselineEntry, finalRunEntry);
    if (markerRunEntry) {
      compressedChronologicalEntries.push(markerRunEntry);
    }

    index = nextIndex;
  }

  return compressedChronologicalEntries.reverse();
}

function buildHistoryGroups(entries) {
  const groups = [];

  for (const entry of entries) {
    const authorName = historyAuthorLabel(entry);
    const operationType = String(entry?.operationType ?? "").trim().toLowerCase();
    const isImport = operationType === "import";
    const previousGroup = groups[groups.length - 1] ?? null;

    if (!isImport && previousGroup?.authorName === authorName && previousGroup?.isImport !== true) {
      previousGroup.entries.push(entry);
      previousGroup.key = previousGroup.entries[previousGroup.entries.length - 1]?.commitSha ?? previousGroup.key;
      continue;
    }

    groups.push({
      key: entry.commitSha,
      authorName,
      operationType,
      isImport,
      entries: [entry],
    });
  }

  return groups;
}

function buildGroupKeyByCommitSha(groups) {
  const groupKeyByCommitSha = new Map();

  for (const group of groups) {
    for (const entry of group.entries) {
      groupKeyByCommitSha.set(entry.commitSha, group.key);
    }
  }

  return groupKeyByCommitSha;
}

function buildVisibleHistoryEntries(groups, expandedGroupKeys) {
  return groups.flatMap((group) =>
    expandedGroupKeys.has(group.key) ? group.entries : [group.entries[0]],
  );
}

function buildOlderVisibleEntryByCommitSha(entries) {
  return new Map(
    entries.map((entry, index) => [
      entry.commitSha,
      index < entries.length - 1 ? entries[index + 1] : null,
    ]),
  );
}

export function historyEntryCanUndoReplace(entry) {
  return String(entry?.operationType ?? "").trim().toLowerCase() === "editor-replace";
}

export function editorHistoryEntryMatchesSection(entry, section) {
  if (!entry || !section) {
    return false;
  }

  return (
    String(entry.plainText ?? "") === String(section.text ?? "")
    && (entry.reviewed === true) === (section.reviewed === true)
    && (entry.pleaseCheck === true) === (section.pleaseCheck === true)
  );
}

export function findEditorHistoryPreviousEntry(entries, section) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  if (!section || normalizedEntries.length === 0) {
    return null;
  }

  const currentEntryIndex = normalizedEntries.findIndex((entry) => editorHistoryEntryMatchesSection(entry, section));
  if (currentEntryIndex >= 0) {
    return normalizedEntries[currentEntryIndex + 1] ?? null;
  }

  return normalizedEntries[0] ?? null;
}

export function buildEditorHistoryViewModel(entries, expandedGroupKeys) {
  const compressedEntries = compressHistoryEntries(Array.isArray(entries) ? entries : []);
  const groups = buildHistoryGroups(compressedEntries);
  const visibleEntries = buildVisibleHistoryEntries(groups, expandedGroupKeys);

  return {
    groups,
    visibleEntries,
    olderVisibleEntryByCommitSha: buildOlderVisibleEntryByCommitSha(visibleEntries),
  };
}

export function reconcileExpandedEditorHistoryGroupKeys(previousEntries, nextEntries, expandedGroupKeys) {
  const previousExpandedGroupKeys = expandedGroupKeys instanceof Set ? expandedGroupKeys : new Set();
  if (previousExpandedGroupKeys.size === 0) {
    return new Set();
  }

  const previousGroups = buildHistoryGroups(compressHistoryEntries(Array.isArray(previousEntries) ? previousEntries : []));
  const nextGroups = buildHistoryGroups(compressHistoryEntries(Array.isArray(nextEntries) ? nextEntries : []));
  const nextGroupKeyByCommitSha = buildGroupKeyByCommitSha(nextGroups);
  const reconciledKeys = new Set();

  for (const group of previousGroups) {
    if (!previousExpandedGroupKeys.has(group.key)) {
      continue;
    }

    const matchingNextKey = group.entries
      .map((entry) => nextGroupKeyByCommitSha.get(entry.commitSha))
      .find(Boolean);

    if (matchingNextKey) {
      reconciledKeys.add(matchingNextKey);
    }
  }

  return reconciledKeys;
}
