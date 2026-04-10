export async function runLocalFirstCreate(options) {
  const reserveLocalRepo = options?.reserveLocalRepo;
  const commitPendingMetadata = options?.commitPendingMetadata;
  const initializeLocalResource = options?.initializeLocalResource;
  const purgeLocalRepo = options?.purgeLocalRepo;
  const rollbackPendingMetadata = options?.rollbackPendingMetadata;

  if (
    typeof reserveLocalRepo !== "function"
    || typeof commitPendingMetadata !== "function"
    || typeof initializeLocalResource !== "function"
  ) {
    throw new Error("The shared create flow is missing required callbacks.");
  }

  let localRepoName = "";
  let localNameCollisionResolved = false;
  let createdResource = null;
  let metadataIntentCommitted = false;

  try {
    const reservation = await reserveLocalRepo();
    localRepoName = reservation?.repoName ?? "";
    localNameCollisionResolved = reservation?.collisionResolved === true;

    await commitPendingMetadata(localRepoName);
    metadataIntentCommitted = true;
    createdResource = await initializeLocalResource(localRepoName);

    return {
      localRepoName,
      localNameCollisionResolved,
      createdResource,
    };
  } catch (error) {
    if (localRepoName && !createdResource) {
      try {
        await purgeLocalRepo?.(localRepoName);
      } catch {
        // Ignore local cleanup failures while surfacing the primary create error.
      }
    }

    if (metadataIntentCommitted && !createdResource) {
      try {
        await rollbackPendingMetadata?.(error);
      } catch (metadataRollbackError) {
        error = metadataRollbackError;
      }
    }

    throw error;
  }
}

export async function finalizeLocalFirstCreate(options) {
  const createdResource = options?.createdResource ?? null;
  const clearCreateState = options?.clearCreateState;
  const commitVisibleResource =
    typeof options?.commitVisibleResource === "function"
      ? options.commitVisibleResource
      : (resource) => resource;
  const selectResource = options?.selectResource;
  const openCreatedResource = options?.openCreatedResource;
  const syncInBackground = options?.syncInBackground;
  const showSuccessNotice = options?.showSuccessNotice;
  const showRefreshFailureNotice = options?.showRefreshFailureNotice;

  clearCreateState?.();
  const committedResource = commitVisibleResource(createdResource);
  selectResource?.(committedResource ?? createdResource);

  try {
    await openCreatedResource?.(committedResource ?? createdResource);
    await syncInBackground?.(committedResource ?? createdResource);
    showSuccessNotice?.(committedResource ?? createdResource);
  } catch (error) {
    showRefreshFailureNotice?.(error, committedResource ?? createdResource);
  }

  return committedResource ?? createdResource;
}
