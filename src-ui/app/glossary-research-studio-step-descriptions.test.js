import test from "node:test";
import assert from "node:assert/strict";
import { newStudioStudy, STUDIO_STEPS } from "./glossary-research-studio-workflow.js";
import { studioStepDescription } from "./glossary-research-studio-step-descriptions.js";

const study = (scope = {}) => newStudioStudy({ sourceLanguage: { code: "es", name: "Spanish" },
  targetLanguage: { code: "vi", name: "Vietnamese" }, term: "perverso", ...scope }, "descriptions");

test("every studio step has a description", () => {
  const s = study();
  for (const { id } of STUDIO_STEPS) assert(studioStepDescription(s, id).length > 20, id);
  // A step that has not loaded the paragraphs still holds their compact reference.
  s.passages = { _studioArtifact: "hash", bytes: 10 };
  for (const { id } of STUDIO_STEPS) assert(studioStepDescription(s, id).length > 20, id);
  assert(studioStepDescription(s, "4.6").startsWith("In a sample of paragraphs from"));
});

test("assigning meanings describes the step 3 sample in the research corpus", () => {
  const s = study();
  s.passages = [{ id: "a" }, { id: "b" }, { id: "found later", recovered: true }];
  assert.equal(studioStepDescription(s, "4.6"),
    "In a sample of 2 paragraphs from the complete works of Samael Aun Weor, identify which meaning of perverso is used.");
  const projects = study({ corpus: "projects", term: "walk" });
  projects.passages = [{ id: "a" }];
  assert.equal(studioStepDescription(projects, "4.6"),
    "In a sample of 1 paragraph from the selected projects, identify which meaning of walk is used.");
});
