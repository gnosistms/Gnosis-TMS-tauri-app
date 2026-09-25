// Out-of-credits errors per provider: the phrases the provider's message
// contains, and where the account owner adds credits. Anthropic returns
// "Your credit balance is too low to access the Anthropic API…" (HTTP 400).
const NO_CREDITS_BY_PROVIDER = {
  openai: {
    label: "OpenAI",
    billingUrl: "https://platform.openai.com/settings/organization/billing/",
    phrases: ["no credits remaining", "run out of credits", "add credits to continue"],
  },
  claude: {
    label: "Claude",
    billingUrl: "https://platform.claude.com/settings/billing",
    phrases: ["credit balance is too low"],
  },
};

function normalizedErrorText(message) {
  return String(message ?? "").trim().toLowerCase();
}

/** Label and billing URL when `message` is this provider's out-of-credits error, else null. */
export function aiProviderNoCreditsInfo(providerId, message) {
  const entry = NO_CREDITS_BY_PROVIDER[String(providerId ?? "").trim().toLowerCase()];
  if (!entry) {
    return null;
  }
  const normalized = normalizedErrorText(message);
  return entry.phrases.some((phrase) => normalized.includes(phrase))
    ? { label: entry.label, billingUrl: entry.billingUrl }
    : null;
}

export function isAiProviderNoCreditsError(providerId, message) {
  return aiProviderNoCreditsInfo(providerId, message) !== null;
}

export function isAiProviderAuthenticationError(message) {
  const normalized = normalizedErrorText(message);
  return (
    normalized.includes("api key was rejected")
    || normalized.includes("incorrect api key")
    || normalized.includes("invalid api key")
    || normalized.includes("invalid x-api-key")
    || normalized.includes("authentication_error")
  );
}

export function classifyAiProviderOperationalError(message) {
  const normalized = normalizedErrorText(message);
  if (isAiProviderAuthenticationError(normalized)) {
    return "authentication_failed";
  }
  if (normalized.includes("could not verify active access for this team")) {
    return "team_access_unverified";
  }
  if (
    normalized.includes("rate limited this request")
    || normalized.includes("temporarily rate limited")
  ) {
    return "rate_limited";
  }
  if (
    Object.values(NO_CREDITS_BY_PROVIDER)
      .some((entry) => entry.phrases.some((phrase) => normalized.includes(phrase)))
  ) {
    return "quota_exhausted";
  }
  return null;
}

export function formatAiProviderActionError(providerId, message) {
  const fallback = String(message ?? "").trim();
  const noCredits = aiProviderNoCreditsInfo(providerId, fallback);
  if (!noCredits) {
    return fallback;
  }
  return `Your ${noCredits.label} account has run out of credits. Add credits at ${noCredits.billingUrl} and try again.`;
}
