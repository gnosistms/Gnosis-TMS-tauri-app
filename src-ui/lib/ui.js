export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function navButton(label, target, isGhost = false) {
  return `<button class="header-nav__button${
    isGhost ? " header-nav__button--ghost" : ""
  }" data-nav-target="${escapeHtml(target)}">${escapeHtml(label)}</button>`;
}

export function primaryButton(label, action) {
  return `<button class="button button--primary" data-action="${escapeHtml(
    action,
  )}">${escapeHtml(label)}</button>`;
}

export function loadingPrimaryButton({ label, loadingLabel, action, isLoading }) {
  if (isLoading) {
    return `
      <button class="button button--primary" data-action="noop" disabled>
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
  button.innerHTML = `
    <span class="button__spinner" aria-hidden="true"></span>
    <span>${escapeHtml(loadingLabel)}</span>
  `;
}

export function secondaryButton(label, action, options = {}) {
  const disabled = options.disabled ? " disabled" : "";
  const actionValue = options.disabled ? "noop" : action;
  return `<button class="button button--secondary" data-action="${escapeHtml(
    actionValue,
  )}"${disabled}>${escapeHtml(label)}</button>`;
}

export function textAction(label, action) {
  return `<button class="text-action" data-action="${escapeHtml(
    action,
  )}">${escapeHtml(label)}</button>`;
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

export function pageShell({ title, navButtons = [], tools = "", body = "", syncing = false }) {
  const syncIndicator = `
    <div class="page-header__status" aria-live="polite">
      <span class="sync-indicator">
        <span class="sync-indicator__spinner" aria-hidden="true"></span>
      </span>
    </div>
  `;
  return `
    <div class="screen screen--page">
      <header class="page-header">
        ${syncing ? syncIndicator : '<div class="page-header__status"></div>'}
        <div class="page-header__nav">${navButtons.join("")}</div>
        <div class="page-header__title-wrap">
          <h1 class="page-header__title">${escapeHtml(title)}</h1>
        </div>
        <div class="page-header__tools">${tools}</div>
      </header>
      <main class="page-body">${body}</main>
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
