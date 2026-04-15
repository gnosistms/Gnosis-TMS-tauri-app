import {
  buildPageRefreshAction,
  escapeHtml,
  loadingPrimaryButton,
  navButton,
  pageShell,
  primaryButton,
  renderInlineStateBox,
  textAction,
} from "../lib/ui.js";
import { AI_ACTION_IDS, AI_ACTION_LABELS } from "../app/ai-action-config.js";
import {
  AI_PROVIDER_IDS,
  getAiProviderActionLabel,
  getAiProviderConfig,
} from "../app/ai-provider-config.js";
import { getNoticeBadgeText } from "../app/status-feedback.js";

const AI_KEY_RETURN_LABELS = {
  teams: "Teams",
  projects: "Projects",
  users: "Members",
  glossaries: "Glossaries",
  glossaryEditor: "Glossaries",
  translate: "Translate",
  start: "Start",
};

function renderAiKeyBackButton(returnScreen) {
  const target = AI_KEY_RETURN_LABELS[returnScreen] ? returnScreen : "teams";
  const label = AI_KEY_RETURN_LABELS[target] ?? "Teams";
  return navButton(label, target, false, { isBack: true });
}

function renderAiProviderSegments(selectedProviderId, isBusy) {
  const normalizedProviderId = getAiProviderConfig(selectedProviderId).id;

  return `
    <div class="ai-key-provider-control">
      <div class="segmented-control" role="tablist" aria-label="AI provider">
        ${AI_PROVIDER_IDS.map((providerId) => {
    const provider = getAiProviderConfig(providerId);
    const isActive = providerId === normalizedProviderId;
    return `
            <button
              type="button"
              class="segmented-control__button${isActive ? " is-active" : ""}"
              data-action="select-ai-provider:${escapeHtml(providerId)}"
              aria-selected="${isActive ? "true" : "false"}"
              ${isBusy ? "disabled" : ""}
            >${escapeHtml(provider.label)}</button>
          `;
  }).join("")}
      </div>
    </div>
  `;
}

function indefiniteArticleFor(label) {
  return /^[aeiou]/i.test(String(label ?? "").trim()) ? "an" : "a";
}

function renderAiKeyInstructions(provider) {
  if (provider.id === "openai") {
    return `
      <p class="modal__supporting">
        1. To get an OpenAI key, sign up for an OpenAI account at ${textAction(
          provider.accountLabel,
          `open-external:${provider.accountUrl}`,
        )}.
      </p>
      <p class="modal__supporting">
        2. Open ${textAction(
          "this page",
          `open-external:${provider.keysUrl}`,
        )} and click "Create new secret key".
      </p>
    `;
  }

  if (provider.id === "gemini") {
    return `
      <p class="modal__supporting">
        1. To get a Gemini key, sign in at ${textAction(
          provider.accountLabel,
          `open-external:${provider.accountUrl}`,
        )}.
      </p>
      <p class="modal__supporting">
        2. Open the ${textAction(
          "API keys page",
          `open-external:${provider.keysUrl}`,
        )}.
      </p>
      <p class="modal__supporting">
        3. Click "Create API key".
      </p>
    `;
  }

  const instructionLabel = provider.keyInstructionLabel ?? provider.label;
  return `
    <p class="modal__supporting">
      1. To get ${indefiniteArticleFor(instructionLabel)} ${escapeHtml(instructionLabel)} key, sign in at ${textAction(
        provider.accountLabel,
        `open-external:${provider.accountUrl}`,
      )}.
    </p>
    <p class="modal__supporting">
      2. Open ${textAction(
        "this page",
        `open-external:${provider.keysUrl}`,
      )} and ${escapeHtml(provider.creationHint)}
    </p>
  `;
}

function renderProviderSelectOptions(actionConfig, selectedProviderId) {
  if (actionConfig.savedProviderIds.length === 0) {
    return '<option value="" selected>Save a key first</option>';
  }

  return AI_PROVIDER_IDS.map((providerId) => {
    const isSaved = actionConfig.savedProviderIds.includes(providerId);
    const isSelected = providerId === selectedProviderId;
    return `
      <option
        value="${escapeHtml(providerId)}"
        ${isSaved ? "" : "disabled"}
        ${isSelected ? "selected" : ""}
      >${escapeHtml(getAiProviderActionLabel(providerId))}</option>
    `;
  }).join("");
}

function renderModelSelectOptions(actionConfig, providerId, selectedModelId) {
  if (!actionConfig.savedProviderIds.includes(providerId)) {
    return '<option value="" selected>Save a key first</option>';
  }

  const modelsState = actionConfig.modelOptionsByProvider[providerId];
  if (!modelsState || modelsState.status === "loading") {
    return '<option value="" selected>Loading models...</option>';
  }
  if (modelsState.status === "error") {
    return '<option value="" selected>Could not load models</option>';
  }
  if (!Array.isArray(modelsState.options) || modelsState.options.length === 0) {
    return '<option value="" selected>No models available</option>';
  }

  return modelsState.options
    .map((option) => `
      <option
        value="${escapeHtml(option.id)}"
        ${option.id === selectedModelId ? "selected" : ""}
      >${escapeHtml(option.label)}</option>
    `)
    .join("");
}

function renderActionSelectorFields(actionConfig, scopeId, title) {
  const selection = scopeId === "unified"
    ? actionConfig.unified
    : actionConfig.actions[scopeId];
  const modelsState = actionConfig.modelOptionsByProvider[selection.providerId];
  const providerDisabled =
    actionConfig.availableProvidersStatus === "loading"
    || actionConfig.savedProviderIds.length === 0;
  const modelDisabled =
    providerDisabled
    || !actionConfig.savedProviderIds.includes(selection.providerId)
    || !modelsState
    || modelsState.status === "loading"
    || modelsState.status === "error"
    || modelsState.options.length === 0;
  const modelsErrorMarkup = renderInlineStateBox({
    tone: "error",
    message: modelsState?.status === "error" ? modelsState.error : "",
  });

  return `
    <section class="ai-actions-section">
      <h3 class="ai-actions-section__title">${escapeHtml(title)}</h3>
      <div class="ai-actions-section__fields">
        <label class="field">
          <span class="field__label">Provider</span>
          <select
            class="field__select"
            data-ai-settings-provider-select
            data-ai-settings-scope="${escapeHtml(scopeId)}"
            ${providerDisabled ? "disabled" : ""}
          >
            ${renderProviderSelectOptions(actionConfig, selection.providerId)}
          </select>
        </label>
        <label class="field">
          <span class="field__label">Model</span>
          <select
            class="field__select"
            data-ai-settings-model-select
            data-ai-settings-scope="${escapeHtml(scopeId)}"
            ${modelDisabled ? "disabled" : ""}
          >
            ${renderModelSelectOptions(actionConfig, selection.providerId, selection.modelId)}
          </select>
        </label>
      </div>
      ${modelsErrorMarkup}
    </section>
  `;
}

function renderAiActionsPanel(state) {
  const actionConfig = state.aiSettings.actionConfig;
  const statusMarkup = actionConfig.availableProvidersStatus === "error"
    ? renderInlineStateBox({
        tone: "error",
        message: actionConfig.availableProvidersError,
      })
    : actionConfig.availableProvidersStatus === "loading"
      ? renderInlineStateBox({
          message: "Loading saved providers...",
        })
      : actionConfig.savedProviderIds.length === 0
        ? renderInlineStateBox({
            message: "Save an API key on the left to configure actions.",
          })
        : "";

  const sectionsMarkup = actionConfig.detailedConfiguration
    ? AI_ACTION_IDS.map((actionId) =>
      renderActionSelectorFields(actionConfig, actionId, AI_ACTION_LABELS[actionId]))
      .join("")
    : renderActionSelectorFields(actionConfig, "unified", "All actions");

  return `
    <article class="card modal-card modal-card--compact ai-actions-card-shell">
      <div class="card__body modal-card__body ai-actions-card">
        <p class="card__eyebrow">AI ACTIONS</p>
        <h2 class="modal__title">Actions</h2>
        <label class="field__checkbox">
          <input
            type="checkbox"
            data-ai-settings-detailed-toggle
            ${actionConfig.detailedConfiguration ? "checked" : ""}
          />
          <span>Detailed configuration</span>
        </label>
        ${statusMarkup}
        <div class="ai-actions-stack">
          ${sectionsMarkup}
        </div>
      </div>
    </article>
  `;
}

function renderAiModelErrorModal(state) {
  const modal = state.aiSettings.modelErrorModal;
  if (!modal?.isOpen) {
    return "";
  }

  const bannerMarkup = renderInlineStateBox({
    tone: "error",
    message: modal.banner,
    className: "ai-model-error-modal__banner",
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">AI MODEL ERROR</p>
          <h2 class="modal__title">The AI model you selected is not working</h2>
          ${bannerMarkup}
          <p class="modal__supporting">${escapeHtml(modal.message)}</p>
          <div class="modal__actions">
            ${primaryButton("OK", "dismiss-ai-model-error")}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderAiSettingsAboutModal(state) {
  const modal = state.aiSettings.aboutModal;
  if (!modal?.isOpen) {
    return "";
  }

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">ABOUT AI</p>
          <h2 class="modal__title">How to chose the right AI model</h2>
          <p class="modal__supporting ai-about-modal__message">
            When chosing an AI provider, the challenge is finding a model that is capable enough to do the job well while minimizing cost. At the time of this writing (April 2006), we recommend Gemini. However, all providers have models that are capable of doing the job well.<br><br>In addition to chosing between OpenAI, Gemini, Claude, and DeepSeek, you must also choose which model to apply to which tasks. You can chose one model for all tasks, or assign different models for each one. This is also a matter of optimizing cost. Make sure you monitor the cost in your first few days using a new model because some are very expensive, while others are very affordable.
          </p>
          <div class="modal__actions ai-about-modal__actions">
            <label class="field__checkbox">
              <input
                type="checkbox"
                data-ai-settings-about-dismiss-toggle
                ${modal.dontShowAgain ? "checked" : ""}
              />
              <span>Don't show this again</span>
            </label>
            ${primaryButton("I understand", "dismiss-ai-settings-about")}
          </div>
        </div>
      </section>
    </div>
  `;
}

export function renderAiKeyScreen(state) {
  const aiSettings = state.aiSettings;
  const provider = getAiProviderConfig(aiSettings.providerId);
  const keyTitle = provider.keyTitle ?? `Enter your ${provider.label} key`;
  const keySupportingLabel = provider.keySupportingLabel ?? provider.label;
  const isBusy = aiSettings.status === "loading" || aiSettings.status === "saving";
  const saveButton = loadingPrimaryButton({
    label: "Save",
    loadingLabel: aiSettings.status === "saving" ? "Saving..." : "Loading...",
    action: "save-ai-key",
    isLoading: isBusy,
  });
  const errorMarkup = renderInlineStateBox({
    tone: "error",
    message: aiSettings.error,
  });
  const successMarkup = renderInlineStateBox({
    tone: "success",
    message: aiSettings.successMessage,
  });

  return pageShell({
    title: "AI Settings",
    titleAction: buildPageRefreshAction(state),
    navButtons: [renderAiKeyBackButton(aiSettings.returnScreen)],
    noticeText: getNoticeBadgeText(),
    offlineMode: state.offline?.isEnabled === true,
    offlineReconnectState: state.offline?.reconnecting === true,
    bodyClass: "page-body--ai-key",
    body: `
      <section class="ai-key-page">
        <article class="card modal-card modal-card--compact ai-key-card-shell">
          <div class="card__body modal-card__body ai-key-card">
            ${renderAiProviderSegments(aiSettings.providerId, isBusy)}
            <p class="card__eyebrow">${escapeHtml(provider.eyebrow)}</p>
            <h2 class="modal__title">${escapeHtml(keyTitle)}</h2>
            <p class="modal__supporting">
              Save your ${escapeHtml(keySupportingLabel)} API key here. You can store keys for multiple providers at the same time.
            </p>
            ${renderAiKeyInstructions(provider)}
            ${errorMarkup}
            ${successMarkup}
            <label class="field">
              <span class="field__label">API key</span>
              <input
                class="field__input"
                type="text"
                value="${escapeHtml(aiSettings.apiKey)}"
                data-ai-key-input
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                ${isBusy ? "disabled" : ""}
              />
            </label>
            <div class="modal__actions">
              ${saveButton}
            </div>
          </div>
        </article>
        ${renderAiActionsPanel(state)}
      </section>
      ${renderAiModelErrorModal(state)}
      ${renderAiSettingsAboutModal(state)}
    `,
  });
}
