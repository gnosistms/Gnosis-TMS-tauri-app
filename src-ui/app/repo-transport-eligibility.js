function normalizedText(value) {
  return String(value ?? "").trim();
}

function normalizedLower(value) {
  return normalizedText(value).toLowerCase();
}

function normalizedNumber(value) {
  return Number.isFinite(value) ? String(value) : "";
}

export function isDeletedRepoResource(resource) {
  if (!resource || typeof resource !== "object") {
    return false;
  }

  const lifecycleState = normalizedLower(resource.lifecycleState);
  const recordState = normalizedLower(resource.recordState);
  const remoteState = normalizedLower(resource.remoteState);
  const status = normalizedLower(resource.status);

  return (
    lifecycleState === "deleted"
    || lifecycleState === "softdeleted"
    || recordState === "tombstone"
    || remoteState === "deleted"
    || remoteState === "missing"
    || status === "deleted"
  );
}

export function repoTransportLifecycleFields(resource) {
  return {
    lifecycleState: normalizedText(resource?.lifecycleState) || null,
    recordState: normalizedText(resource?.recordState) || null,
    remoteState: normalizedText(resource?.remoteState) || null,
    status: normalizedText(resource?.status) || null,
  };
}

function identityValues(resource) {
  if (!resource || typeof resource !== "object") {
    return {
      ids: new Set(),
      repoNames: new Set(),
      fullNames: new Set(),
      repoIds: new Set(),
      nodeIds: new Set(),
    };
  }

  return {
    ids: new Set([
      resource.id,
      resource.projectId,
      resource.glossaryId,
      resource.qaListId,
      resource.resourceId,
    ].map(normalizedLower).filter(Boolean)),
    repoNames: new Set([
      resource.repoName,
      resource.name,
    ].map(normalizedLower).filter(Boolean)),
    fullNames: new Set([
      resource.fullName,
    ].map(normalizedLower).filter(Boolean)),
    repoIds: new Set([
      normalizedNumber(resource.repoId),
      normalizedNumber(resource.githubRepoId),
    ].filter(Boolean)),
    nodeIds: new Set([
      resource.nodeId,
      resource.githubNodeId,
    ].map(normalizedLower).filter(Boolean)),
  };
}

function intersects(leftSet, rightSet) {
  for (const value of leftSet) {
    if (rightSet.has(value)) {
      return true;
    }
  }
  return false;
}

export function repoResourcesMatch(left, right) {
  const leftIds = identityValues(left);
  const rightIds = identityValues(right);
  return (
    intersects(leftIds.ids, rightIds.ids)
    || intersects(leftIds.repoIds, rightIds.repoIds)
    || intersects(leftIds.nodeIds, rightIds.nodeIds)
    || intersects(leftIds.fullNames, rightIds.fullNames)
    || intersects(leftIds.repoNames, rightIds.repoNames)
  );
}

export function isKnownDeletedRepoResource(resource, knownResources = []) {
  return (Array.isArray(knownResources) ? knownResources : []).some((knownResource) =>
    isDeletedRepoResource(knownResource) && repoResourcesMatch(resource, knownResource)
  );
}

export function filterKnownDeletedRepoResources(resources = [], knownResources = []) {
  const deletedResources = (Array.isArray(knownResources) ? knownResources : [])
    .filter(isDeletedRepoResource);
  if (deletedResources.length === 0) {
    return Array.isArray(resources) ? resources : [];
  }

  return (Array.isArray(resources) ? resources : []).filter((resource) =>
    !deletedResources.some((deletedResource) => repoResourcesMatch(resource, deletedResource))
  );
}

export function repoResourceIsTransportEligible(resource, knownResources = []) {
  return !isDeletedRepoResource(resource) && !isKnownDeletedRepoResource(resource, knownResources);
}
