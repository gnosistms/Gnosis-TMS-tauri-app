function normalizeText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function syncIssueResolution(snapshot, resourceLabel) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  const status = normalizeText(snapshot.status);
  const message = normalizeText(snapshot.message);

  if (status === "dirtyLocal") {
    return {
      key: "syncError",
      tone: "error",
      message: message || `The local ${resourceLabel} repo has uncommitted changes.`,
      help: "Automatic sync is paused until the local repo is cleaned up.",
      blockLifecycleActions: false,
      blockContentActions: false,
    };
  }

  if (status === "unresolvedConflict") {
    return {
      key: "unresolvedConflict",
      tone: "error",
      message: `The local ${resourceLabel} repo is stuck in a git conflict state.`,
      help: "Automatic sync is paused until this conflict is resolved or overwritten from the server.",
      blockLifecycleActions: false,
      blockContentActions: false,
    };
  }

  if (status === "importedEditorConflicts") {
    return {
      key: "importedEditorConflicts",
      tone: "warning",
      message: `This ${resourceLabel} repo has imported editor conflicts that must be resolved before GitHub sync can continue.`,
      help: "The repo itself is clean again, but some rows still need conflict resolution in the editor.",
      blockLifecycleActions: false,
      blockContentActions: false,
    };
  }

  if (status === "updateRequired") {
    return {
      key: "updateRequired",
      tone: "error",
      message: message || `A newer version of Gnosis TMS is required before this ${resourceLabel} repo can sync again.`,
      help: "Update Gnosis TMS before continuing so an older app version does not overwrite newer-format data.",
      blockLifecycleActions: true,
      blockContentActions: true,
    };
  }

  if (status === "syncError" || status === "missingRemoteHead") {
    return {
      key: "syncError",
      tone: "error",
      message: message || `The local ${resourceLabel} repo needs attention before it can sync again.`,
      help: "You can keep the local copy visible, but GitHub sync is not healthy right now.",
      blockLifecycleActions: false,
      blockContentActions: false,
    };
  }

  return null;
}

function baseResolution(resource, resourceLabel) {
  if (!resource || typeof resource !== "object") {
    return null;
  }

  const resolutionState = normalizeText(resource.resolutionState);
  const remoteState = normalizeText(resource.remoteState);
  const recordState = normalizeText(resource.recordState);

  if (resolutionState === "deleted" || remoteState === "deleted" || recordState === "tombstone") {
    return {
      key: "deleted",
      tone: "warning",
      message: `This ${resourceLabel} was permanently deleted remotely.`,
      help: "Gnosis TMS will not recreate the remote repo from any stale local copy.",
      blockLifecycleActions: true,
      blockContentActions: true,
    };
  }

  if (resolutionState === "missing" || remoteState === "missing") {
    return {
      key: "missing",
      tone: "warning",
      message: `The GitHub repo for this ${resourceLabel} could not be found.`,
      help: "The local copy is still visible, but remote sync is paused until the repo is restored or relinked.",
      blockLifecycleActions: true,
      blockContentActions: false,
    };
  }

  if (resolutionState === "unregisteredLocal") {
    return {
      key: "unregisteredLocal",
      tone: "warning",
      message: `This local ${resourceLabel} is not registered in team metadata.`,
      help: "It stays visible on this machine, but other clients will not discover it until it is repaired.",
      blockLifecycleActions: true,
      blockContentActions: false,
    };
  }

  if (resolutionState === "repair") {
    const repairIssueType = normalizeText(resource.repairIssueType);
    const repairAction =
      typeof resource?.id === "string" && resource.id.trim()
        ? (
            repairIssueType === "missingLocalRepo"
              ? `${resourceLabel === "project" ? "rebuild-project-repo" : "rebuild-glossary-repo"}:${resource.id.trim()}`
              : `${resourceLabel === "project" ? "repair-project" : "repair-glossary"}:${resource.id.trim()}`
          )
        : "";
    return {
      key: "repair",
      tone: "warning",
      message:
        normalizeText(resource.repairIssueMessage)
        || `This ${resourceLabel} needs repair before repo lifecycle management is trustworthy again.`,
      help: "The local-first copy stays visible, but this repo or metadata binding needs explicit repair.",
      blockLifecycleActions: true,
      blockContentActions: false,
      actionLabel: repairIssueType === "missingLocalRepo" ? "Rebuild Local Repo" : "Repair",
      action: repairAction,
    };
  }

  return null;
}

export function deriveProjectResolution(project, syncSnapshot) {
  return (
    baseResolution(project, "project")
    ?? syncIssueResolution(syncSnapshot, "project")
  );
}

export function deriveGlossaryResolution(glossary, syncSnapshot) {
  return (
    baseResolution(glossary, "glossary")
    ?? syncIssueResolution(syncSnapshot, "glossary")
  );
}
