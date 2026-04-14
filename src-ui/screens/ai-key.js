import {
  buildPageRefreshAction,
  escapeHtml,
  loadingPrimaryButton,
  navButton,
  pageShell,
  renderInlineStateBox,
  textAction,
} from "../lib/ui.js";
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

export function renderAiKeyScreen(state) {
  const aiSettings = state.aiSettings;
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

  return pageShell({
    title: "AI Key",
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
            <p class="card__eyebrow">OPENAI KEY</p>
            <h2 class="modal__title">Enter your Open AI</h2>
            <p class="modal__supporting">
              An Open AI key provides access to AI features in this app. Without it, the app will still work but there will be no AI translation and no AI review functions.
            </p>
            <p class="modal__supporting">
              To get an Open AI key, sign up for an Open AI account at ${textAction(
                "platform.openai.com",
                "open-external:https://platform.openai.com",
              )}. Then open this page and click "+ Create new secret key".
            </p>
            ${errorMarkup}
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
      </section>
    `,
  });
}
