import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  path.join(currentDir, "actions/translate-actions.js"),
  "utf8",
);

test("language visibility toggle has access to editor collapsed language state", () => {
  assert.match(source, /import \{ state \} from "\.\.\/state\.js";/);
  assert.match(source, /captureLanguageToggleVisibilityAnchor\([\s\S]*state\.editorChapter\?\.collapsedLanguageCodes/);
});

test("target language selection dispatch accepts supported language codes with subtags", () => {
  assert.match(
    source,
    /actionSuffix\(\s*action,\s*"select-target-language-manager-picker-language:",\s*\)/,
  );
  assert.doesNotMatch(
    source,
    /\^select-target-language-manager-picker-language:\(\[a-z\]\{2\}\)\$/,
  );
});

test("WordPress site switching routes to the non-destructive picker action", () => {
  assert.match(source, /if \(action === "show-wordpress-site-picker"\)[\s\S]*showWordPressSitePicker\(render\)/);
  assert.doesNotMatch(source, /action === "disconnect-wordpress"/);
});
