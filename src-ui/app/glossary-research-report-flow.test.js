import test from "node:test";
import assert from "node:assert/strict";
import { state } from "./state.js";
import { updateResearchEntryField, addResearchEntryVariant, unresolvedConflicts } from "./glossary-research-report-flow.js";

for (const [field, value, index] of [["note", "Changed", 0], ["target", "earth", 0], ["include", false, 0], ["generalNote", "Changed"], ["sourceTerms", "mundos"]]) {
  for (const status of ["consistent", "running"]) {
    test(`${field} edit invalidates a ${status} retest`, () => {
      const pending = { status };
      const draft = {
        variants: [{ id: "v1", target: "world", note: "", include: true }, { id: "v2", target: "planet", note: "", include: true }],
        conflicts: [{ variantIds: ["v1", "v2"], retest: pending }], saveStatus: "saved",
      };
      state.glossaryResearchReport.entryDrafts = { e1: draft };
      updateResearchEntryField("e1", field, value, index);
      assert.equal(draft.conflicts[0].retest, null);
      assert.equal(draft.saveStatus, "idle");
      if (field !== "include") assert.equal(unresolvedConflicts(draft).length, 1);
    });
  }
}

test("adding a translation invalidates the retest and saved status", () => {
  const draft = { variants: [], conflicts: [{ retest: { status: "consistent" } }], saveStatus: "saved" };
  state.glossaryResearchReport.entryDrafts = { e1: draft };
  addResearchEntryVariant(() => {}, "e1");
  assert.equal(draft.conflicts[0].retest, null);
  assert.equal(draft.saveStatus, "idle");
});
