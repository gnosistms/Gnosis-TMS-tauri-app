import test from "node:test";
import assert from "node:assert/strict";

class FakeInputElement {}
globalThis.HTMLInputElement = FakeInputElement;
globalThis.HTMLTextAreaElement = class FakeTextAreaElement {};

const {
  deferRenderWhileComposing,
  installImeCompositionHold,
  resetImeCompositionHoldForTests,
} = await import("./ime-composition-hold.js");

function fakeDocument() {
  const listeners = {};
  return {
    activeElement: null,
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    fire(type, target) {
      listeners[type]?.({ target });
    },
  };
}

function setup() {
  resetImeCompositionHoldForTests();
  const doc = fakeDocument();
  const renders = [];
  installImeCompositionHold((options) => renders.push(options), doc);
  const field = new FakeInputElement();
  doc.activeElement = field;
  return { doc, renders, field };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("renders pass through when nothing is being composed", () => {
  const { doc } = setup();
  assert.equal(deferRenderWhileComposing({}, doc), false);
});

test("renders wait while a word is composed and land once when it ends", async () => {
  const { doc, renders, field } = setup();
  doc.fire("compositionstart", field);
  assert.equal(deferRenderWhileComposing({}, doc), true);
  assert.equal(deferRenderWhileComposing({}, doc), true);
  assert.deepEqual(renders, []);
  doc.fire("compositionend", field);
  assert.equal(deferRenderWhileComposing({}, doc), false, "renders run normally after the word ends");
  await tick();
  assert.deepEqual(renders, [{}], "the held renders flush as one");
});

test("a scoped render stays scoped; different scopes flush as a full render", async () => {
  const { doc, renders, field } = setup();
  doc.fire("compositionstart", field);
  deferRenderWhileComposing({ scope: "translate-sidebar" }, doc);
  deferRenderWhileComposing({ scope: "translate-sidebar" }, doc);
  doc.fire("compositionend", field);
  await tick();
  doc.fire("compositionstart", field);
  deferRenderWhileComposing({ scope: "translate-sidebar" }, doc);
  deferRenderWhileComposing({ scope: "translate-header" }, doc);
  doc.fire("compositionend", field);
  await tick();
  assert.deepEqual(renders, [{ scope: "translate-sidebar" }, {}]);
});

test("leaving the field ends the hold and flushes", () => {
  const { doc, renders, field } = setup();
  doc.fire("compositionstart", field);
  deferRenderWhileComposing({}, doc);
  doc.fire("focusout", field);
  assert.deepEqual(renders, [{}]);
  assert.equal(deferRenderWhileComposing({}, doc), false);
});

test("composition outside text fields does not hold renders", () => {
  const { doc } = setup();
  const editable = {};
  doc.activeElement = editable;
  doc.fire("compositionstart", editable);
  assert.equal(deferRenderWhileComposing({}, doc), false);
});
