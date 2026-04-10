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

  if (
    resolutionState === "pendingCreate"
    || remoteState === "pendingCreate"
    || resource.isPendingCreate === true
  ) {
    return {
      key: "pendingCreate",
      tone: "warning",
      message: `This ${resourceLabel} is still being set up.`,
      help: "The first GitHub write and local repo setup are still finishing in the background.",
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
    return {
      key: "repair",
      tone: "warning",
      message:
        normalizeText(resource.repairIssueMessage)
        || `This ${resourceLabel} needs repair before repo lifecycle management is trustworthy again.`,
      help: "The local-first copy stays visible, but this repo or metadata binding needs explicit repair.",
      blockLifecycleActions: true,
      blockContentActions: false,
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
