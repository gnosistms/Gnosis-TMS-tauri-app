import { isMacPlatform } from "./runtime.js";

// DOM-owned history survives the same in-place row updates as native textarea
// history and is released with the field. Only fields edited by the link tool
// use these checkpoints; ordinary fields retain their browser undo behavior.
const histories = new WeakMap();
const registeredRoots = new WeakSet();
const TYPING_INPUTS = new Set(["insertText", "deleteContentBackward", "deleteContentForward"]);
const snapshot = (field) => ({ value: field.value, start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection || "none" });
const isField = (field) => typeof HTMLTextAreaElement !== "undefined" && field instanceof HTMLTextAreaElement && field.matches?.("[data-editor-row-field]");
const historyFor = (field) => {
  if (!histories.has(field)) histories.set(field, { steps: [], position: 0, last: snapshot(field), pending: null, sealed: true, enabled: false, replaying: false });
  return histories.get(field);
};

function record(history, before, after, kind) {
  history.pending = null;
  if (before.value === after.value) { history.last = after; return; }
  history.steps.splice(history.position);
  const previous = history.steps.at(-1);
  const now = Date.now();
  const composing = history.composing && kind === "insertCompositionText";
  const contiguousTyping = TYPING_INPUTS.has(kind) && now - previous?.time < 1000
    && before.start === before.end && before.start === previous?.after.end;
  const coalesce = !history.sealed && previous?.kind === kind && (composing || contiguousTyping)
    && previous.after.value === before.value;
  if (coalesce) { previous.after = after; previous.time = now; }
  else history.steps.push({ before, after, kind, time: now });
  if (history.steps.length > 100) history.steps.shift();
  history.position = history.steps.length;
  history.last = after;
  history.sealed = !TYPING_INPUTS.has(kind) && !composing;
}

function restore(field, redo) {
  const history = histories.get(field);
  if (!history?.enabled || field.disabled || field.readOnly) return false;
  // A remote update must never become an undo of newly loaded content.
  if (field.value !== history.last.value) { histories.delete(field); return false; }
  const step = history.steps[redo ? history.position : history.position - 1];
  if (!step) return true;
  const type = redo ? "historyRedo" : "historyUndo";
  history.replaying = true;
  try {
    // Follow the editor's existing beforeinput permission/stale-row gate.
    if (!field.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: type }))) return true;
    const value = redo ? step.after : step.before;
    field.value = value.value;
    field.setSelectionRange(value.start, value.end, value.direction);
    history.position += redo ? 1 : -1;
    history.last = snapshot(field);
    history.pending = null;
    history.sealed = true;
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: type }));
  } finally { history.replaying = false; }
  return true;
}

export function registerEditorFieldUndoEvents(root = document) {
  if (registeredRoots.has(root)) return;
  registeredRoots.add(root);
  root.addEventListener("focusin", ({ target }) => {
    if (!isField(target)) return;
    const history = historyFor(target);
    if (target.value !== history.last.value) histories.delete(target);
    else history.sealed = true;
  }, true);
  root.addEventListener("focusout", ({ target }) => {
    const history = histories.get(target);
    if (history) history.sealed = true;
  }, true);
  for (const type of ["compositionstart", "compositionend"]) root.addEventListener(type, ({ target }) => {
    if (!isField(target)) return;
    const history = historyFor(target);
    history.composing = type === "compositionstart";
    history.sealed = true;
  }, true);
  root.addEventListener("beforeinput", (event) => {
    if (!isField(event.target)) return;
    const history = historyFor(event.target);
    if (history.replaying) return;
    if (history.enabled && ["historyUndo", "historyRedo"].includes(event.inputType)) {
      event.preventDefault();
      restore(event.target, event.inputType === "historyRedo");
    } else history.pending = snapshot(event.target);
  }, true);
  root.addEventListener("input", (event) => {
    if (!isField(event.target)) return;
    const history = historyFor(event.target);
    if (history.replaying) return;
    const after = snapshot(event.target);
    if (["historyUndo", "historyRedo"].includes(event.inputType)) {
      const position = history.steps.findIndex((step) => step.after.value === after.value);
      if (position >= 0) history.position = position + 1;
      else if (history.steps[0]?.before.value === after.value) history.position = 0;
      else { history.steps = []; history.position = 0; }
      history.last = after; history.pending = null; history.sealed = true;
    } else record(history, history.pending || history.last, after, event.inputType || "input");
  }, true);
}

export function recordEditorFieldValue(field) {
  if (!isField(field)) return;
  const history = histories.get(field);
  if (history && !history.replaying) record(history, history.last, snapshot(field), "programmatic");
}

export function applyEditorFieldEdit(field, result) {
  if (histories.get(field)?.last.value !== field.value) histories.delete(field);
  const history = historyFor(field);
  const before = snapshot(field);
  field.focus({ preventScroll: true });
  if (field.value === result.value) {
    field.setSelectionRange(result.selectionStart, result.selectionEnd);
    return;
  }
  field.value = result.value;
  field.setSelectionRange(result.selectionStart, result.selectionEnd);
  record(history, before, snapshot(field), "link");
  history.enabled = true;
}

export function handleEditorFieldUndoShortcut(event) {
  if (event.defaultPrevented || event.isComposing || event.altKey || !isField(event.target)) return false;
  const modifier = isMacPlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  const key = event.key?.toLowerCase();
  const redo = (key === "z" && event.shiftKey) || (!isMacPlatform() && key === "y" && !event.shiftKey);
  if (!modifier || (key !== "z" && !redo) || !histories.get(event.target)?.enabled) return false;
  event.preventDefault();
  restore(event.target, redo);
  return true;
}
