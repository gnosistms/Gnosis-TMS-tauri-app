import { showNoticeBadge } from "./status-feedback.js";

export async function resumePendingResourceSetup(options) {
  const render = options?.render;
  const resourceId =
    typeof options?.resourceId === "string" && options.resourceId.trim()
      ? options.resourceId.trim()
      : "";
  const getResource =
    typeof options?.getResource === "function"
      ? options.getResource
      : () => null;
  const ensureResumeAllowed =
    typeof options?.ensureResumeAllowed === "function"
      ? options.ensureResumeAllowed
      : () => true;
  const isPendingCreate =
    typeof options?.isPendingCreate === "function"
      ? options.isPendingCreate
      : () => false;
  const isInFlight =
    typeof options?.isInFlight === "function"
      ? options.isInFlight
      : () => false;
  const markInFlight = options?.markInFlight;
  const clearInFlight = options?.clearInFlight;
  const listRemoteResources =
    typeof options?.listRemoteResources === "function"
      ? options.listRemoteResources
      : async () => [];
  const findMatchingRemoteResource =
    typeof options?.findMatchingRemoteResource === "function"
      ? options.findMatchingRemoteResource
      : () => null;
  const syncInBackground = options?.syncInBackground;
  const finalizePendingSetup = options?.finalizePendingSetup;
  const getResourceLabel =
    typeof options?.resourceLabel === "string" && options.resourceLabel.trim()
      ? options.resourceLabel.trim()
      : "resource";
  const showStartNotice = options?.showStartNotice !== false;
  const showSuccessNotice = options?.showSuccessNotice !== false;
  const showErrorNotice = options?.showErrorNotice !== false;

  const resource = getResource(resourceId);
  if (!resource) {
    showNoticeBadge(`Could not find the selected ${getResourceLabel}.`, render);
    return;
  }

  if (!ensureResumeAllowed(resource)) {
    return;
  }

  if (!isPendingCreate(resource)) {
    showNoticeBadge(`This ${getResourceLabel} is no longer waiting for setup recovery.`, render);
    return;
  }

  if (isInFlight(resource)) {
    showNoticeBadge(`This ${getResourceLabel} setup is already running.`, render, 2200);
    return;
  }

  markInFlight?.(resource);
  let handedOffToBackgroundCreate = false;

  try {
    const remoteResources = await listRemoteResources(resource);
    const matchedRemoteResource = findMatchingRemoteResource(resource, remoteResources);

    if (!matchedRemoteResource) {
      handedOffToBackgroundCreate = true;
      await syncInBackground?.(resource);
      if (showStartNotice) {
        showNoticeBadge(`Resuming GitHub setup for this ${getResourceLabel}...`, render, 2200);
      }
      return;
    }

    await finalizePendingSetup?.(resource, matchedRemoteResource);
    if (showSuccessNotice) {
      showNoticeBadge(`Finished recovering this pending ${getResourceLabel} setup.`, render, 2200);
    }
  } catch (error) {
    if (showErrorNotice) {
      showNoticeBadge(
        `Could not resume this ${getResourceLabel} setup: ${error?.message ?? String(error)}`,
        render,
        3200,
      );
    }
    render?.();
  } finally {
    if (!handedOffToBackgroundCreate) {
      clearInFlight?.(resource);
      render?.();
    }
  }
}

export async function autoResumePendingResources(options) {
  const resources = Array.isArray(options?.resources) ? options.resources : [];
  const getResourceId =
    typeof options?.getResourceId === "function"
      ? options.getResourceId
      : (resource) => resource?.id ?? "";
  const isPendingCreate =
    typeof options?.isPendingCreate === "function"
      ? options.isPendingCreate
      : () => false;
  const isInFlight =
    typeof options?.isInFlight === "function"
      ? options.isInFlight
      : () => false;
  const resumePendingSetup =
    typeof options?.resumePendingSetup === "function"
      ? options.resumePendingSetup
      : async () => {};

  for (const resource of resources) {
    const resourceId = getResourceId(resource);
    if (!resourceId || !isPendingCreate(resource) || isInFlight(resource)) {
      continue;
    }

    await resumePendingSetup(resourceId, {
      showStartNotice: false,
      showSuccessNotice: false,
      showErrorNotice: true,
    });
  }
}
