import test from "node:test";
import assert from "node:assert/strict";

import {
  cacheEditorImagePreviewFrameSizeForTests,
  clearEditorImagePreviewFrameSizeCacheForTests,
  editorImagePreviewFrameSizesEqual,
  editorImagePreviewFrameSize,
  editorImagePreviewFrameSizeForSrc,
  syncEditorImagePreviewFrame,
  syncEditorImagePreviewFrameWithResult,
  takeEditorImagePreviewFrameSyncResult,
} from "./editor-image-preview-size.js";

function withFakeImageClasses(callback) {
  class FakeElement {
    constructor(properties = new Map()) {
      this.style = {
        setProperty(name, value) {
          properties.set(name, value);
        },
      };
      this.classList = {
        removed: [],
        remove(name) {
          this.removed.push(name);
        },
      };
      this.removedAttributes = [];
    }

    removeAttribute(name) {
      this.removedAttributes.push(name);
    }
  }

  class FakeHTMLElement extends FakeElement {}
  class FakeHTMLImageElement extends FakeHTMLElement {
    constructor(options = {}) {
      super(options.imageProperties);
      this.naturalWidth = options.naturalWidth ?? 300;
      this.naturalHeight = options.naturalHeight ?? 900;
      this.currentSrc = options.currentSrc ?? "https://example.com/portrait.webp";
      this.src = options.src ?? "https://example.com/fallback.webp";
      this.preview = new FakeHTMLElement(options.previewProperties);
    }

    closest(selector) {
      return selector === ".translation-language-panel__image-preview" ? this.preview : null;
    }
  }

  const previousHTMLElement = globalThis.HTMLElement;
  const previousHTMLImageElement = globalThis.HTMLImageElement;
  globalThis.HTMLElement = FakeHTMLElement;
  globalThis.HTMLImageElement = FakeHTMLImageElement;
  try {
    return callback({ FakeHTMLImageElement });
  } finally {
    globalThis.HTMLElement = previousHTMLElement;
    globalThis.HTMLImageElement = previousHTMLImageElement;
  }
}

test("editorImagePreviewFrameSize fits landscape thumbnails by height", () => {
  assert.deepEqual(
    editorImagePreviewFrameSize(800, 500),
    {
      contentWidth: 160,
      contentHeight: 100,
      frameWidth: 178,
      frameHeight: 118,
    },
  );
});

test("editorImagePreviewFrameSize keeps portrait thumbnail frames narrow", () => {
  assert.deepEqual(
    editorImagePreviewFrameSize(300, 900),
    {
      contentWidth: 33,
      contentHeight: 100,
      frameWidth: 51,
      frameHeight: 118,
    },
  );
});

test("syncEditorImagePreviewFrame writes frame and content dimensions", () => {
  clearEditorImagePreviewFrameSizeCacheForTests();
  const previewProperties = new Map();
  const imageProperties = new Map();
  let image = null;
  withFakeImageClasses(({ FakeHTMLImageElement }) => {
    image = new FakeHTMLImageElement({ previewProperties, imageProperties });
    assert.equal(syncEditorImagePreviewFrame(image), true);
  });

  assert.equal(previewProperties.get("--editor-image-preview-width"), "51px");
  assert.equal(previewProperties.get("--editor-image-preview-height"), "118px");
  assert.equal(imageProperties.get("--editor-image-preview-content-width"), "33px");
  assert.equal(imageProperties.get("--editor-image-preview-content-height"), "100px");
  assert.deepEqual(image.preview.classList.removed, ["is-loading"]);
  assert.deepEqual(image.preview.removedAttributes, ["aria-busy"]);
  assert.deepEqual(editorImagePreviewFrameSizeForSrc("https://example.com/portrait.webp"), {
    contentWidth: 33,
    contentHeight: 100,
    frameWidth: 51,
    frameHeight: 118,
  });
});

test("syncEditorImagePreviewFrameWithResult reports unchanged cached dimensions", () => {
  clearEditorImagePreviewFrameSizeCacheForTests();
  cacheEditorImagePreviewFrameSizeForTests("https://example.com/reused.webp", {
    contentWidth: 33,
    contentHeight: 100,
    frameWidth: 51,
    frameHeight: 118,
  });

  withFakeImageClasses(({ FakeHTMLImageElement }) => {
    const image = new FakeHTMLImageElement({
      currentSrc: "https://example.com/reused.webp",
      naturalWidth: 300,
      naturalHeight: 900,
    });
    const result = syncEditorImagePreviewFrameWithResult(image);

    assert.equal(result.synced, true);
    assert.equal(result.sizeChanged, false);
    assert.equal(takeEditorImagePreviewFrameSyncResult(image), result);
    assert.equal(takeEditorImagePreviewFrameSyncResult(image), null);
  });
});

test("syncEditorImagePreviewFrameWithResult reports changed dimensions once per image load", () => {
  clearEditorImagePreviewFrameSizeCacheForTests();

  withFakeImageClasses(({ FakeHTMLImageElement }) => {
    const image = new FakeHTMLImageElement({
      currentSrc: "https://example.com/new.webp",
      naturalWidth: 800,
      naturalHeight: 500,
    });
    const firstResult = syncEditorImagePreviewFrameWithResult(image);
    const secondResult = syncEditorImagePreviewFrameWithResult(image);

    assert.equal(firstResult.synced, true);
    assert.equal(firstResult.sizeChanged, true);
    assert.equal(secondResult, firstResult);
    assert.equal(takeEditorImagePreviewFrameSyncResult(image), firstResult);
  });
});

test("editorImagePreviewFrameSizesEqual compares every frame dimension", () => {
  const size = {
    contentWidth: 160,
    contentHeight: 100,
    frameWidth: 178,
    frameHeight: 118,
  };

  assert.equal(editorImagePreviewFrameSizesEqual(size, { ...size }), true);
  assert.equal(editorImagePreviewFrameSizesEqual(size, { ...size, frameHeight: 119 }), false);
  assert.equal(editorImagePreviewFrameSizesEqual(null, size), false);
});

test("editor image preview size cache can be seeded for reused image rows", () => {
  clearEditorImagePreviewFrameSizeCacheForTests();
  cacheEditorImagePreviewFrameSizeForTests("https://example.com/reused.webp", {
    contentWidth: 160,
    contentHeight: 100,
    frameWidth: 178,
    frameHeight: 118,
  });

  assert.deepEqual(editorImagePreviewFrameSizeForSrc("https://example.com/reused.webp"), {
    contentWidth: 160,
    contentHeight: 100,
    frameWidth: 178,
    frameHeight: 118,
  });
});
