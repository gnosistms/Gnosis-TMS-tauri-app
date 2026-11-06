import { normalizeEditorRowTextStyle } from "./editor-row-text-style.js";
import { editorFieldImageEqual } from "./editor-images.js";
import { serializeEditorFootnotesForLegacy } from "./editor-footnotes.js";

export function formatAiHistoryModelLabel(modelId) {
  const normalizedModelId = String(modelId ?? "").trim();
  if (!normalizedModelId) {
    return "";
  }

  return normalizedModelId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => {
      if (/^\d+(?:\.\d+)*$/.test(part)) {
        return part;
      }

      switch (part.toLowerCase()) {
        case "gpt":
          return "GPT";
        case "gemini":
          return "Gemini";
        case "claude":
          return "Claude";
        case "deepseek":
          return "DeepSeek";
        default:
          return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
      }
    })
    .join(" ");
}

export function historyAuthorLabel(entry) {
  if (isOptimisticEditorHistoryEntry(entry)) {
    return "Pending local save";
  }

  if (String(entry?.operationType ?? "").trim().toLowerCase() === "import") {
    return "Import file";
  }

  const authorName = String(entry?.authorName ?? "").trim() || "Unknown author";
  const aiModelLabel = formatAiHistoryModelLabel(entry?.aiModel);
  return aiModelLabel ? `${aiModelLabel} - ${authorName}` : authorName;
}

export function historyLastUpdateLabel(entry) {
  if (String(entry?.operationType ?? "").trim().toLowerCase() === "import") {
    return "file import";
  }

  return historyAuthorLabel(entry);
}

export function historyLastUpdateHeadingLabel(entry) {
  if (!entry?.commitSha) {
    return "Last update";
  }

  if (isOptimisticEditorHistoryEntry(entry)) {
    return "Pending local save";
  }

  if (String(entry?.operationType ?? "").trim().toLowerCase() === "import") {
    return "Last update - file import";
  }

  const aiModelLabel = formatAiHistoryModelLabel(entry?.aiModel);
  if (aiModelLabel) {
    return `Last update - ${aiModelLabel}`;
  }

  const authorName = String(entry?.authorName ?? "").trim();
  return authorName ? `Last update - ${authorName}` : "Last update";
}

export function isOptimisticEditorHistoryEntry(entry) {
  return entry?.optimistic === true || String(entry?.commitSha ?? "").startsWith("optimistic:");
}

function historyEntriesHaveSameUser(left, right) {
  // AI commits retain the controlling user's Git identity; aiModel only affects
  // the displayed credit. Prefer identity over the potentially shared name.
  for (const field of ["authorLogin", "authorEmail", "authorName"]) {
    const leftIdentity = String(left?.[field] ?? "").trim().toLowerCase();
    const rightIdentity = String(right?.[field] ?? "").trim().toLowerCase();
    if (leftIdentity && rightIdentity) {
      return leftIdentity === rightIdentity;
    }
  }
  return false;
}

function historyTextFieldsEqual(left, right) {
  return ["plainText", "footnote", "imageCaption", "attribution"].every(
    (field) => String(left?.[field] ?? "") === String(right?.[field] ?? ""),
  );
}

function buildHistoryGroups(entries) {
  const groups = [];

  for (const entry of entries) {
    const authorName = historyAuthorLabel(entry);
    const operationType = String(entry?.operationType ?? "").trim().toLowerCase();
    const isImport = operationType === "import";
    const previousGroup = groups[groups.length - 1] ?? null;

    const adjacentEntry = previousGroup?.entries.at(-1);
    if (
      adjacentEntry
      && !isOptimisticEditorHistoryEntry(entry)
      && !isOptimisticEditorHistoryEntry(adjacentEntry)
      && historyEntriesHaveSameUser(adjacentEntry, entry)
      && historyTextFieldsEqual(adjacentEntry, entry)
    ) {
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
  return !isOptimisticEditorHistoryEntry(entry)
    && String(entry?.operationType ?? "").trim().toLowerCase() === "editor-replace";
}

export function editorHistoryEntryMatchesSection(entry, section) {
  if (!entry || !section) {
    return false;
  }

  return (
    String(entry.plainText ?? "") === String(section.text ?? "")
    // Entry footnotes use the persisted labeled serialization; the section's
    // plain text drops the [N] labels, so serialize before comparing.
    && String(entry.footnote ?? "")
      === serializeEditorFootnotesForLegacy(section.footnotes ?? section.footnote ?? "")
    && String(entry.imageCaption ?? "") === String(section.imageCaption ?? "")
    && String(entry.attribution ?? "") === String(section.attribution ?? "")
    && editorFieldImageEqual(entry.image, section.image)
    && (entry.reviewed === true) === (section.reviewed === true)
    && (entry.pleaseCheck === true) === (section.pleaseCheck === true)
    && normalizeEditorRowTextStyle(entry.textStyle) === normalizeEditorRowTextStyle(section.textStyle)
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

export function findEditorHistoryPreviousCommitEntry(entries) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  return normalizedEntries[1] ?? null;
}

export function findEditorHistoryPreviousVisibleEntry(entries, section) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  if (!section || normalizedEntries.length === 0) {
    return null;
  }

  const historyView = buildEditorHistoryViewModel(normalizedEntries, new Set());
  const matchingVisibleEntry =
    historyView.visibleEntries.find((entry) => editorHistoryEntryMatchesSection(entry, section)) ?? null;
  if (matchingVisibleEntry) {
    return historyView.olderVisibleEntryByCommitSha.get(matchingVisibleEntry.commitSha) ?? null;
  }

  return findEditorHistoryPreviousEntry(normalizedEntries, section);
}

export function buildEditorHistoryViewModel(entries, expandedGroupKeys) {
  const groups = buildHistoryGroups(Array.isArray(entries) ? entries : []);
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

  const previousGroups = buildHistoryGroups(Array.isArray(previousEntries) ? previousEntries : []);
  const nextGroups = buildHistoryGroups(Array.isArray(nextEntries) ? nextEntries : []);
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
