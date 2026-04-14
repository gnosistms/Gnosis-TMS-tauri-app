import {
  closeAiReviewMissingKeyModal,
  openAiKeyPage,
  saveAiProviderSecret,
} from "../ai-settings-flow.js";
import { state } from "../state.js";

export function createAiActions(render) {
  return {
    "save-ai-key": () => saveAiProviderSecret(render),
    "cancel-ai-review-missing-key": () => {
      closeAiReviewMissingKeyModal();
      render();
    },
    "enter-ai-key": () => {
      closeAiReviewMissingKeyModal();
      openAiKeyPage(render, { returnScreen: state.screen });
    },
  };
}
