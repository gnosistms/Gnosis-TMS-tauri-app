import assert from "node:assert/strict";
import {
  buildContentSignature,
  stageSignatureHash,
  STAGES,
} from "./cache_progress.mjs";

function signature(overrides = {}) {
  return buildContentSignature({
    sourceUnits: [{ id: 1, text: "source a" }],
    targetUnits: [{ id: 1, text: "target a" }],
    targetRawText: "target a",
    sourceLanguage: "Spanish",
    targetLanguage: "Vietnamese",
    chunkSize: 50,
    stride: 25,
    models: {
      summary: "gpt-5.5",
      sectionMatch: "gpt-5.5",
      rowAlignment: "gpt-5.5",
      conflictResolver: "gpt-5.5",
      splitTarget: "gpt-5.5",
    },
    promptVersions: {
      summary: "same-language-v1",
      sectionMatch: "adaptive-sparse-overlap-top3-v1",
      rowAlignment: "row-align-v1",
      conflictResolver: "row-conflict-v1",
      splitTarget: "split-target-v1",
    },
    ...overrides,
  });
}

const base = signature();
assert.equal(STAGES.length, 11);
assert.equal(stageSignatureHash(base, "summarize_sections"), stageSignatureHash(signature(), "summarize_sections"));

const sourceChanged = signature({ sourceUnits: [{ id: 1, text: "source changed" }] });
assert.notEqual(stageSignatureHash(base, "prepare_units"), stageSignatureHash(sourceChanged, "prepare_units"));
assert.notEqual(stageSignatureHash(base, "summarize_sections"), stageSignatureHash(sourceChanged, "summarize_sections"));

const rendererChanged = { ...base, htmlRendererVersion: "alignment-preview-v2" };
assert.equal(stageSignatureHash(base, "row_alignment"), stageSignatureHash(rendererChanged, "row_alignment"));
assert.notEqual(stageSignatureHash(base, "build_preview"), stageSignatureHash(rendererChanged, "build_preview"));

const dpChanged = { ...base, dpVersion: "corridor-centerline-v2" };
assert.equal(stageSignatureHash(base, "summarize_sections"), stageSignatureHash(dpChanged, "summarize_sections"));
assert.notEqual(stageSignatureHash(base, "select_corridor"), stageSignatureHash(dpChanged, "select_corridor"));
assert.notEqual(stageSignatureHash(base, "row_alignment"), stageSignatureHash(dpChanged, "row_alignment"));

console.log("cache_progress_self_test: ok");
