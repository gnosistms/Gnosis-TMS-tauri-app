import assert from "node:assert/strict";
import test from "node:test";

import { formatErrorForDisplay } from "./error-display.js";

test("strips internal routing prefixes from user-facing errors", () => {
  assert.equal(
    formatErrorForDisplay("AUTH_REQUIRED: Sign in again."),
    "Sign in again.",
  );
});
