import test from "node:test";
import assert from "node:assert/strict";

Object.defineProperty(globalThis, "navigator", { configurable: true, value: { platform: "MacIntel" } });
class Field {
  value = "Caption";
  disabled = false;
  readOnly = false;
  selectionStart = 7;
  selectionEnd = 7;
  matches(selector) { return selector === "[data-editor-row-field]"; }
  focus() { this.root.emit({ type: "focusin" }, this); }
  setSelectionRange(start, end, direction = "none") { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; }
  dispatchEvent(event) { return this.root.emit(event, this); }
}
globalThis.HTMLTextAreaElement = Field;
globalThis.InputEvent = class {
  constructor(type, options) { Object.assign(this, { type, defaultPrevented: false }, options); }
  preventDefault() { if (this.cancelable !== false) this.defaultPrevented = true; }
};
const { registerEditorFieldUndoEvents, applyEditorFieldEdit, handleEditorFieldUndoShortcut, recordEditorFieldValue } = await import("./editor-field-undo.js");

function fixture() {
  const callbacks = new Map(), values = [];
  const root = {
    addEventListener(type, callback) { if (!callbacks.has(type)) callbacks.set(type, []); callbacks.get(type).push(callback); },
    emit(event, target) { event.target = target; for (const fn of callbacks.get(event.type) || []) fn(event); return !event.defaultPrevented; },
  };
  registerEditorFieldUndoEvents(root);
  registerEditorFieldUndoEvents(root);
  root.addEventListener("input", ({ target }) => { values.push(target.value); recordEditorFieldValue(target); });
  const field = new Field(); field.root = root; field.focus();
  const type = (value, inputType = "insertText") => {
    root.emit(new InputEvent("beforeinput", { cancelable: true, inputType }), field);
    field.value = value; field.setSelectionRange(value.length, value.length);
    root.emit(new InputEvent("input", { inputType }), field);
  };
  const edit = (value) => applyEditorFieldEdit(field, { value, selectionStart: value.length, selectionEnd: value.length });
  const key = (overrides = {}) => {
    const event = { key: "z", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, target: field, preventDefault() { this.defaultPrevented = true; }, ...overrides };
    return { handled: handleEditorFieldUndoShortcut(event), event };
  };
  return { field, root, type, edit, key, values };
}

test("link edits undo individually, redo, and retain earlier typing", () => {
  navigator.platform = "MacIntel";
  const f = fixture();
  f.type("Caption text");
  f.edit('Caption <a href="https://example.com">text</a>');
  f.edit('Caption <a href="https://example.com/new">text</a>');
  assert.equal(f.key().handled, true);
  assert.equal(f.field.value, 'Caption <a href="https://example.com">text</a>');
  f.key(); assert.equal(f.field.value, "Caption text");
  f.key(); assert.equal(f.field.value, "Caption");
  f.key({ shiftKey: true }); assert.equal(f.field.value, "Caption text");
  f.key({ shiftKey: true }); assert.match(f.field.value, /<a href/);
  assert.ok(f.values.includes("Caption text"));
});

test("typing after a link and branching after undo use separate checkpoints", () => {
  const f = fixture();
  f.edit("Linked caption");
  f.type("Linked caption x"); f.type("Linked caption xy");
  f.key(); assert.equal(f.field.value, "Linked caption");
  f.key(); assert.equal(f.field.value, "Caption");
  f.type("New branch");
  f.key({ shiftKey: true }); assert.equal(f.field.value, "New branch");
  f.key(); assert.equal(f.field.value, "Caption");
});

test("ordinary fields retain native undo and platform modifier rules remain intact", () => {
  const f = fixture();
  assert.equal(f.key().handled, false);
  f.edit("Linked caption");
  assert.equal(f.key({ ctrlKey: true, metaKey: false }).handled, false);
  navigator.platform = "Win32";
  assert.equal(f.key().handled, false);
  assert.equal(f.key({ ctrlKey: true, metaKey: false }).handled, true);
  assert.equal(f.field.value, "Caption");
  f.key({ key: "y", ctrlKey: true, metaKey: false }); assert.equal(f.field.value, "Linked caption");
  navigator.platform = "MacIntel";
});

test("undo follows beforeinput permissions and does not replace external updates", () => {
  const f = fixture();
  f.edit("Linked caption");
  f.root.addEventListener("beforeinput", (event) => event.preventDefault());
  f.key(); assert.equal(f.field.value, "Linked caption");
  const other = fixture(); other.edit("Linked caption");
  other.field.value = "New remote text";
  other.key(); assert.equal(other.field.value, "New remote text");
  assert.equal(other.key().handled, false);
});

test("menu undo events restore the same checkpoint and update the input path", () => {
  const f = fixture(); f.edit("Linked caption");
  const event = new InputEvent("beforeinput", { cancelable: true, inputType: "historyUndo" });
  f.root.emit(event, f.field);
  assert.equal(event.defaultPrevented, true);
  assert.equal(f.field.value, "Caption");
  assert.deepEqual(f.values, ["Caption"]);
});

test("an IME composition stays one undo step after inserting a link", () => {
  const f = fixture(); f.edit("Linked caption");
  f.root.emit({ type: "compositionstart" }, f.field);
  f.type("Linked caption n", "insertCompositionText");
  f.type("Linked caption ñ", "insertCompositionText");
  f.root.emit({ type: "compositionend" }, f.field);
  f.key(); assert.equal(f.field.value, "Linked caption");
  f.key(); assert.equal(f.field.value, "Caption");
});

test("unchanged link edits keep ordinary native history and new content starts fresh", () => {
  const f = fixture(); f.edit("Caption");
  assert.equal(f.key().handled, false);
  f.type("Draft"); f.field.value = "Remote text";
  f.edit("Remote text with a link");
  f.key(); assert.equal(f.field.value, "Remote text");
  f.key(); assert.equal(f.field.value, "Remote text");
});
