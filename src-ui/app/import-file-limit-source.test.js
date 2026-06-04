import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  IMPORT_FILE_SIZE_LIMIT_LABEL,
  MAX_IMPORT_FILE_BYTES,
} from "./import-file-limit.js";

const rustConstantsSource = readFileSync(
  new URL("../../src-tauri/src/constants.rs", import.meta.url),
  "utf8",
);

function parseRustNumericConst(source, name) {
  const pattern = new RegExp(`pub\\(crate\\)\\s+const\\s+${name}:\\s+u64\\s*=\\s*([^;]+);`);
  const match = pattern.exec(source);
  assert.ok(match, `Rust constant ${name} should exist`);

  return match[1]
    .split("*")
    .map((part) => Number(part.trim()))
    .reduce((product, value) => {
      assert.ok(Number.isFinite(value), `Rust constant ${name} should use numeric factors`);
      return product * value;
    }, 1);
}

function parseRustStringConst(source, name) {
  const pattern = new RegExp(`pub\\(crate\\)\\s+const\\s+${name}:\\s*&str\\s*=\\s*"([^"]+)";`);
  const match = pattern.exec(source);
  assert.ok(match, `Rust constant ${name} should exist`);
  return match[1];
}

test("import file limit JS mirror matches authoritative Rust constants", () => {
  assert.equal(
    MAX_IMPORT_FILE_BYTES,
    parseRustNumericConst(rustConstantsSource, "MAX_IMPORT_FILE_BYTES"),
  );
  assert.equal(
    IMPORT_FILE_SIZE_LIMIT_LABEL,
    parseRustStringConst(rustConstantsSource, "IMPORT_FILE_SIZE_LIMIT_LABEL"),
  );
});
