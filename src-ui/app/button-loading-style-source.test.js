import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const baseCssSource = readFileSync(new URL("../styles/base.css", import.meta.url), "utf8");

test("secondary loading buttons keep spinner contrast on pale backgrounds", () => {
  assert.match(
    baseCssSource,
    /\.button--secondary\.button--loading:disabled\s*\{[^}]*opacity:\s*1;[^}]*color:\s*rgba\(130,\s*82,\s*27,\s*0\.82\);[^}]*\}/s,
  );
  assert.match(
    baseCssSource,
    /\.button--secondary\.button--loading\s+\.button__spinner\s*\{[^}]*border-color:\s*rgba\(164,\s*112,\s*41,\s*0\.24\);[^}]*border-top-color:\s*rgba\(130,\s*82,\s*27,\s*0\.88\);[^}]*\}/s,
  );
});
