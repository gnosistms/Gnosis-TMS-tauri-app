import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./translate-flow.js", import.meta.url), "utf8");

test("chapter language updates include broker auth and repo sync metadata", () => {
  assert.match(source, /const sessionToken = requireBrokerSession\(\);/);
  assert.match(source, /invoke\("update_gtms_chapter_languages",\s*\{\s*sessionToken,/s);
  assert.match(source, /fullName:\s*context\.project\.fullName/);
  assert.match(source, /repoId:\s*Number\.isFinite\(context\.project\.repoId\) \? context\.project\.repoId : null/);
  assert.match(source, /defaultBranchName:\s*context\.project\.defaultBranchName \?\? "main"/);
  assert.match(source, /defaultBranchHeadOid:\s*context\.project\.defaultBranchHeadOid \?\? null/);
});
