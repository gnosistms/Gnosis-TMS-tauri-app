import { normalizeRovingChoiceGroups } from "./roving-choice.js";

const DIALOG_SELECTOR = "[data-modal-dialog]";
const DEFAULT_SELECTOR = "[data-modal-default]";
const CANCEL_SELECTOR = "[data-modal-cancel]";
const INITIAL_FOCUS_SELECTOR = "[data-modal-initial-focus]";
const ENTER_ACTION_SELECTOR = "[data-modal-enter-action]";
const COMPOSITE_SELECTOR = [
  "[data-listbox-control]",
  "[data-roving-choice-group]",
  "[role='listbox']",
  "[role='menu']",
  "[role='tree']",
  "[role='grid']",
].join(", ");
const TABBABLE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "[contenteditable='true']",
  "[tabindex]",
].join(", ");
const TEXT_INPUT_TYPES = new Set([
  "",
  "date",
  "datetime-local",
  "email",
  "month",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "time",
  "url",
  "week",
]);

let activeDialogSession = null;

function cssAttributeValue(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function elementDocument(element) {
  return element?.ownerDocument ?? globalThis.document;
}

function isElementHidden(element) {
  if (!(element instanceof Element)) {
    return true;
  }

  if (
    element.hidden
    || element.closest("[hidden], [inert], [aria-hidden='true']")
  ) {
    return true;
  }

  const view = elementDocument(element)?.defaultView ?? globalThis.window;
  const style = typeof view?.getComputedStyle === "function"
    ? view.getComputedStyle(element)
    : null;
  return style?.display === "none" || style?.visibility === "hidden";
}

function isEnabledModalControl(element) {
  if (!(element instanceof HTMLElement) || !element.isConnected || isElementHidden(element)) {
    return false;
  }

  if (
    element.matches(":disabled")
    || element.getAttribute("aria-disabled") === "true"
    || element.getAttribute("aria-busy") === "true"
    || element.dataset.action === "noop"
  ) {
    return false;
  }

  return true;
}

function isTabbable(element) {
  if (!isEnabledModalControl(element)) {
    return false;
  }

  const tabindex = element.getAttribute("tabindex");
  if (tabindex !== null && Number.parseInt(tabindex, 10) < 0) {
    return false;
  }

  if (
    element instanceof HTMLInputElement
    && element.type === "hidden"
  ) {
    return false;
  }

  return true;
}

function tabbableModalControls(dialog) {
  if (!(dialog instanceof HTMLElement)) {
    return [];
  }
  return Array.from(dialog.querySelectorAll(TABBABLE_SELECTOR)).filter(isTabbable);
}

function topmostModalDialog(root = document) {
  const dialogs = Array.from(root?.querySelectorAll?.(DIALOG_SELECTOR) ?? [])
    .filter((dialog) => dialog instanceof HTMLElement && !isElementHidden(dialog));
  return dialogs.at(-1) ?? null;
}

function modalCandidate(dialog, selector) {
  const candidates = Array.from(dialog?.querySelectorAll?.(selector) ?? [])
    .filter(isEnabledModalControl);
  return candidates.length === 1 ? candidates[0] : null;
}

function firstEnabled(dialog, selector) {
  return Array.from(dialog?.querySelectorAll?.(selector) ?? [])
    .find(isEnabledModalControl) ?? null;
}

function dialogId(dialog) {
  return String(dialog?.dataset?.modalDialog ?? "").trim();
}

function elementSelector(element, scope) {
  if (!(element instanceof Element) || !(scope instanceof Element || scope instanceof Document)) {
    return "";
  }

  const candidates = [];
  if (element.id) {
    candidates.push(`#${globalThis.CSS?.escape?.(element.id) ?? element.id}`);
  }

  for (const attribute of [
    "data-modal-focus-key",
    "data-action",
    "data-nav-target",
    "data-row-id",
    "name",
  ]) {
    const value = element.getAttribute(attribute);
    if (value) {
      candidates.push(`[${attribute}="${cssAttributeValue(value)}"]`);
    }
  }

  for (const attribute of Array.from(element.attributes ?? [])) {
    if (
      attribute.name.startsWith("data-")
      && !attribute.name.startsWith("data-modal-")
      && attribute.name !== "data-action"
    ) {
      const value = attribute.value;
      candidates.push(
        value
          ? `[${attribute.name}="${cssAttributeValue(value)}"]`
          : `[${attribute.name}]`,
      );
    }
  }

  return candidates.find((selector) => {
    try {
      return scope.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  }) ?? "";
}

function captureFocusLocator(element, scope) {
  const selector = elementSelector(element, scope);
  if (!selector) {
    return null;
  }

  const supportsSelection =
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
  return {
    selector,
    selectionStart: supportsSelection ? element.selectionStart : null,
    selectionEnd: supportsSelection ? element.selectionEnd : null,
    selectionDirection: supportsSelection ? element.selectionDirection : null,
  };
}

function restoreFocusLocator(locator, scope) {
  if (!locator?.selector) {
    return false;
  }

  let element = null;
  try {
    element = scope?.querySelector?.(locator.selector) ?? null;
  } catch {
    return false;
  }
  if (!isEnabledModalControl(element)) {
    return false;
  }

  element.focus({ preventScroll: true });
  if (
    (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
    && typeof locator.selectionStart === "number"
    && typeof locator.selectionEnd === "number"
  ) {
    element.setSelectionRange(
      locator.selectionStart,
      locator.selectionEnd,
      locator.selectionDirection ?? "none",
    );
  }
  return true;
}

function selectedChoice(dialog) {
  return firstEnabled(
    dialog,
    [
      "[data-roving-choice-option][aria-checked='true']",
      "[data-roving-choice-option][aria-selected='true']",
      "[data-listbox-option][aria-selected='true']",
      "[role='option'][aria-selected='true']",
      "[role='radio'][aria-checked='true']",
    ].join(", "),
  );
}

function initialFocusCandidate(dialog) {
  return (
    firstEnabled(dialog, INITIAL_FOCUS_SELECTOR)
    ?? firstEnabled(
      dialog,
      [
        "input:not([type='hidden'])",
        "textarea",
        "select",
        "[contenteditable='true']",
      ].join(", "),
    )
    ?? selectedChoice(dialog)
    ?? modalCandidate(dialog, DEFAULT_SELECTOR)
    ?? modalCandidate(dialog, CANCEL_SELECTOR)
    ?? tabbableModalControls(dialog)[0]
    ?? dialog
  );
}

function focusInitialDialogControl(dialog) {
  const candidate = initialFocusCandidate(dialog);
  if (!(candidate instanceof HTMLElement)) {
    return false;
  }
  candidate.focus({ preventScroll: true });
  return true;
}

export function captureModalRenderState(root = document) {
  const dialog = topmostModalDialog(root);
  const activeElement = elementDocument(root)?.activeElement ?? document.activeElement;
  const activeInsideDialog = dialog instanceof HTMLElement && dialog.contains(activeElement);
  return {
    dialogId: dialogId(dialog),
    focusedInsideDialog: activeInsideDialog
      ? captureFocusLocator(activeElement, dialog)
      : null,
    focusedOutsideDialog: !activeInsideDialog
      ? captureFocusLocator(activeElement, root)
      : null,
  };
}

export function reconcileModalRenderState(root = document, snapshot = {}) {
  normalizeRovingChoiceGroups(root);
  const dialog = topmostModalDialog(root);
  const nextDialogId = dialogId(dialog);
  const previousDialogId = String(snapshot?.dialogId ?? "");

  if (!nextDialogId) {
    if (previousDialogId && activeDialogSession?.opener) {
      restoreFocusLocator(activeDialogSession.opener, root);
    }
    activeDialogSession = null;
    return;
  }

  if (!previousDialogId) {
    activeDialogSession = {
      dialogId: nextDialogId,
      opener: snapshot?.focusedOutsideDialog ?? activeDialogSession?.opener ?? null,
      returnFocusByDialogId: new Map(),
    };
    focusInitialDialogControl(dialog);
    return;
  }

  if (!activeDialogSession) {
    activeDialogSession = {
      dialogId: nextDialogId,
      opener: snapshot?.focusedOutsideDialog ?? null,
      returnFocusByDialogId: new Map(),
    };
  }

  if (previousDialogId === nextDialogId) {
    activeDialogSession.dialogId = nextDialogId;
    if (dialog.contains(elementDocument(dialog)?.activeElement)) {
      return;
    }
    if (!restoreFocusLocator(snapshot?.focusedInsideDialog, dialog)) {
      focusInitialDialogControl(dialog);
    }
    return;
  }

  if (snapshot?.focusedInsideDialog) {
    activeDialogSession.returnFocusByDialogId?.set(
      previousDialogId,
      snapshot.focusedInsideDialog,
    );
  }
  activeDialogSession.dialogId = nextDialogId;
  if (
    !restoreFocusLocator(
      activeDialogSession.returnFocusByDialogId?.get(nextDialogId),
      dialog,
    )
  ) {
    focusInitialDialogControl(dialog);
  }
}

function hasModifier(event) {
  return event.altKey || event.ctrlKey || event.metaKey;
}

function isTextLikeInput(target) {
  return (
    target instanceof HTMLInputElement
    && TEXT_INPUT_TYPES.has(String(target.type ?? "").toLowerCase())
  );
}

function localEnterAction(target, dialog) {
  const owner = target instanceof Element ? target.closest(ENTER_ACTION_SELECTOR) : null;
  const action = String(owner?.dataset?.modalEnterAction ?? "").trim();
  if (!action) {
    return null;
  }
  return Array.from(dialog.querySelectorAll("[data-action]")).find(
    (control) => control.dataset.action === action && isEnabledModalControl(control),
  ) ?? null;
}

function targetOwnsEnter(target) {
  if (!(target instanceof Element)) {
    return false;
  }
  return (
    target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target instanceof HTMLButtonElement
    || target instanceof HTMLAnchorElement
    || target.isContentEditable
    || Boolean(target.closest("[data-modal-enter-ignores-default]"))
    || Boolean(target.closest(COMPOSITE_SELECTOR))
  );
}

function handleEnter(event, dialog) {
  if (event.shiftKey || hasModifier(event)) {
    return;
  }

  const localAction = localEnterAction(event.target, dialog);
  if (localAction) {
    event.preventDefault();
    localAction.click();
    return;
  }

  if (targetOwnsEnter(event.target)) {
    return;
  }
  if (event.target !== dialog && !isTextLikeInput(event.target)) {
    return;
  }

  const defaultControl = modalCandidate(dialog, DEFAULT_SELECTOR);
  if (!defaultControl) {
    return;
  }
  event.preventDefault();
  defaultControl.click();
}

function handleEscape(event, dialog) {
  if (event.shiftKey || hasModifier(event)) {
    return;
  }
  const cancelControl = modalCandidate(dialog, CANCEL_SELECTOR);
  if (!cancelControl) {
    return;
  }
  event.preventDefault();
  cancelControl.click();
}

function handleTab(event, dialog) {
  const controls = tabbableModalControls(dialog);
  if (controls.length === 0) {
    event.preventDefault();
    dialog.focus({ preventScroll: true });
    return;
  }

  const current = elementDocument(dialog)?.activeElement;
  const currentIndex = controls.indexOf(current);
  if (currentIndex === -1) {
    event.preventDefault();
    controls[event.shiftKey ? controls.length - 1 : 0].focus({ preventScroll: true });
    return;
  }

  if (
    (!event.shiftKey && currentIndex === controls.length - 1)
    || (event.shiftKey && currentIndex === 0)
  ) {
    event.preventDefault();
    controls[event.shiftKey ? controls.length - 1 : 0].focus({ preventScroll: true });
  }
}

export function registerModalDialogEvents(doc = document) {
  doc.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.repeat || event.isComposing) {
      return;
    }

    normalizeRovingChoiceGroups(doc);
    const dialog = topmostModalDialog(doc);
    if (!dialog) {
      return;
    }

    if (event.key === "Tab") {
      handleTab(event, dialog);
      return;
    }

    if (!(event.target instanceof Element) || !dialog.contains(event.target)) {
      return;
    }

    if (event.key === "Enter") {
      handleEnter(event, dialog);
    } else if (event.key === "Escape") {
      handleEscape(event, dialog);
    }
  });
}
