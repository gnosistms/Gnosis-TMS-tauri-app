import { openEntityRenameModal } from "./resource-entity-modal.js";
import { guardTopLevelResourceAction } from "./resource-lifecycle-engine.js";
import {
  queueTopLevelResourceMutation,
  submitTopLevelResourceMutation,
} from "./resource-top-level-mutations.js";

function queueManagedTopLevelMutation(options) {
  const store = options?.store ?? null;
  queueTopLevelResourceMutation({
    mutation: options?.mutation,
    currentSnapshot: store?.currentSnapshot,
    applyMutation: store?.applyMutation,
    applySnapshot: store?.applySnapshot,
    beginSync: store?.beginSync,
    beforePersist: store?.beforePersist,
    getPendingMutations: store?.getPendingMutations,
    setPendingMutations: store?.setPendingMutations,
    persistPendingMutations: store?.persistPendingMutations,
    persistVisibleState: store?.persistVisibleState,
    render: options?.render,
  });
}

export function openTopLevelRenameModal(options) {
  void guardTopLevelResourceAction({
    resource: options?.resource,
    isExpectedResource: options?.isExpectedResource,
    getBlockedMessage: options?.getBlockedMessage,
    ensureNotTombstoned: options?.ensureNotTombstoned,
    onMissing: options?.onMissing,
    onBlocked: options?.onBlocked,
    onTombstoned: options?.onTombstoned,
  }).then((allowed) => {
    if (!allowed) {
      return;
    }

    openEntityRenameModal({
      setState: options?.setModalState,
      entityId: options?.resource?.id ?? "",
      idField: options?.idField ?? "resourceId",
      nameField: options?.nameField ?? "resourceName",
      currentName: options?.currentName ?? "",
    });
    options?.render?.();
  });
}

export async function submitTopLevelRename(options) {
  const resource = options?.resource ?? null;
  const modalState = options?.modalState ?? null;
  const render = options?.render;
  const nextTitle = String(
    modalState?.[options?.nameField ?? "resourceName"] ?? "",
  ).trim();

  const allowed = await guardTopLevelResourceAction({
    resource,
    isExpectedResource: options?.isExpectedResource,
    getBlockedMessage: options?.getBlockedMessage,
    ensureNotTombstoned: options?.ensureNotTombstoned,
    onMissing: () => {
      if (modalState) {
        modalState.error = options?.missingMessage ?? "Could not find the selected resource.";
      }
      options?.onMissing?.();
      render?.();
    },
    onBlocked: (blockedMessage) => {
      if (modalState) {
        modalState.error = blockedMessage;
      }
      options?.onBlocked?.(blockedMessage);
      render?.();
    },
    onTombstoned: async () => {
      await options?.onTombstoned?.();
      render?.();
    },
  });
  if (!allowed) {
    return null;
  }

  if (!nextTitle) {
    if (modalState) {
      modalState.error = options?.emptyTitleMessage ?? "Enter a name.";
    }
    render?.();
    return null;
  }

  options?.beforeSubmit?.(resource, nextTitle);
  return submitTopLevelResourceMutation({
    setLoading: () => {
      if (modalState) {
        modalState.status = "loading";
        modalState.error = "";
      }
      options?.setLoading?.();
      render?.();
    },
    buildMutation: () => ({
      id: crypto.randomUUID(),
      type: "rename",
      resourceId: resource.id,
      previousTitle: options?.previousTitle?.(resource) ?? resource.title ?? "",
      title: nextTitle,
      ...(options?.buildMutationFields?.(resource) ?? {}),
    }),
    queueMutation: (mutation) =>
      queueManagedTopLevelMutation({
        mutation,
        store: options?.store,
        render,
      }),
    afterQueue: (mutation) => {
      options?.afterQueue?.(mutation, resource, nextTitle);
    },
    processQueue: () => options?.processQueue?.(),
    waitForProcessing: options?.waitForProcessing,
    onError: options?.onError,
  });
}

export async function submitSimpleTopLevelMutation(options) {
  const resource = options?.resource ?? null;

  const allowed = await guardTopLevelResourceAction({
    resource,
    isExpectedResource: options?.isExpectedResource,
    getBlockedMessage: options?.getBlockedMessage,
    ensureNotTombstoned: options?.ensureNotTombstoned,
    onMissing: options?.onMissing,
    onBlocked: options?.onBlocked,
    onTombstoned: options?.onTombstoned,
  });
  if (!allowed) {
    return null;
  }

  options?.beforeSubmit?.(resource);
  return submitTopLevelResourceMutation({
    setLoading: options?.setLoading,
    buildMutation: () => ({
      id: crypto.randomUUID(),
      type: options?.type,
      resourceId: resource.id,
      ...(options?.buildMutationFields?.(resource) ?? {}),
    }),
    queueMutation: (mutation) =>
      queueManagedTopLevelMutation({
        mutation,
        store: options?.store,
        render: options?.render,
      }),
    afterQueue: (mutation) => {
      options?.afterQueue?.(mutation, resource);
    },
    processQueue: () => options?.processQueue?.(),
    waitForProcessing: options?.waitForProcessing,
    onError: options?.onError,
  });
}
