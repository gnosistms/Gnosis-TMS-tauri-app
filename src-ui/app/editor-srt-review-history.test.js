import test from "node:test";
import assert from "node:assert/strict";
import { buildSrtGroupLastUpdate } from "./editor-srt-review-history.js";
import { renderSrtGroupLastUpdate } from "../screens/translate-srt-review-last-update.js";

const entry = (plainText, commitSha, extra = {}) => ({ plainText, commitSha,
  authorName: commitSha, committedAt: "2026-10-23T05:00:00Z", ...extra });

function fixture() {
  const members = ["first", "second", ""].map((text, index) => ({ rowId: `row${index}`,
    fields: { vi: text }, fieldStates: { vi: {} } }));
  const section = { code: "vi", srtParts: ["first", "second", ""], srtMarkers: ["⟦1⟧", "⟦2⟧"] };
  const entriesByRowId = {
    row0: [entry("first", "reviewer", { reviewed: true }), entry("first", "first-editor"), entry("old first", "import")],
    row1: [entry("second", "second-editor"), entry("old second", "import")],
    row2: [entry("", "blank-editor"), entry("old last", "import")],
  };
  const chapter = { history: { rowId: "row1", languageCode: "vi", entries: entriesByRowId.row1,
    group: { languageCode: "vi", memberRowIds: members.map((row) => row.rowId), entriesByRowId, status: "ready" } } };
  return { chapter, row: { srtGroup: { members } }, section };
}

test("each fragment contributes its own latest content change and baseline, including blank cues", () => {
  const { chapter, row, section } = fixture();
  const model = buildSrtGroupLastUpdate(chapter, row, section);
  assert.deepEqual(model.fragments.map((fragment) => fragment.lastUpdateEntry.commitSha), ["first-editor", "second-editor", "blank-editor"]);
  assert.deepEqual(model.fragments.map((fragment) => fragment.lastUpdateBaselineEntry.plainText), ["old first", "old second", "old last"]);
  assert.equal(model.lastUpdateHeadingLabel, "Last update");
  const html = renderSrtGroupLastUpdate(model, "vi");
  assert.match(html, /data-srt-review-combined/);
  assert.match(html, /history-diff__delete/);
  assert.match(html, /old last/);
  assert.match(html, /first-editor/);
  assert.doesNotMatch(html, />reviewer/);
});

test("unsaved changes compare with each fragment's latest saved text", () => {
  const { chapter, row, section } = fixture();
  section.srtParts[1] = "unsaved";
  const model = buildSrtGroupLastUpdate(chapter, row, section);
  assert.equal(model.lastUpdateHeadingLabel, "Current text");
  assert.equal(model.fragments[1].lastUpdateEntry.plainText, "unsaved");
  assert.equal(model.fragments[1].lastUpdateBaselineEntry.plainText, "second");
  assert.equal(model.fragments[0].lastUpdateBaselineEntry.plainText, "old first");
});

test("pending and stalled saves remain visible across the combined group", () => {
  const { chapter, row, section } = fixture();
  section.srtParts[1] = "pending";
  chapter.history.entries = [entry("pending", "optimistic:save", { optimistic: true,
    committedAt: new Date(Date.now() - 20_000).toISOString() }), ...chapter.history.entries];
  const model = buildSrtGroupLastUpdate(chapter, row, section);
  assert.equal(model.showsPendingLocalSave, true);
  assert.equal(model.pendingLocalSaveIsOverdue, true);
  assert.equal(model.lastUpdateHeadingLabel, "Local save stalled");
  assert.equal(model.fragments[1].lastUpdateBaselineEntry.plainText, "second");
});

test("loading, partial history errors and changed membership do not borrow another group's history", () => {
  const { chapter, row, section } = fixture();
  chapter.history.group.status = "error";
  chapter.history.group.error = "Cannot read second fragment";
  delete chapter.history.group.entriesByRowId.row2;
  let model = buildSrtGroupLastUpdate(chapter, row, section);
  assert.match(renderSrtGroupLastUpdate(model, "vi"), /Cannot read second fragment/);
  assert.equal(model.fragments[0].lastUpdateEntry.commitSha, "first-editor");
  chapter.history.group.memberRowIds = ["other", "group", "members"];
  model = buildSrtGroupLastUpdate(chapter, row, section);
  assert.equal(model.history.status, "loading");
  assert.ok(model.fragments.every((fragment) => fragment.lastUpdateBaselineEntry === null));
});

test("attachments and style changes from every fragment retain their cue identity", () => {
  const { chapter, row, section } = fixture();
  row.srtGroup.members[1].footnotes = { vi: [{ marker: 1, text: "new note" }] };
  row.srtGroup.members[2].textStyle = "heading1";
  const html = renderSrtGroupLastUpdate(buildSrtGroupLastUpdate(chapter, row, section), "vi");
  assert.match(html, /data-srt-review-fragment="row1"[\s\S]*new note/);
  assert.match(html, /data-srt-review-fragment="row2"[\s\S]*Style change/);
});
