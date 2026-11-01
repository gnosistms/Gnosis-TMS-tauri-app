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

test("configure modal offers the clarity check as the second option", () => {
  const html = renderEditorAiReviewAllModal(stateWithModal({ step: "configure", reviewMode: "clarity" }));

  const values = [...html.matchAll(/value="([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(values, ["grammar", "clarity", "meaning"]);
  assert.match(html, /Identify parts that are difficult to understand/);
  assert.match(html, /value="clarity"\s+checked/);
});

test("clarity finished modal points to the comments and reports what was flagged", () => {
  const html = renderEditorAiReviewAllModal(stateWithModal({
    reviewMode: "clarity",
    completedCount: 12,
    totalCount: 12,
    flaggedCount: 2,
  }));

  assert.match(html, /Please check filter enabled/);
  assert.match(html, /found <strong>2<\/strong> translations with parts that are difficult to understand/);
  assert.match(html, /read the AI's explanation/);
  assert.doesNotMatch(html, /history tab/);
});

test("clarity finished modal says so when nothing was flagged", () => {
  const html = renderEditorAiReviewAllModal(stateWithModal({
    reviewMode: "clarity",
    completedCount: 12,
    totalCount: 12,
    flaggedCount: 0,
  }));

  assert.match(html, /Nothing difficult to understand/);
  assert.doesNotMatch(html, /Please check filter enabled/);
});

test("clarity stopped modal keeps the error and the flagged count", () => {
  const html = renderEditorAiReviewAllModal(stateWithModal({
    reviewMode: "clarity",
    error: "OpenAI is temporarily unavailable.",
    completedCount: 3,
    totalCount: 12,
    flaggedCount: 1,
  }));

  assert.match(html, /AI Review stopped/);
  assert.match(html, /OpenAI is temporarily unavailable/);
  assert.match(html, /found <strong>1<\/strong> translation with parts/);
});
