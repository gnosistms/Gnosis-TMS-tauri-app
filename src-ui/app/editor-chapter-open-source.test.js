import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("opening a different chapter waits for pending editor writes for that chapter before loading rows", async () => {
  const source = await readFile(new URL("./editor-chapter-load-flow.js", import.meta.url), "utf8");

  assert.match(source, /import \{[\s\S]*?anyEditorOperationIsActive,[\s\S]*?waitForEditorOperationQueueIdle,[\s\S]*?\} from "\.\/editor-operation-queue\.js";/);
  assert.match(source, /function editorOperationBelongsToChapter\(operation, repoScope, chapterId\) \{[\s\S]*?operation\?\.repoScope === repoScope[\s\S]*?operation\?\.metadata\?\.chapterId === chapterId/);
  assert.match(source, /function hasPendingEditorWritesForChapter\(team, context\) \{[\s\S]*?return anyEditorOperationIsActive\(\(operation\) =>[\s\S]*?editorOperationBelongsToChapter\(operation, repoScope, chapterId\)[\s\S]*?\);[\s\S]*?\}/);
  assert.match(source, /function canResumeCurrentEditorChapter\(chapterId\) \{[\s\S]*?state\.editorChapter\?\.chapterId === chapterId[\s\S]*?state\.editorChapter\.rows\.length > 0[\s\S]*?\}/);
  assert.match(source, /showScopedSyncBadge\("projects", "Finishing pending editor saves\.\.\.", render\);/);
  assert.match(source, /await waitForEditorOperationQueueIdle\(matchesOpeningChapter\);/);
  assert.match(source, /const resumeCurrentChapter =[\s\S]*?canResumeCurrentEditorChapter\(chapterId\)[\s\S]*?&& hasPendingEditorWritesForChapter\(team, context\);/);
  assert.match(source, /if \(!resumeCurrentChapter\) \{[\s\S]*?await waitForPendingEditorWritesBeforeChapterOpen\(render, team, context\);[\s\S]*?\}/);
  assert.match(source, /if \(resumeCurrentChapter\) \{[\s\S]*?status: "ready",[\s\S]*?render\?\.\(\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?await loadSelectedChapterEditorData\(render, \{\}, operations\);/);
});
