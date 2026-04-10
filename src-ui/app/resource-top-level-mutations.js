import { removePendingMutation, removeItem, replaceItem } from "./optimistic-collection.js";

function defaultMutationResourceId(mutation) {
  if (typeof mutation?.resourceId === "string" && mutation.resourceId.trim()) {
    return mutation.resourceId.trim();
  }
  if (typeof mutation?.projectId === "string" && mutation.projectId.trim()) {
    return mutation.projectId.trim();
  }
  if (typeof mutation?.glossaryId === "string" && mutation.glossaryId.trim()) {
    return mutation.glossaryId.trim();
  }
  if (typeof mutation?.teamId === "string" && mutation.teamId.trim()) {
    return mutation.teamId.trim();
  }
  return "";
}

export function applyTopLevelResourceMutation(snapshot, mutation, options = {}) {
  const normalizeSnapshot =
    typeof options.normalizeSnapshot === "function"
      ? options.normalizeSnapshot
      : (nextSnapshot) => nextSnapshot;
  const getMutationResourceId =
    typeof options.getMutationResourceId === "function"
      ? options.getMutationResourceId
      : defaultMutationResourceId;
  const markDeleted =
    typeof options.markDeleted === "function"
      ? options.markDeleted
      : (resource) => resource;
  const markActive =
    typeof options.markActive === "function"
      ? options.markActive
      : (resource) => resource;
  const renameResource =
    typeof options.renameResource === "function"
      ? options.renameResource
      : (resource) => resource;
  const normalizedSnapshot = normalizeSnapshot(snapshot);
  const resourceId = getMutationResourceId(mutation);
  const currentResource =
    normalizedSnapshot.items.find((item) => item?.id === resourceId)
    ?? normalizedSnapshot.deletedItems.find((item) => item?.id === resourceId);

  if (!resourceId || !currentResource) {
    return normalizedSnapshot;
  }

  if (mutation.type === "softDelete") {
    return normalizeSnapshot({
      items: removeItem(normalizedSnapshot.items, resourceId),
      deletedItems: [
        markDeleted(currentResource, mutation),
        ...removeItem(normalizedSnapshot.deletedItems, resourceId),
      ],
    });
  }

  if (mutation.type === "restore") {
    return normalizeSnapshot({
      items: replaceItem(removeItem(normalizedSnapshot.items, resourceId), markActive(currentResource, mutation)),
      deletedItems: removeItem(normalizedSnapshot.deletedItems, resourceId),
    });
  }

  if (mutation.type === "rename") {
    const renamedResource = renameResource(currentResource, mutation);
    const isDeleted = normalizedSnapshot.deletedItems.some((item) => item?.id === resourceId);
    return normalizeSnapshot(
      isDeleted
        ? {
            items: normalizedSnapshot.items,
            deletedItems: replaceItem(normalizedSnapshot.deletedItems, renamedResource),
          }
        : {
            items: replaceItem(normalizedSnapshot.items, renamedResource),
            deletedItems: normalizedSnapshot.deletedItems,
          },
    );
  }

  if (mutation.type === "permanentDelete") {
    return normalizeSnapshot({
      items: removeItem(normalizedSnapshot.items, resourceId),
      deletedItems: removeItem(normalizedSnapshot.deletedItems, resourceId),
    });
  }

  return normalizedSnapshot;
}

export function buildTopLevelResourceRollbackMutation(mutation, options = {}) {
  const getMutationResourceId =
    typeof options.getMutationResourceId === "function"
      ? options.getMutationResourceId
      : defaultMutationResourceId;
  const resourceId = getMutationResourceId(mutation);
  if (!resourceId) {
    return null;
  }

  if (mutation.type === "rename") {
    return {
      id: `${mutation.id}-rollback`,
      type: "rename",
      resourceId,
      title: mutation.previousTitle,
    };
  }

  if (mutation.type === "softDelete") {
    return {
      id: `${mutation.id}-rollback`,
      type: "restore",
      resourceId,
    };
  }

  if (mutation.type === "restore") {
    return {
      id: `${mutation.id}-rollback`,
      type: "softDelete",
      resourceId,
    };
  }

  return null;
}

export function rollbackTopLevelResourceMutation(snapshot, mutation, applyMutation, options = {}) {
  const inverseMutation = buildTopLevelResourceRollbackMutation(mutation, options);
  if (!inverseMutation) {
    return snapshot;
  }
  return applyMutation(snapshot, inverseMutation);
}

export async function processQueuedResourceMutations(options) {
  const pendingMutations = [
    ...(
      typeof options?.getPendingMutations === "function"
        ? options.getPendingMutations()
        : []
    ),
  ];
  const inflightMutationIds = options?.inflightMutationIds;
  const commitMutation = options?.commitMutation;
  const setPendingMutations = options?.setPendingMutations;
  const persistPendingMutations = options?.persistPendingMutations;
  const persistVisibleState = options?.persistVisibleState;
  const rollbackVisibleMutation = options?.rollbackVisibleMutation;
  const onMutationError = options?.onMutationError;
  const onMutationCommitted = options?.onMutationCommitted;
  const onQueueComplete = options?.onQueueComplete;
  const waitForPaint =
    typeof options?.waitForNextPaint === "function"
      ? options.waitForNextPaint
      : async () => {};

  if (!inflightMutationIds || typeof commitMutation !== "function" || typeof setPendingMutations !== "function") {
    return;
  }

  for (const mutation of pendingMutations) {
    if (inflightMutationIds.has(mutation.id)) {
      continue;
    }

    inflightMutationIds.add(mutation.id);
    try {
      await waitForPaint();
      await commitMutation(mutation);
      const nextPendingMutations = removePendingMutation(
        typeof options.getPendingMutations === "function" ? options.getPendingMutations() : [],
        mutation.id,
      );
      setPendingMutations(nextPendingMutations);
      persistPendingMutations?.(nextPendingMutations);
      persistVisibleState?.();
      await onMutationCommitted?.(mutation);
    } catch (error) {
      inflightMutationIds.delete(mutation.id);
      const nextPendingMutations = removePendingMutation(
        typeof options.getPendingMutations === "function" ? options.getPendingMutations() : [],
        mutation.id,
      );
      setPendingMutations(nextPendingMutations);
      persistPendingMutations?.(nextPendingMutations);
      rollbackVisibleMutation?.(mutation);
      persistVisibleState?.();
      const stopProcessing = await onMutationError?.(mutation, error);
      if (stopProcessing !== false) {
        return;
      }
      continue;
    }
    inflightMutationIds.delete(mutation.id);
  }

  await onQueueComplete?.();
}
