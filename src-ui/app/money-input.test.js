import test from "node:test";
import assert from "node:assert/strict";

import { parseMoneyValue, stepMoneyValue } from "./money-input.js";

test("amounts move by 10%, rounded to the cent", () => {
  assert.equal(stepMoneyValue(4, "up"), 4.4);
  assert.equal(stepMoneyValue(4, "down"), 3.6);
  assert.equal(stepMoneyValue(0.2, "up"), 0.22);
});

test("below ten cents the step is one cent, and never below one cent", () => {
  assert.equal(stepMoneyValue(0.09, "up"), 0.1);
  assert.equal(stepMoneyValue(0.05, "down"), 0.04);
  assert.equal(stepMoneyValue(0.01, "down"), 0.01);
  assert.equal(stepMoneyValue(0, "up"), 0.01);
});

test("a 10% step always changes the amount by at least a cent", () => {
  assert.equal(stepMoneyValue(0.1, "up"), 0.11);
  assert.equal(stepMoneyValue(0.1, "down"), 0.09);
});

test("typed amounts accept a $ sign and a decimal comma", () => {
  assert.equal(parseMoneyValue("$4.50"), 4.5);
  assert.equal(parseMoneyValue("2,5"), 2.5);
  assert.equal(parseMoneyValue("abc"), null);
  assert.equal(parseMoneyValue("0"), 0.01);
  assert.equal(parseMoneyValue("0.004"), 0.01);
  assert.equal(parseMoneyValue("-3"), 0.01);
});
