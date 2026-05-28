import test from "node:test";
import assert from "node:assert/strict";

class FakeHTMLElement {
  constructor() {
    this.scrollTop = 0;
    this.scrollLeft = 0;
  }
}

globalThis.HTMLElement = FakeHTMLElement;
globalThis.Element = FakeHTMLElement;

const container = new FakeHTMLElement();
globalThis.document = {
  querySelector(selector) {
    return selector === ".translate-main-scroll" ? container : null;
  },
};

let animationFrameQueue = [];
globalThis.window = {
  requestAnimationFrame(callback) {
    animationFrameQueue.push(callback);
    return animationFrameQueue.length;
  },
};

async function flushAnimationFrames(cycles = 8) {
  for (let index = 0; index < cycles; index += 1) {
    const callbacks = animationFrameQueue;
    animationFrameQueue = [];
    callbacks.forEach((callback) => callback());
    await Promise.resolve();
  }
}

const {
  cancelPendingTranslateViewportRestores,
  restoreTranslateViewportAfterPaints,
} = await import("./translate-viewport.js");

test("editor input can cancel delayed viewport restores after an immediate restore", async () => {
  animationFrameQueue = [];
  container.scrollTop = 0;

  restoreTranslateViewportAfterPaints({ scrollTop: 100 }, 2);
  assert.equal(container.scrollTop, 100);

  container.scrollTop = 175;
  cancelPendingTranslateViewportRestores();
  await flushAnimationFrames();

  assert.equal(container.scrollTop, 175);
});

test("viewport restores still run after paints when they are not canceled", async () => {
  animationFrameQueue = [];
  container.scrollTop = 0;

  restoreTranslateViewportAfterPaints({ scrollTop: 100 }, 1);
  assert.equal(container.scrollTop, 100);

  container.scrollTop = 175;
  await flushAnimationFrames();

  assert.equal(container.scrollTop, 100);
});
