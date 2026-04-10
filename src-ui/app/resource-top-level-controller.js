import { openEntityRenameModal } from "./resource-entity-modal.js";
import { guardTopLevelResourceAction } from "./resource-lifecycle-engine.js";

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
