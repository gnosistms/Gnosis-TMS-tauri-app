import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("status-surface renders also refresh the translate title action", async () => {
  const source = await readFile(new URL("../main.js", import.meta.url), "utf8");

  assert.match(source, /import \{\s*buildPageRefreshAction,\s*renderFloatingStatusSurface,\s*\} from "\.\/lib\/ui\.js";/);
  assert.match(source, /function renderPageTitleActionOnly\(\) \{[\s\S]*?if \(state\.screen !== "translate"\) \{[\s\S]*?return false;[\s\S]*?const nextHtml = buildPageRefreshAction\(state\)\.trim\(\);/);
  assert.match(source, /if \(options\?\.scope === "status-surface"\) \{[\s\S]*?renderPageTitleActionOnly\(\);[\s\S]*?return;/);
});
