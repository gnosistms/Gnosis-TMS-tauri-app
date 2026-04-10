export async function applyMetadataFirstResourceMutation(options) {
  const writeMetadata = options?.writeMetadata;
  const nextRecord = options?.nextRecord ?? null;
  const rollbackRecord = options?.rollbackRecord ?? null;
  const applyLocalMutation = options?.applyLocalMutation;
  const resourceLabel =
    typeof options?.resourceLabel === "string" && options.resourceLabel.trim()
      ? options.resourceLabel.trim()
      : "resource";

  if (typeof writeMetadata !== "function" || typeof applyLocalMutation !== "function") {
    throw new Error("The shared lifecycle engine is missing required mutation callbacks.");
  }

  await writeMetadata(nextRecord);
  try {
    await applyLocalMutation();
  } catch (error) {
    try {
      await writeMetadata(rollbackRecord);
    } catch (rollbackError) {
      throw new Error(
        `${error?.message ?? String(error)} The ${resourceLabel} metadata intent was committed locally first, and the automatic metadata rollback also failed: ${
          rollbackError?.message ?? String(rollbackError)
        }`,
      );
    }
    throw error;
  }
}

export async function commitMetadataFirstTopLevelMutation(options) {
  const mutation = options?.mutation;
  const resource = options?.resource;
  const writeMetadata = options?.writeMetadata;
  const buildRecord = options?.buildRecord;
  const applyLocalMutation = options?.applyLocalMutation;
  const resourceLabel =
    typeof options?.resourceLabel === "string" && options.resourceLabel.trim()
      ? options.resourceLabel.trim()
      : "resource";

  if (!mutation || !resource || typeof buildRecord !== "function" || typeof applyLocalMutation !== "function") {
    return false;
  }

  if (mutation.type === "rename") {
    await applyMetadataFirstResourceMutation({
      resourceLabel,
      writeMetadata,
      nextRecord: buildRecord(resource, {
        title: mutation.title,
      }),
      applyLocalMutation: () => applyLocalMutation(resource, mutation),
      rollbackRecord: buildRecord(resource, {
        title: mutation.previousTitle,
      }),
    });
    return true;
  }

  if (mutation.type === "softDelete") {
    await applyMetadataFirstResourceMutation({
      resourceLabel,
      writeMetadata,
      nextRecord: buildRecord(resource, {
        lifecycleState: resourceLabel === "project" ? "softDeleted" : "deleted",
      }),
      applyLocalMutation: () => applyLocalMutation(resource, mutation),
      rollbackRecord: buildRecord(resource, {
        lifecycleState: "active",
      }),
    });
    return true;
  }

  if (mutation.type === "restore") {
    await applyMetadataFirstResourceMutation({
      resourceLabel,
      writeMetadata,
      nextRecord: buildRecord(resource, {
        lifecycleState: "active",
      }),
      applyLocalMutation: () => applyLocalMutation(resource, mutation),
      rollbackRecord: buildRecord(resource, {
        lifecycleState: resourceLabel === "project" ? "softDeleted" : "deleted",
      }),
    });
    return true;
  }

  return false;
}

export async function guardTopLevelResourceAction(options) {
  const resource = options?.resource ?? null;
  const isExpectedResource =
    typeof options?.isExpectedResource === "function"
      ? options.isExpectedResource
      : (currentResource) => Boolean(currentResource);
  const getBlockedMessage =
    typeof options?.getBlockedMessage === "function"
      ? options.getBlockedMessage
      : () => "";
  const ensureNotTombstoned =
    typeof options?.ensureNotTombstoned === "function"
      ? options.ensureNotTombstoned
      : async () => false;

  if (!isExpectedResource(resource)) {
    await options?.onMissing?.();
    return false;
  }

  const blockedMessage = getBlockedMessage(resource);
  if (blockedMessage) {
    await options?.onBlocked?.(blockedMessage);
    return false;
  }

  if (await ensureNotTombstoned(resource)) {
    await options?.onTombstoned?.();
    return false;
  }

  return true;
}

export async function guardPermanentDeleteConfirmation(options) {
  const modalState = options?.modalState ?? null;
  const missingMessage =
    typeof options?.missingMessage === "string" ? options.missingMessage : "Could not find the selected resource.";
  const getBlockedMessage =
    typeof options?.getBlockedMessage === "function"
      ? options.getBlockedMessage
      : () => "";
  const confirmationMessage =
    typeof options?.confirmationMessage === "string"
      ? options.confirmationMessage
      : "Confirmation text does not match.";
  const matchesConfirmation =
    typeof options?.matchesConfirmation === "function"
      ? options.matchesConfirmation
      : () => true;
  const ensureNotTombstoned =
    typeof options?.ensureNotTombstoned === "function"
      ? options.ensureNotTombstoned
      : async () => false;
  const extraGuard =
    typeof options?.extraGuard === "function"
      ? options.extraGuard
      : async () => true;
  const render = options?.render;

  if (!options?.resource) {
    if (modalState) {
      modalState.status = "idle";
      modalState.error = missingMessage;
    }
    render?.();
    return false;
  }

  const blockedMessage = getBlockedMessage(options.resource);
  if (blockedMessage) {
    if (modalState) {
      modalState.status = "idle";
      modalState.error = blockedMessage;
    }
    render?.();
    return false;
  }

  if (!matchesConfirmation()) {
    if (modalState) {
      modalState.error = confirmationMessage;
    }
    render?.();
    return false;
  }

  if (await ensureNotTombstoned(options.resource)) {
    await options?.onTombstoned?.();
    return false;
  }

  const extraGuardResult = await extraGuard();
  if (extraGuardResult === false) {
    render?.();
    return false;
  }

  return true;
}

export async function ensureResourceNotTombstoned(options) {
  const installationId = options?.installationId;
  const resource = options?.resource;
  const resourceId =
    typeof options?.resourceId === "string" && options.resourceId.trim()
      ? options.resourceId.trim()
      : "";
  const render = options?.render;
  const showNotice = options?.showNotice !== false;
  const lookupMetadataTombstone = options?.lookupMetadataTombstone;
  const listMetadataRecords = options?.listMetadataRecords;
  const isTombstoneRecord = options?.isTombstoneRecord;
  const matchesMetadataRecord = options?.matchesMetadataRecord;
  const purgeLocalRepo = options?.purgeLocalRepo;
  const removeVisibleResource = options?.removeVisibleResource;
  const persistVisibleState = options?.persistVisibleState;
  const resourceLabel =
    typeof options?.resourceLabel === "string" && options.resourceLabel.trim()
      ? options.resourceLabel.trim()
      : "resource";

  if (!Number.isFinite(installationId) || !resource || !resourceId) {
    return false;
  }

  let tombstoned = false;
  try {
    tombstoned = await lookupMetadataTombstone?.(resourceId);
  } catch {
    let metadataRecords = [];
    try {
      metadataRecords = await listMetadataRecords?.();
    } catch {
      return false;
    }
    tombstoned = (Array.isArray(metadataRecords) ? metadataRecords : []).some((record) =>
      isTombstoneRecord?.(record) && matchesMetadataRecord?.(resource, record)
    );
  }

  if (!tombstoned) {
    return false;
  }

  try {
    await purgeLocalRepo?.();
  } catch (error) {
    removeVisibleResource?.();
    persistVisibleState?.();
    render?.();
    showNoticeBadge(
      `This ${resourceLabel} was already permanently deleted, but local cleanup still needs attention: ${
        error?.message ?? String(error)
      }`,
      render,
      4200,
    );
    return true;
  }

  removeVisibleResource?.();
  persistVisibleState?.();
  render?.();
  if (showNotice) {
    showNoticeBadge(
      `This ${resourceLabel} was already permanently deleted. The local repo was removed and the operation was stopped.`,
      render,
      4200,
    );
  }
  return true;
}
