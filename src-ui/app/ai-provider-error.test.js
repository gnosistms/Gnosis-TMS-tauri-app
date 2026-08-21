import test from "node:test";
import assert from "node:assert/strict";

import { classifyAiProviderOperationalError } from "./ai-provider-error.js";

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
