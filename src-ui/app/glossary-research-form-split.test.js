import test from "node:test";
import assert from "node:assert/strict";

import { groupForms, overlap } from "./glossary-research-form-split.js";

const votes = (form, counts) => Object.entries(counts).flatMap(([variantId, n]) => Array.from({ length: n }, () => ({ form, variantId })));

test("overlap is shared translations over all translations of either form", () => {
  assert.equal(overlap(new Set(["a", "b"]), new Set(["a", "b", "c", "d"])), 0.5);
  assert.equal(overlap(new Set(), new Set()), 0);
});

test("vanidad and vanidades share only half their translations, so they are split", () => {
  const all = [
    ...votes("vanidad", { huvinh: 170, phuphiem: 12, thoiham: 6, other: 10 }),
    ...votes("vanidades", { nhungthu: 18, huvinh: 9, phuhoa: 5, phuphiem: 4 }),
  ];
  const groups = groupForms(["vanidad", "vanidades"], all, new Map([["vanidad", 99], ["vanidades", 18]]));
  assert.deepEqual(groups.map((g) => g.forms), [["vanidad"], ["vanidades"]]);
});

test("forms that share most translations stay together", () => {
  const all = [...votes("negro", { den: 50, toi: 5 }), ...votes("negros", { den: 30, toi: 3 })];
  const groups = groupForms(["negro", "negros"], all, new Map([["negro", 30], ["negros", 20]]));
  assert.deepEqual(groups.map((g) => g.forms), [["negro", "negros"]]);
});

test("a chain is not enough: every pair in a group must share most", () => {
  // a~b and b~c share 2 of 3, but a and c share 1 of 4.
  const all = [
    ...votes("a", { x: 20, y: 20 }),
    ...votes("b", { x: 20, y: 20, z: 20 }),
    ...votes("c", { y: 20, z: 20, w: 20 }),
  ];
  const uses = new Map([["a", 20], ["b", 30], ["c", 30]]);
  const groups = groupForms(["a", "b", "c"], all, uses);
  assert.equal(groups.length, 2);
  assert.ok(!groups.some((g) => g.forms.includes("a") && g.forms.includes("c")));
});

test("a form with too few uses joins the group it shares most with, and is marked", () => {
  const all = [
    ...votes("vanidad", { huvinh: 90 }),
    ...votes("vanidades", { nhungthu: 20, phuhoa: 10 }),
    ...votes("vanidosas", { nhungthu: 2 }),
  ];
  const groups = groupForms(["vanidad", "vanidades", "vanidosas"], all, new Map([["vanidad", 45], ["vanidades", 15], ["vanidosas", 1]]));
  const plural = groups.find((g) => g.forms.includes("vanidades"));
  assert.deepEqual(plural.forms, ["vanidades", "vanidosas"]);
  assert.deepEqual(plural.thin, ["vanidosas"]);
});

test("with fewer than two forms that have enough uses, nothing is split", () => {
  const groups = groupForms(["vanidad", "vanidades"], votes("vanidad", { a: 20 }), new Map([["vanidad", 20], ["vanidades", 3]]));
  assert.deepEqual(groups.map((g) => g.forms), [["vanidad", "vanidades"]]);
});
