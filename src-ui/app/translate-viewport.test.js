import test from "node:test";
import assert from "node:assert/strict";

class FakeHTMLElement {
  constructor(rect = { top: 0, bottom: 0 }) {
    this.rect = rect;
    this.dataset = {};
    this.scrollTop = 0;
    this.scrollLeft = 0;
  }

  getBoundingClientRect() {
    return this.rect;
  }
}

globalThis.HTMLElement = FakeHTMLElement;
globalThis.Element = FakeHTMLElement;
globalThis.CSS = {
  escape(value) {
    return String(value);
  },
};

const container = new FakeHTMLElement({ top: 100, bottom: 500 });
const row = new FakeHTMLElement({ top: 180, bottom: 260 });
row.dataset = { rowId: "row-1" };
globalThis.document = {
  querySelector(selector) {
    if (selector === ".translate-main-scroll") {
      return container;
    }
    if (selector === '[data-editor-row-card][data-row-id="row-1"]') {
      return row;
    }
    return null;
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
  restoreTranslateViewport,
  restoreTranslateViewportAfterPaints,
} = await import("./translate-viewport.js");

test("viewport restore can skip unstable row-anchor correction", () => {
  container.scrollTop = 10;

  restoreTranslateViewport({
    scrollTop: 100,
    anchor: {
      type: "row",
      rowId: "row-1",
      offsetTop: 20,
    },
  }, {
    skipAnchorRestore: true,
  });

  assert.equal(container.scrollTop, 100);
});

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
