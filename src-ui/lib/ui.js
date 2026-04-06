import refreshIconSvg from "../assets/icons/refresh.svg?raw";

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function disabledActionAttributes(options = {}) {
  if (!options.disabled) {
    return "";
  }

  return ' aria-disabled="true" data-offline-blocked="true"';
}

export function navButton(label, target, isGhost = false, options = {}) {
  return `<button class="header-nav__button${
    isGhost ? " header-nav__button--ghost" : ""
  }${options.disabled ? " is-disabled" : ""}" data-nav-target="${escapeHtml(target)}"${disabledActionAttributes(options)}>${escapeHtml(label)}</button>`;
}

export function primaryButton(label, action, options = {}) {
  return `<button class="button button--primary${options.disabled ? " is-disabled" : ""}" data-action="${escapeHtml(
    action,
  )}"${disabledActionAttributes(options)}>${escapeHtml(label)}</button>`;
}

export function errorButton(label, action, options = {}) {
  return `<button class="button button--error${options.disabled ? " is-disabled" : ""}" data-action="${escapeHtml(
    action,
  )}"${disabledActionAttributes(options)}>${escapeHtml(label)}</button>`;
}

export function loadingPrimaryButton({ label, loadingLabel, action, isLoading }) {
  if (isLoading) {
    return `
      <button class="button button--primary button--loading" data-action="noop" disabled>
        <span class="button__spinner" aria-hidden="true"></span>
        <span>${escapeHtml(loadingLabel)}</span>
      </button>
    `;
  }

  return `
    <button class="button button--primary" data-action="${escapeHtml(action)}">
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

export function setImmediateLoadingButton(button, loadingLabel) {
  if (!button) {
    return;
  }

  button.disabled = true;
  button.dataset.action = "noop";
  button.classList.add("button--loading");
  button.innerHTML = `
    <span class="button__spinner" aria-hidden="true"></span>
    <span>${escapeHtml(loadingLabel)}</span>
  `;
}

export function secondaryButton(label, action, options = {}) {
  return `<button class="button button--secondary${options.disabled ? " is-disabled" : ""}" data-action="${escapeHtml(
    action,
  )}"${disabledActionAttributes(options)}>${escapeHtml(label)}</button>`;
}

export function textAction(label, action, options = {}) {
  return `<button class="text-action${options.disabled ? " is-disabled" : ""}" data-action="${escapeHtml(
    action,
  )}"${disabledActionAttributes(options)}>${escapeHtml(label)}</button>`;
}

export function titleRefreshButton(action, options = {}) {
  return `
    <button
      class="title-icon-button${options.disabled ? " is-disabled" : ""}${options.spinning ? " is-spinning" : ""}"
      data-action="${escapeHtml(action)}"
      aria-label="Refresh page"
      title="Refresh page"
      ${options.disabled ? 'aria-disabled="true" data-offline-blocked="true"' : ""}
    >
      <span
        class="title-icon-button__icon${options.spinning ? " is-spinning" : ""}"
        aria-hidden="true"
      >${refreshIconSvg}</span>
    </button>
  `;
}

export function sectionSeparator({ label, action, isOpen = false }) {
  return `
    <button class="section-separator" data-action="${escapeHtml(action)}">
      <span class="section-separator__line" aria-hidden="true"></span>
      <span class="section-separator__label">
        ${escapeHtml(label)}
        <span class="section-separator__chevron ${isOpen ? "is-open" : ""}" aria-hidden="true"></span>
      </span>
      <span class="section-separator__line" aria-hidden="true"></span>
    </button>
  `;
}

function renderStatusBadge(text) {
  if (!text) {
    return "";
  }

  return `
    <div class="team-ui-debug" aria-live="polite">
      <div class="team-ui-debug__content">
        <span class="team-ui-debug__dot" aria-hidden="true"></span>
        <span>${escapeHtml(text)}</span>
      </div>
    </div>
  `;
}

function renderFloatingSyncBadge(pageSync = { status: "idle" }, syncBadgeText = "") {
  const text =
    syncBadgeText ||
    (pageSync.status === "syncing"
      ? "Updating..."
      : pageSync.status === "upToDate"
        ? "Up to date"
        : "");

  return renderStatusBadge(text);
}

function renderFloatingBadge({ pageSync, syncBadgeText, noticeText }) {
  if (noticeText) {
    return renderStatusBadge(noticeText);
  }

  return renderFloatingSyncBadge(pageSync, syncBadgeText);
}

export function pageShell({
  title,
  titleTooltip = "",
  subtitle = "",
  titleAction = "",
  headerClass = "",
  bodyClass = "",
  navButtons = [],
  tools = "",
  leftTools = "",
  headerBody = "",
  body = "",
  pageSync = { status: "idle" },
  syncBadgeText = "",
  noticeText = "",
  offlineMode = false,
  offlineReconnectState = false,
}) {
  return `
    <div class="screen screen--page">
      ${
        offlineMode
          ? `
            <div class="offline-banner" aria-live="polite">
              <span>Offline mode</span>
              <button class="button button--secondary button--compact${offlineReconnectState ? " is-disabled" : ""}" data-action="reconnect-online"${offlineReconnectState ? ' aria-disabled="true"' : ""}>
                ${
                  offlineReconnectState
                    ? '<span class="button__spinner" aria-hidden="true"></span><span>Reconnect</span>'
                    : "<span>Reconnect</span>"
                }
              </button>
            </div>
          `
          : ""
      }
      <header class="page-header${headerClass ? ` ${escapeHtml(headerClass)}` : ""}">
        <div class="page-header__left">
          <div class="page-header__nav">${navButtons.join("")}</div>
          ${leftTools ? `<div class="page-header__left-tools">${leftTools}</div>` : ""}
        </div>
        <div class="page-header__title-wrap">
          <div class="page-header__title-row">
            <h1 class="page-header__title" title="${escapeHtml(titleTooltip || title)}">${escapeHtml(title)}</h1>
            ${titleAction}
          </div>
          ${subtitle ? `<p class="page-header__subtitle">${escapeHtml(subtitle)}</p>` : ""}
        </div>
        <div class="page-header__tools">${tools}</div>
        ${headerBody ? `<div class="page-header__detail">${headerBody}</div>` : ""}
      </header>
      <main class="page-body${bodyClass ? ` ${escapeHtml(bodyClass)}` : ""}">${body}</main>
      ${renderFloatingBadge({ pageSync, syncBadgeText, noticeText })}
    </div>
  `;
}

export function createSearchField(placeholder = "Search") {
  return `
    <label class="search-field">
      <span class="search-field__icon">⌕</span>
      <input type="text" placeholder="${escapeHtml(placeholder)}" />
    </label>
  `;
}
