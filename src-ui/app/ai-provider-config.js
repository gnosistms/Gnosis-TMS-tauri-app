export const DEFAULT_AI_PROVIDER_ID = "gemini";

export const AI_PROVIDER_IDS = ["gemini", "openai", "claude", "deepseek"];

const AI_PROVIDER_ICON_URLS = {
  gemini: new URL("../assets/ai-providers/gemini.svg", import.meta.url).href,
  openai: new URL("../assets/ai-providers/openai.png", import.meta.url).href,
  claude: new URL("../assets/ai-providers/claude.png", import.meta.url).href,
  deepseek: new URL("../assets/ai-providers/deepseek.ico", import.meta.url).href,
};

const AI_PROVIDER_CONFIG = {
  openai: {
    id: "openai",
    label: "OpenAI",
    actionLabel: "OpenAI",
    keyTitle: "Enter your OpenAI key",
    keySupportingLabel: "OpenAI",
    keyInstructionLabel: "OpenAI",
    eyebrow: "OPENAI KEY",
    accountLabel: "platform.openai.com",
    accountUrl: "https://platform.openai.com",
    keysUrl: "https://platform.openai.com/settings/organization/api-keys",
    creationHint: 'click "Create new secret key".',
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    actionLabel: "Gemini",
    keyTitle: "Enter your Gemini key",
    keySupportingLabel: "Gemini",
    keyInstructionLabel: "Gemini",
    eyebrow: "GEMINI KEY",
    accountLabel: "aistudio.google.com",
    accountUrl: "https://aistudio.google.com",
    keysUrl: "https://aistudio.google.com/api-keys",
    creationHint: "create a new API key.",
  },
  claude: {
    id: "claude",
    label: "Claude",
    actionLabel: "Claude",
    keyTitle: "Enter your Anthropic API key",
    keySupportingLabel: "Anthropic",
    keyInstructionLabel: "Anthropic API",
    eyebrow: "CLAUDE KEY",
    accountLabel: "platform.claude.com",
    accountUrl: "https://platform.claude.com",
    keysUrl: "https://platform.claude.com/settings/keys",
    creationHint: "create a new API key.",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    actionLabel: "DeepSeek",
    keyTitle: "Enter your DeepSeek key",
    keySupportingLabel: "DeepSeek",
    keyInstructionLabel: "DeepSeek",
    eyebrow: "DEEPSEEK KEY",
    accountLabel: "platform.deepseek.com",
    accountUrl: "https://platform.deepseek.com",
    keysUrl: "https://platform.deepseek.com/api_keys",
    creationHint: "create a new API key.",
  },
};

export function normalizeAiProviderId(providerId) {
  return AI_PROVIDER_IDS.includes(providerId) ? providerId : DEFAULT_AI_PROVIDER_ID;
}

export function getAiProviderConfig(providerId) {
  return AI_PROVIDER_CONFIG[normalizeAiProviderId(providerId)];
}

export function getAiProviderSavedMessage(providerId) {
  return `${getAiProviderConfig(providerId).label} key saved.`;
}

export function getAiProviderActionLabel(providerId) {
  return getAiProviderConfig(providerId).actionLabel;
}

export function getAiProviderIconUrl(providerId) {
  return AI_PROVIDER_ICON_URLS[normalizeAiProviderId(providerId)];
}
