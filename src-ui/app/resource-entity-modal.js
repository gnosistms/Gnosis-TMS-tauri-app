export function openEntityRenameModal(options) {
  const setState = options?.setState;
  const entityId = options?.entityId ?? null;
  const nameField = options?.nameField;
  const currentName =
    typeof options?.currentName === "string" ? options.currentName : "";
  const idField = options?.idField;

  if (typeof setState !== "function" || typeof idField !== "string" || !idField.trim() || typeof nameField !== "string" || !nameField.trim()) {
    return false;
  }

  setState({
    isOpen: true,
    status: "idle",
    error: "",
    [idField]: entityId,
    [nameField]: currentName,
  });
  return true;
}

export function openEntityFormModal(options) {
  const setState = options?.setState;
  const fields =
    options?.fields && typeof options.fields === "object"
      ? options.fields
      : {};

  if (typeof setState !== "function") {
    return false;
  }

  setState({
    isOpen: true,
    status: "idle",
    error: "",
    ...fields,
  });
  return true;
}

export function openEntityConfirmationModal(options) {
  const setState = options?.setState;
  const entityId = options?.entityId ?? null;
  const idField = options?.idField;
  const nameField = options?.nameField;
  const confirmationField = options?.confirmationField;
  const currentName =
    typeof options?.currentName === "string" ? options.currentName : "";

  if (
    typeof setState !== "function"
    || typeof idField !== "string"
    || !idField.trim()
    || typeof nameField !== "string"
    || !nameField.trim()
    || typeof confirmationField !== "string"
    || !confirmationField.trim()
  ) {
    return false;
  }

  setState({
    isOpen: true,
    status: "idle",
    error: "",
    [idField]: entityId,
    [nameField]: currentName,
    [confirmationField]: "",
  });
  return true;
}

export function reopenEntityConfirmationModalWithError(options) {
  const setState = options?.setState;
  const entityId = options?.entityId ?? null;
  const idField = options?.idField;
  const nameField = options?.nameField;
  const confirmationField = options?.confirmationField;
  const currentName =
    typeof options?.currentName === "string" ? options.currentName : "";
  const confirmationText =
    typeof options?.confirmationText === "string" ? options.confirmationText : "";
  const error =
    typeof options?.error === "string" ? options.error : "";

  if (
    typeof setState !== "function"
    || typeof idField !== "string"
    || !idField.trim()
    || typeof nameField !== "string"
    || !nameField.trim()
    || typeof confirmationField !== "string"
    || !confirmationField.trim()
  ) {
    return false;
  }

  setState({
    isOpen: true,
    status: "idle",
    error,
    [idField]: entityId,
    [nameField]: currentName,
    [confirmationField]: confirmationText,
  });
  return true;
}

export function updateEntityModalName(modalState, nameField, value) {
  if (!modalState || typeof nameField !== "string" || !nameField.trim()) {
    return;
  }

  modalState[nameField] = value;
  if (modalState.error) {
    modalState.error = "";
  }
}

export function updateEntityModalConfirmation(modalState, confirmationField, value) {
  updateEntityModalName(modalState, confirmationField, value);
}

export function updateEntityFormField(modalState, field, value) {
  updateEntityModalName(modalState, field, value);
}

export function entityConfirmationMatches(modalState, options) {
  const nameField = options?.nameField;
  const confirmationField = options?.confirmationField;
  if (
    !modalState
    || typeof nameField !== "string"
    || !nameField.trim()
    || typeof confirmationField !== "string"
    || !confirmationField.trim()
  ) {
    return false;
  }

  return normalizedConfirmationValue(modalState[confirmationField]) === normalizedConfirmationValue(modalState[nameField]);
}

export function normalizedConfirmationValue(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.normalize("NFC");
}

export function beginEntityModalSubmit(modalState, render) {
  if (!modalState) {
    return;
  }

  modalState.status = "loading";
  modalState.error = "";
  render?.();
}

export function cancelEntityModal(resetState, render) {
  resetState?.();
  render?.();
}
