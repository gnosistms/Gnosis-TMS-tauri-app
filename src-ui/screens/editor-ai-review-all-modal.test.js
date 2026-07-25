import test from "node:test";
import assert from "node:assert/strict";

globalThis.document = {
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  },
};
globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async () => null,
    },
    event: {
      listen: async () => () => {},
    },
  },
};

const { renderEditorAiReviewAllModal } = await import("./editor-ai-review-all-modal.js");
const { createEditorAiReviewAllModalState, createEditorChapterState } = await import("../app/state.js");

function stateWithModal(overrides = {}) {
  return {
    editorChapter: {
      ...createEditorChapterState(),
      chapterId: "chapter-1",
      aiReviewAllModal: {
        ...createEditorAiReviewAllModalState(),
        isOpen: true,
        step: "filter-enabled",
        ...overrides,
      },
    },
  };
}

test("filter-enabled modal shows a stopped state with the error when the run failed", () => {
  const html = renderEditorAiReviewAllModal(stateWithModal({
    error: "OpenAI is temporarily unavailable. Try again in a moment.",
    completedCount: 0,
    totalCount: 42,
  }));

  assert.match(html, /AI Review stopped/);
  assert.match(html, /OpenAI is temporarily unavailable/);
  assert.match(html, /0 of 42<\/strong> unreviewed translations were reviewed/);
  assert.match(html, /Run AI Review again to continue/);
  assert.doesNotMatch(html, /AI Review is finished/);
});

test("filter-enabled modal shows the finished copy with the reviewed count on success", () => {
  const html = renderEditorAiReviewAllModal(stateWithModal({
    completedCount: 42,
    totalCount: 42,
  }));

  assert.match(html, /Please check filter enabled/);
  assert.match(html, /AI Review is finished/);
  assert.match(html, /42 of 42<\/strong> unreviewed translations were reviewed/);
  assert.doesNotMatch(html, /AI Review stopped/);
});

test("filter-enabled modal omits the count line without run totals", () => {
  const html = renderEditorAiReviewAllModal(stateWithModal());

  assert.match(html, /AI Review is finished/);
  assert.doesNotMatch(html, /were reviewed in this run/);
});
