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
