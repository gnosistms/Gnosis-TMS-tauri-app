import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyAiProviderOperationalError,
  formatAiProviderActionError,
  isAiProviderNoCreditsError,
} from "./ai-provider-error.js";

const CLAUDE_NO_CREDITS =
  "Claude returned an error: Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.";

test("classifyAiProviderOperationalError assigns stable expected categories", () => {
  assert.equal(
    classifyAiProviderOperationalError("OpenAI rate limited this request. Wait and retry."),
    "rate_limited",
  );
  assert.equal(
    classifyAiProviderOperationalError("You have no credits remaining. Add credits to continue."),
    "quota_exhausted",
  );
  assert.equal(
    classifyAiProviderOperationalError("The API key was rejected by the provider."),
    "authentication_failed",
  );
  assert.equal(
    classifyAiProviderOperationalError(
      "Could not verify active access for this team. Refresh team access and try again.",
    ),
    "team_access_unverified",
  );
});

test("classifyAiProviderOperationalError leaves unknown failures unclassified", () => {
  assert.equal(
    classifyAiProviderOperationalError("The provider returned malformed structured output."),
    null,
  );
});

test("out-of-credits errors are recognised for OpenAI and Claude", () => {
  assert.equal(classifyAiProviderOperationalError(CLAUDE_NO_CREDITS), "quota_exhausted");
  assert.equal(isAiProviderNoCreditsError("claude", CLAUDE_NO_CREDITS), true);
  assert.equal(isAiProviderNoCreditsError("openai", "You have no credits remaining."), true);
  // Phrases only count for the provider that sends them.
  assert.equal(isAiProviderNoCreditsError("openai", CLAUDE_NO_CREDITS), false);
  assert.equal(isAiProviderNoCreditsError("gemini", CLAUDE_NO_CREDITS), false);
});

test("out-of-credits errors name the provider and its billing page", () => {
  assert.equal(
    formatAiProviderActionError("claude", CLAUDE_NO_CREDITS),
    "Your Claude account has run out of credits. Add credits at https://platform.claude.com/settings/billing and try again.",
  );
  assert.equal(
    formatAiProviderActionError("openai", "You have no credits remaining."),
    "Your OpenAI account has run out of credits. Add credits at https://platform.openai.com/settings/organization/billing/ and try again.",
  );
  assert.equal(formatAiProviderActionError("claude", "Something else."), "Something else.");
});
