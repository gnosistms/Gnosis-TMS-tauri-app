import {
  buildPageRefreshAction,
  buildSectionNav,
  escapeHtml,
  loadingPrimaryButton,
  pageShell,
  primaryButton,
  renderInlineStateBox,
  textAction,
} from "../lib/ui.js";
import { AI_ACTION_IDS, AI_ACTION_LABELS } from "../app/ai-action-config.js";
import {
  aiActionControlsAreBusy,
  getAiActionControlsBusyMessage,
} from "../app/ai-settings-flow.js";
import {
  AI_PROVIDER_IDS,
  getAiProviderActionLabel,
  getAiProviderConfig,
} from "../app/ai-provider-config.js";
import { getNoticeBadgeText } from "../app/status-feedback.js";

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

function renderActionSelectorFields(actionConfig, scopeId, title, controlsBusy = false) {
  const selection = scopeId === "unified"
    ? actionConfig.unified
    : actionConfig.actions[scopeId];
  const modelsState = actionConfig.modelOptionsByProvider[selection.providerId];
  const providerDisabled =
    controlsBusy
    || actionConfig.availableProvidersStatus === "loading"
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
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId) ?? null;
  const sharedTeamMode =
    Boolean(state.auth?.session?.sessionToken)
    && Number.isFinite(selectedTeam?.installationId);
  const readOnly = sharedTeamMode && selectedTeam?.canDelete !== true;
  const controlsBusy = aiActionControlsAreBusy(state.aiSettings) || readOnly;
  const statusMarkup = [
    state.aiSettings.teamShared?.error
      ? renderInlineStateBox({
          tone: "error",
          message: state.aiSettings.teamShared.error,
        })
      : "",
    state.aiSettings.teamShared?.settingsSaveError
      ? renderInlineStateBox({
          tone: "error",
          message: state.aiSettings.teamShared.settingsSaveError,
        })
      : "",
    sharedTeamMode
      ? renderInlineStateBox({
          tone: readOnly ? "warning" : "success",
          message: readOnly
            ? "These shared AI settings are managed by the team owner."
            : "Changes here save to the selected team automatically.",
        })
      : "",
    actionConfig.availableProvidersStatus === "error"
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
              message: sharedTeamMode
                ? "Configure a team AI key on the left to enable actions."
                : "Save an API key on the left to configure actions.",
            })
          : "",
  ].join("");

  const sectionsMarkup = actionConfig.detailedConfiguration
    ? AI_ACTION_IDS.map((actionId) =>
      renderActionSelectorFields(actionConfig, actionId, AI_ACTION_LABELS[actionId], controlsBusy))
      .join("")
    : renderActionSelectorFields(actionConfig, "unified", "All actions", controlsBusy);

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
            ${controlsBusy ? "disabled" : ""}
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

function renderSharedProviderState(state, providerId) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId) ?? null;
  const sharedTeamMode =
    Boolean(state.auth?.session?.sessionToken)
    && Number.isFinite(selectedTeam?.installationId);
  if (!sharedTeamMode) {
    return "";
  }

  const providerMetadata = state.aiSettings.teamShared?.secrets?.providers?.[providerId] ?? null;
  const isOwner = selectedTeam?.canDelete === true;
  if (providerMetadata?.configured) {
    return renderInlineStateBox({
      tone: "success",
      message: isOwner
        ? "A shared team key is already configured for this provider. Enter a new value to rotate it."
        : "A shared team key is configured for this provider.",
    });
  }

  return renderInlineStateBox({
    message: isOwner
      ? "No shared team key is configured for this provider yet."
      : "This provider is not configured for the team yet.",
  });
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
            When chosing an AI provider, the challenge is finding a model that is capable enough to do the job well while minimizing cost. At the time of this writing (April 2006), we recommend OpenAI. However, all providers have models that are capable of doing the job well.<br><br>In addition to chosing between OpenAI, Gemini, Claude, and DeepSeek, you must also choose which model to apply to which tasks. You can chose one model for all tasks, or assign different models for each one. This is also a matter of optimizing cost. Make sure you monitor the cost in your first few days using a new model because some are very expensive, while others are very affordable.
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
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId) ?? null;
  const sharedTeamMode =
    Boolean(state.auth?.session?.sessionToken)
    && Number.isFinite(selectedTeam?.installationId);
  const canEditSharedTeamAi = !sharedTeamMode || selectedTeam?.canDelete === true;
  const keyTitle = sharedTeamMode
    ? `Manage the team ${provider.label} key`
    : provider.keyTitle ?? `Enter your ${provider.label} key`;
  const isBusy = aiSettings.status === "loading" || aiSettings.status === "saving";
  const saveButton = isBusy
    ? loadingPrimaryButton({
        label: "Save",
        loadingLabel: aiSettings.status === "saving" ? "Saving..." : "Loading...",
        action: "save-ai-key",
        isLoading: true,
      })
    : primaryButton("Save", "save-ai-key", { disabled: !canEditSharedTeamAi });
  const errorMarkup = renderInlineStateBox({
    tone: "error",
    message: aiSettings.error,
  });
  const successMarkup = renderInlineStateBox({
    tone: "success",
    message: aiSettings.successMessage,
  });
  const sharedProviderStateMarkup = renderSharedProviderState(state, aiSettings.providerId);
  const noticeText = getNoticeBadgeText() || getAiActionControlsBusyMessage(aiSettings);

  return pageShell({
    title: "AI Settings",
    titleAction: buildPageRefreshAction(state),
    subtitle: state.teams.find((team) => team.id === state.selectedTeamId)?.name ?? "Team",
    navButtons: buildSectionNav("aiKey"),
    noticeText,
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
              ${
                sharedTeamMode
                  ? canEditSharedTeamAi
                    ? `Store the team's ${escapeHtml(provider.label)} key here. The app keeps the shared key encrypted in the team's metadata repo.`
                    : "Only the team owner can change shared AI keys for this team."
                  : `Save your ${escapeHtml(provider.keySupportingLabel ?? provider.label)} API key here. You can store keys for multiple providers at the same time.`
              }
            </p>
            ${sharedTeamMode && !canEditSharedTeamAi ? "" : renderAiKeyInstructions(provider)}
            ${sharedProviderStateMarkup}
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
                ${isBusy || !canEditSharedTeamAi ? "disabled" : ""}
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
