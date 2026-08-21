const OPENAI_BILLING_URL = "https://platform.openai.com/settings/organization/billing/";

function normalizedErrorText(message) {
  return String(message ?? "").trim().toLowerCase();
}

export function isOpenAiNoCreditsError(providerId, message) {
  if (String(providerId ?? "").trim().toLowerCase() !== "openai") {
    return false;
  }
  const normalized = normalizedErrorText(message);
  return (
    normalized.includes("no credits remaining")
    || normalized.includes("run out of credits")
    || normalized.includes("add credits to continue")
  );
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
    normalized.includes("no credits remaining")
    || normalized.includes("run out of credits")
    || normalized.includes("add credits to continue")
  ) {
    return "quota_exhausted";
  }
  return null;
}

export function formatAiProviderActionError(providerId, message) {
  const fallback = String(message ?? "").trim();
  if (!isOpenAiNoCreditsError(providerId, fallback)) {
    return fallback;
  }
  return `Your OpenAI account has run out of credits. Add credits at ${OPENAI_BILLING_URL} and try again.`;
}
