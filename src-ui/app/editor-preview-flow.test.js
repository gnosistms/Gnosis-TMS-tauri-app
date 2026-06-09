import test from "node:test";
import assert from "node:assert/strict";

import { EDITOR_MODE_PREVIEW } from "./editor-preview.js";
import {
  copyEditorPreviewHtml,
  updateEditorPreviewLanguage,
  writeHtmlToClipboard,
} from "./editor-preview-flow.js";
import {
  createEditorChapterState,
  resetSessionState,
  state,
} from "./state.js";

const originalClipboardItem = globalThis.ClipboardItem;
const originalNavigator = globalThis.navigator;
const originalWindow = globalThis.window;

class TestClipboardItem {
  constructor(items) {
    this.items = items;
  }
}

function installWindow() {
  globalThis.window = {
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
  };
}

function installNavigator(clipboard) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard },
  });
}

test.afterEach(() => {
  resetSessionState();
  globalThis.ClipboardItem = originalClipboardItem;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  });
  globalThis.window = originalWindow;
});

test("writeHtmlToClipboard writes the WordPress HTML clipboard flavor", async () => {
  const writes = [];
  installNavigator({
    async write(items) {
      writes.push(items);
    },
  });
  globalThis.ClipboardItem = TestClipboardItem;

  await writeHtmlToClipboard("<p>Text one</p>");

  assert.equal(writes.length, 1);
  assert.equal(writes[0].length, 1);
  const clipboardItem = writes[0][0];
  assert.deepEqual(Object.keys(clipboardItem.items), ["text/html"]);
  assert.equal(clipboardItem.items["text/html"].type, "text/html");
  assert.equal(await clipboardItem.items["text/html"].text(), "<p>Text one</p>");
});

test("writeHtmlToClipboard falls back to writeText when rich clipboard writes are unavailable", async () => {
  const writes = [];
  installNavigator({
    async writeText(text) {
      writes.push(text);
    },
  });
  globalThis.ClipboardItem = undefined;

  await writeHtmlToClipboard("<p>Fallback</p>");

  assert.deepEqual(writes, ["<p>Fallback</p>"]);
});

test("copyEditorPreviewHtml publishes serialized preview HTML through rich clipboard writes", async () => {
  const writes = [];
  installWindow();
  installNavigator({
    async write(items) {
      writes.push(items);
    },
  });
  globalThis.ClipboardItem = TestClipboardItem;
  state.editorChapter = {
    ...createEditorChapterState(),
    mode: EDITOR_MODE_PREVIEW,
    selectedTargetLanguageCode: "vi",
    rows: [{
      rowId: "row-1",
      lifecycleState: "active",
      textStyle: "paragraph",
      fields: { vi: "Text one[1]" },
      footnotes: { vi: "footnote 1" },
    }],
  };

  await copyEditorPreviewHtml(() => {});

  assert.equal(writes.length, 1);
  const html = await writes[0][0].items["text/html"].text();
  assert.match(html, /^<meta charset='utf-8'>/);
  assert.match(html, /<!-- wp:paragraph -->/);
  assert.match(html, /<p>Text one<sup/);
  assert.match(html, /<sup data-fn="[0-9a-f-]{36}" class="fn"><a id="[0-9a-f-]{36}-link" href="#[0-9a-f-]{36}">1<\/a><\/sup>/);
  assert.match(html, /<!-- wp:footnotes \/-->/);
  assert.doesNotMatch(html, /<ol class="wp-block-footnotes">/);
});

test("preview language selection can copy every chapter language without changing editor selections", async () => {
  const writes = [];
  installWindow();
  installNavigator({
    async write(items) {
      writes.push(items);
    },
  });
  globalThis.ClipboardItem = TestClipboardItem;
  state.editorChapter = {
    ...createEditorChapterState(),
    mode: EDITOR_MODE_PREVIEW,
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "vi", name: "Vietnamese", role: "target" },
      { code: "ja", name: "Japanese", role: "target" },
    ],
    selectedSourceLanguageCode: "es",
    selectedTargetLanguageCode: "vi",
    rows: [{
      rowId: "row-1",
      lifecycleState: "active",
      textStyle: "paragraph",
      fields: {
        es: "Texto fuente",
        vi: "Translated text",
        ja: "Japanese preview text",
      },
    }],
  };

  const previewCases = [
    { code: "es", expected: /Texto fuente/, absent: [/Translated text/, /Japanese preview text/] },
    { code: "vi", expected: /Translated text/, absent: [/Texto fuente/, /Japanese preview text/] },
    { code: "ja", expected: /Japanese preview text/, absent: [/Texto fuente/, /Translated text/] },
  ];

  for (const previewCase of previewCases) {
    updateEditorPreviewLanguage(() => {}, previewCase.code);
    await copyEditorPreviewHtml(() => {});

    assert.equal(state.editorChapter.previewLanguageCode, previewCase.code);
    assert.equal(state.editorChapter.selectedSourceLanguageCode, "es");
    assert.equal(state.editorChapter.selectedTargetLanguageCode, "vi");

    const html = await writes.at(-1)[0].items["text/html"].text();
    assert.match(html, previewCase.expected);
    for (const absentPattern of previewCase.absent) {
      assert.doesNotMatch(html, absentPattern);
    }
  }

  assert.equal(writes.length, previewCases.length);
});
