function historyAuthorLabel(entry) {
  if (String(entry?.operationType ?? "").trim().toLowerCase() === "import") {
    return "Import file";
  }

  return String(entry?.authorName ?? "").trim() || "Unknown author";
}

function isImportHistoryEntry(entry) {
  return String(entry?.operationType ?? "").trim().toLowerCase() === "import";
}

function buildMarkerStatusLabel(kind, enabled) {
  if (kind === "reviewed") {
    return enabled ? "Marked reviewed" : "Marked unreviewed";
  }

  if (kind === "pleaseCheck") {
    return enabled ? 'Marked "Please check"' : 'Removed "Please check"';
  }

  return "";
}

function buildMarkerRunStatusNote(initialEntry, finalEntry) {
  const parts = [];

  if ((initialEntry?.reviewed === true) !== (finalEntry?.reviewed === true)) {
    parts.push(buildMarkerStatusLabel("reviewed", finalEntry?.reviewed === true));
  }

  if ((initialEntry?.pleaseCheck === true) !== (finalEntry?.pleaseCheck === true)) {
    parts.push(buildMarkerStatusLabel("pleaseCheck", finalEntry?.pleaseCheck === true));
  }

  return parts.join(", ");
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
  const statusNote = buildMarkerRunStatusNote(initialEntry, finalEntry);
  if (!statusNote) {
    return null;
  }

  return {
    ...finalEntry,
    statusNote,
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
