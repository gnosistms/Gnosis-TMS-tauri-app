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

export function secondaryButton(label, action) {
  return `<button class="button button--secondary" data-action="${escapeHtml(
    action,
  )}">${escapeHtml(label)}</button>`;
}

export function textAction(label, action) {
  return `<button class="text-action" data-action="${escapeHtml(
    action,
  )}">${escapeHtml(label)}</button>`;
}

export function pageShell({ title, navButtons = [], tools = "", body = "" }) {
  return `
    <div class="screen screen--page">
      <header class="page-header">
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
