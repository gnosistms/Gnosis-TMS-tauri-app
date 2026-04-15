import { AI_PROVIDER_IDS } from "../ai-provider-config.js";
import {
  dismissAiSettingsAboutModal,
  closeAiModelErrorModal,
  closeAiReviewMissingKeyModal,
  openAiKeyPage,
  saveAiProviderSecret,
  selectAiProvider,
} from "../ai-settings-flow.js";
import { state } from "../state.js";

export function createAiActions(render) {
  const providerActions = Object.fromEntries(
    AI_PROVIDER_IDS.map((providerId) => [
      `select-ai-provider:${providerId}`,
      () => selectAiProvider(render, providerId),
    ]),
  );

  return {
    ...providerActions,
    "save-ai-key": () => saveAiProviderSecret(render),
    "cancel-ai-review-missing-key": () => {
      closeAiReviewMissingKeyModal();
      render();
    },
    "dismiss-ai-model-error": () => {
      closeAiModelErrorModal();
      render();
    },
    "dismiss-ai-settings-about": () => dismissAiSettingsAboutModal(render),
    "enter-ai-key": () => {
      const providerId =
        typeof state.aiReviewMissingKeyModal?.providerId === "string"
          ? state.aiReviewMissingKeyModal.providerId
          : state.aiSettings.providerId;
      closeAiReviewMissingKeyModal();
      openAiKeyPage(render, {
        returnScreen: state.screen,
        providerId,
      });
    },
  };
}
