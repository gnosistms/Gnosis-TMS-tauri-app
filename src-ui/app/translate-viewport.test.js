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
  addEventListener() {},
  setTimeout() {
    return 1;
  },
  clearTimeout() {},
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
  captureTranslateViewport,
  restoreTranslateViewport,
  restoreTranslateViewportAfterPaints,
} = await import("./translate-viewport.js");
const {
  noteUserScrollIntent,
  readUserScrollGeneration,
  resetEditorScrollSessionForTests,
} = await import("./editor-scroll-session.js");

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

test("captured viewports record the user scroll generation at capture time", () => {
  resetEditorScrollSessionForTests();
  noteUserScrollIntent("wheel");
  noteUserScrollIntent("wheel");

  const viewportSnapshot = captureTranslateViewport();

  assert.equal(viewportSnapshot.userScrollGeneration, readUserScrollGeneration());
  assert.equal(viewportSnapshot.userScrollGeneration, 2);
});

test("a restore from a snapshot older than the user's last scroll is refused", () => {
  resetEditorScrollSessionForTests();
  container.scrollTop = 300;
  const viewportSnapshot = captureTranslateViewport();
  assert.equal(viewportSnapshot.scrollTop, 300);

  // The user scrolls after the snapshot was captured (e.g. while a queued
  // write is in flight).
  container.scrollTop = 900;
  noteUserScrollIntent("wheel");

  restoreTranslateViewport(viewportSnapshot);

  assert.equal(container.scrollTop, 900);
});

test("delayed restores are refused when the user scrolls between paints", async () => {
  resetEditorScrollSessionForTests();
  animationFrameQueue = [];
  container.scrollTop = 200;
  const viewportSnapshot = captureTranslateViewport();

  restoreTranslateViewportAfterPaints(viewportSnapshot, 2);
  assert.equal(container.scrollTop, 200);

  container.scrollTop = 700;
  noteUserScrollIntent("wheel");
  await flushAnimationFrames();

  assert.equal(container.scrollTop, 700);
});

test("a user-intent restore applies even from a stale basis", () => {
  resetEditorScrollSessionForTests();
  container.scrollTop = 250;
  const viewportSnapshot = captureTranslateViewport();

  container.scrollTop = 800;
  noteUserScrollIntent("wheel");

  restoreTranslateViewport(viewportSnapshot, { userIntent: true });

  assert.equal(container.scrollTop, 250);
});

test("snapshots without a recorded generation are never refused", () => {
  resetEditorScrollSessionForTests();
  noteUserScrollIntent("wheel");
  container.scrollTop = 0;

  restoreTranslateViewport({ scrollTop: 140 });

  assert.equal(container.scrollTop, 140);
});
