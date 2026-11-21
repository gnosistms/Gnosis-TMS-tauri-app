import test from "node:test";
import assert from "node:assert/strict";
import { applyResearchTextEdit, markedStudioText, studioCitationText } from "./glossary-research-studio-citations.js";

test("fields and errors hide grouped, bare, and explicitly labelled paragraph IDs", () => {
  const id = "4e2800126bc0e8c6";
  const numeric = "0123456789012345";
  const passages = { [id]: { text: "The source" }, [numeric]: { text: "Another source" } };
  const formatted = studioCitationText(`One [${id.toUpperCase()}; 00000000deadbeef]. Two /${numeric}:o1.`, passages, true);
  assert.equal(formatted, "One. Two /source paragraph:o1.");
  assert.equal(studioCitationText(`{"paragraphId":"${numeric}"}`, undefined, true), '{"paragraphId":"source paragraph"}');
  assert.equal(studioCitationText(`Edition 1960, ${numeric} copies.`, undefined, true), `Edition 1960, ${numeric} copies.`);
  assert.equal(studioCitationText(id.repeat(4), passages, true), id.repeat(4));
  // An annotation partly inside a highlight must not reveal either half.
  assert.equal(markedStudioText(`Term (${id}) here`, [{ start: 0, end: 12 }], passages), "<mark>Term</mark> here");
});

test("editing visible wording preserves citations on retained text and through repeated edits", () => {
  const raw = "First (4e2800126bc0e8c6). Second (49063cb94894ff79).";
  assert.equal(applyResearchTextEdit(raw, "First. Second."), raw);
  const edited = applyResearchTextEdit(raw, "First. Revised second.");
  assert.equal(edited, "First (4e2800126bc0e8c6). Revised second (49063cb94894ff79).");
  assert.equal(applyResearchTextEdit(edited, "First. Revised second. More."), edited + " More.");
  assert.equal(applyResearchTextEdit(raw, ""), "");
  assert.equal(applyResearchTextEdit("", "Pasted (00000000deadbeef)."), "Pasted.");
});
