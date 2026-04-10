import { showNoticeBadge } from "./status-feedback.js";

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
