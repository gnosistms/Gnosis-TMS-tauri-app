import test from "node:test";
import assert from "node:assert/strict";

import { findTermBySourceForm, siblingReminder, siblingSummaries } from "./glossary-term-siblings.js";

const terms = [
  { termId: "a", sourceTerms: ["vanidad", "vano"], targetTerms: ["hư vinh"], siblingTermIds: ["b", "gone"] },
  { termId: "b", sourceTerms: ["vanidades"], targetTerms: ["những thứ phù phiếm", "những thứ phù hoa"], siblingTermIds: ["a"] },
  { termId: "c", sourceTerms: ["Vanagloria"], targetTerms: ["hư vinh"], lifecycleState: "deleted" },
];

test("related entries list the linked entries that still exist", () => {
  assert.deepEqual(siblingSummaries(["b", "gone"], terms), [{ termId: "b", label: "vanidades", targets: "những thứ phù phiếm, những thứ phù hoa" }]);
});

test("an entry is found by any of its source forms, never itself or a deleted one", () => {
  assert.equal(findTermBySourceForm(" VANO ", terms, "b")?.termId, "a");
  assert.equal(findTermBySourceForm("vanidad", terms, "a"), null);
  assert.equal(findTermBySourceForm("vanagloria", terms), null);
});

test("saving an entry with related entries names them as a reminder", () => {
  assert.equal(siblingReminder(terms[0], terms), "Check its related entry too: vanidades.");
  assert.equal(siblingReminder({ siblingTermIds: [] }, terms), "");
});
