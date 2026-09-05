import test from "node:test";
import assert from "node:assert/strict";

import { pickPreferredAiModelId, resolveVisibleAiTranslateActions } from "./ai-action-config.js";

test("OpenAI picker prefers Astra and preserves explicit model selections", () => {
  const options = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-6-astra"]
    .map((id) => ({ id, label: id }));

  assert.equal(pickPreferredAiModelId("openai", options), "gpt-6-astra");
  for (const { id } of options) {
    assert.equal(pickPreferredAiModelId("openai", options, id), id);
  }
});

test("resolveVisibleAiTranslateActions returns one unified translate action by default", () => {
  const actions = resolveVisibleAiTranslateActions({
    detailedConfiguration: false,
    unified: {
      providerId: "openai",
      modelId: "gpt-5.4",
    },
    actions: {
      translate1: {
        providerId: "gemini",
        modelId: "gemini-2.5-flash",
      },
      translate2: {
        providerId: "claude",
        modelId: "claude-sonnet-4-20250514",
      },
    },
  });

  assert.deepEqual(actions, [
    {
      actionId: "translate1",
      label: "Translate",
      selection: {
        providerId: "openai",
        modelId: "gpt-5.4",
      },
    },
  ]);
});

test("resolveVisibleAiTranslateActions returns both translate actions in detailed mode", () => {
  const actions = resolveVisibleAiTranslateActions({
    detailedConfiguration: true,
    unified: {
      providerId: "openai",
      modelId: "gpt-5.4",
    },
    actions: {
      translate1: {
        providerId: "gemini",
        modelId: "gemini-2.5-flash",
      },
      translate2: {
        providerId: "claude",
        modelId: "claude-sonnet-4-20250514",
      },
    },
  });

  assert.deepEqual(actions, [
    {
      actionId: "translate1",
      label: "Translate 1",
      selection: {
        providerId: "gemini",
        modelId: "gemini-2.5-flash",
      },
    },
    {
      actionId: "translate2",
      label: "Translate 2",
      selection: {
        providerId: "claude",
        modelId: "claude-sonnet-4-20250514",
      },
    },
  ]);
});
