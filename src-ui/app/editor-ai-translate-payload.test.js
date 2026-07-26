import test from "node:test";
import assert from "node:assert/strict";

import {
  applyEditorAiTranslatePayloadToRow,
} from "./editor-ai-translate-flow.js";

test("caption-only AI translation applies the image caption without replacing row text", () => {
  const updates = [];
  applyEditorAiTranslatePayloadToRow(
    {
      captionOnly: true,
      rowId: "row-1",
      targetLanguageCode: "es",
      targetText: "",
      sourceFootnote: "",
      targetFootnote: "",
      sourceImageCaption: "Source caption",
      targetImageCaption: "",
    },
    {
      translatedText: "Translated row text",
      translatedImageCaption: "Pie de foto traducido",
    },
    (...args) => updates.push(args),
  );

  assert.deepEqual(updates, [
    ["row-1", "es", "Pie de foto traducido", "image-caption"],
  ]);
});
