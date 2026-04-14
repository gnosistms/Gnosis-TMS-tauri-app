import { invoke } from "./runtime.js";
import {
  createAiReviewMissingKeyModalState,
  state,
} from "./state.js";

function normalizeProviderId(providerId) {
  return providerId === "openai" ? providerId : "openai";
}

export function openAiKeyPage(render, options = {}) {
  const returnScreen =
    typeof options.returnScreen === "string" && options.returnScreen && options.returnScreen !== "aiKey"
      ? options.returnScreen
      : state.screen === "aiKey"
        ? state.aiSettings.returnScreen
        : state.screen;

  state.aiSettings = {
    ...state.aiSettings,
    providerId: normalizeProviderId(state.aiSettings.providerId),
    returnScreen,
    error: "",
  };
  state.aiReviewMissingKeyModal = createAiReviewMissingKeyModalState();
  state.screen = "aiKey";
  render?.();
  void loadAiProviderSecret(render);
}

export async function loadAiProviderSecret(render, options = {}) {
  const providerId = normalizeProviderId(options.providerId ?? state.aiSettings.providerId);

  state.aiSettings = {
    ...state.aiSettings,
    status: "loading",
    error: "",
    providerId,
  };
  render?.();

  try {
    const apiKey = await invoke("load_ai_provider_secret", { providerId });
    state.aiSettings = {
      ...state.aiSettings,
      status: "ready",
      error: "",
      providerId,
      apiKey: typeof apiKey === "string" ? apiKey : "",
      hasLoaded: true,
    };
  } catch (error) {
    state.aiSettings = {
      ...state.aiSettings,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      providerId,
      hasLoaded: true,
    };
  }

  render?.();
}

export function updateAiProviderSecretDraft(nextValue) {
  state.aiSettings = {
    ...state.aiSettings,
    apiKey: typeof nextValue === "string" ? nextValue : "",
    error: "",
  };
}

export async function saveAiProviderSecret(render) {
  const providerId = normalizeProviderId(state.aiSettings.providerId);
  const apiKey = typeof state.aiSettings.apiKey === "string" ? state.aiSettings.apiKey : "";

  state.aiSettings = {
    ...state.aiSettings,
    status: "saving",
    error: "",
    providerId,
  };
  render?.();

  try {
    await invoke("save_ai_provider_secret", {
      providerId,
      apiKey,
    });

    state.aiSettings = {
      ...state.aiSettings,
      status: "ready",
      error: "",
      providerId,
      apiKey: apiKey.trim(),
      hasLoaded: true,
    };

    const shouldReturnToTranslate =
      state.aiSettings.returnScreen === "translate" && Boolean(state.selectedChapterId);
    if (shouldReturnToTranslate) {
      state.aiReviewMissingKeyModal = createAiReviewMissingKeyModalState();
      const { openTranslateChapter } = await import("./translate-flow.js");
      await openTranslateChapter(render, state.selectedChapterId);
      return;
    }
  } catch (error) {
    state.aiSettings = {
      ...state.aiSettings,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      providerId,
      hasLoaded: true,
    };
  }

  render?.();
}

export function openAiReviewMissingKeyModal() {
  state.aiReviewMissingKeyModal = {
    ...createAiReviewMissingKeyModalState(),
    isOpen: true,
  };
}

export function closeAiReviewMissingKeyModal() {
  state.aiReviewMissingKeyModal = createAiReviewMissingKeyModalState();
}
