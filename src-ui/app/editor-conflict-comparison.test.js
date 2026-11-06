import test from "node:test";
import assert from "node:assert/strict";
import { buildConflictComparison, conflictSourceDiff } from "./editor-conflict-comparison.js";

test("three-way combination preserves disjoint word edits and rejects overlapping edits", () => {
  assert.equal(buildConflictComparison("one two three", "ONE two three", "one two THREE").combined, "ONE two THREE");
  assert.equal(buildConflictComparison("one two", "ONE two", "OTHER two").combined, null);
  assert.equal(buildConflictComparison("abc", "first", "second").combined, null);
  assert.equal(buildConflictComparison(null, "local", "remote").combined, null);
  assert.equal(buildConflictComparison("", "a", "b").combined, null);
});

test("identical and one-sided edits combine without duplicating text", () => {
  assert.equal(buildConflictComparison("old", "new", "new").combined, "new");
  assert.equal(buildConflictComparison("old", "old", "new").combined, "new");
  assert.equal(buildConflictComparison("old", "new", "old").combined, "new");
});

test("links and ruby remain atomic during combination", () => {
  const base = '<a href="https://old.test">read</a> tail';
  const label = '<a href="https://old.test">more</a> tail';
  const destination = '<a href="https://new.test">read</a> tail';
  assert.equal(buildConflictComparison(base, label, destination).combined, null);
  assert.equal(buildConflictComparison(base, label, base.replace("tail", "end")).combined, label.replace("tail", "end"));
  assert.equal(buildConflictComparison('<ruby>漢<rt>かん</rt></ruby>', '<ruby>漢<rt>kan</rt></ruby>', '<ruby>字<rt>かん</rt></ruby>').combined, null);
});

test("Kundalini pattern combines paragraph migration with newer link edits", () => {
  const base = '🙂 Notes:\nhttps://one.test\nhttps://two.test';
  const local = '🙂 Notes:\n\nhttps://one.test\n\nhttps://two.test';
  const remote = '🙂 Notes:\n<a href="https://one.test">Xem thêm.</a>\n<a href="https://two.test">Xem thêm.</a>';
  const result = buildConflictComparison(base, local, remote, { footnote: true });
  assert.equal(result.localParagraphMigration, true);
  assert.equal(result.combined, remote.replaceAll("\n", "\n\n"));
  assert.equal(buildConflictComparison(base, remote, local, { footnote: true }).combined, result.combined);
});

test("paragraph migration recognizes existing blank lines and markup crossing breaks", () => {
  const base = 'a\n \n<strong>b\n</strong>\nc\nd';
  const migrated = 'a\n \n<strong>b\n</strong>\nc\n\nd';
  const result = buildConflictComparison(base, migrated, base.replace("d", "end"), { footnote: true });
  assert.equal(result.localParagraphMigration, true);
  assert.equal(result.combined, migrated.replace("d", "end"));
  assert.equal(buildConflictComparison(base, migrated + " human edit", "remote", { footnote: true }).localParagraphMigration, false);
});

test("combining a migration preserves newly authored line breaks", () => {
  const base = "First\nSecond";
  const migrated = "First\n\nSecond";
  const edited = "First\nSecond\nNew verse line";
  for (const [local, remote] of [[migrated, edited], [edited, migrated]]) {
    const result = buildConflictComparison(base, local, remote, { footnote: true });
    assert.equal(result.combined, "First\n\nSecond\nNew verse line");
    assert.equal(result.localParagraphMigration, false);
    assert.equal(result.remoteParagraphMigration, false);
  }
  assert.equal(buildConflictComparison(base, migrated, "First Second", { footnote: true }).combined, null);
});

test("bounded diffs reconstruct both sides exactly, including multilingual text and markup", () => {
  for (const [before, after] of [
    ['Tiếng Việt 🙂\n<b>x</b>', 'Tiếng Việt mới 🙂\n\n<b>x</b>'],
    ['<script>old</script>', '<script>new</script>'],
    ['a'.repeat(60000), 'b'.repeat(60000)],
  ]) {
    const diff = conflictSourceDiff(before, after);
    assert.equal(diff.filter((d) => d.change !== "insert").map((d) => d.text).join(""), before);
    assert.equal(diff.filter((d) => d.change !== "delete").map((d) => d.text).join(""), after);
  }
});
