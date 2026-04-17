import test, { after } from "node:test";
import assert from "node:assert/strict";

class FakeElement {
  constructor(parentElement = null, selectors = []) {
    this.parentElement = parentElement;
    this.selectors = new Set(selectors);
  }

  closest(selector) {
    if (this.selectors.has(selector)) {
      return this;
    }

    return this.parentElement?.closest?.(selector) ?? null;
  }
}

class FakeTextNode {
  constructor(parentElement = null) {
    this.parentElement = parentElement;
  }
}

const originalElement = globalThis.Element;
globalThis.Element = FakeElement;

after(() => {
  globalThis.Element = originalElement;
});

const { closestEventTarget, eventTargetElement } = await import("./event-target.js");

test("eventTargetElement resolves a text node target to its parent element", () => {
  const button = new FakeElement(null, ["[data-editor-image-upload-dropzone]"]);
  const textNode = new FakeTextNode(button);

  assert.equal(eventTargetElement(textNode), button);
});

test("closestEventTarget climbs from a text node through its parent element", () => {
  const button = new FakeElement(null, ["[data-editor-image-upload-dropzone]"]);
  const span = new FakeElement(button);
  const textNode = new FakeTextNode(span);

  assert.equal(
    closestEventTarget(textNode, "[data-editor-image-upload-dropzone]"),
    button,
  );
});

test("closestEventTarget returns null when the target has no element ancestor", () => {
  assert.equal(closestEventTarget({ parentElement: null }, "[data-editor-image-upload-dropzone]"), null);
});
