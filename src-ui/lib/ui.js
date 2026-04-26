import refreshIconSvg from "../assets/icons/refresh.svg?raw";

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function tooltipAttributes(text, options = {}) {
  const tooltip = String(text ?? "").trim();
  if (!tooltip) {
    return "";
  }

  const align = options.align === "start" || options.align === "end"
    ? ` data-tooltip-align="${escapeHtml(options.align)}"`
    : "";
  const side = options.side === "bottom"
    ? ` data-tooltip-side="${escapeHtml(options.side)}"`
    : "";

  return ` data-tooltip="${escapeHtml(tooltip)}"${align}${side}`;
}

function disabledActionAttributes(options = {}) {
  if (!options.disabled) {
    return "";
  }

  return ' disabled aria-disabled="true" data-offline-blocked="true"';
}

function serializeAttributes(attributes = {}) {
  return Object.entries(attributes)
    .map(([key, value]) => {
      if (value === false || value === null || value === undefined) {
        return "";
      }

      if (value === true) {
        return ` ${escapeHtml(key)}`;
      }

      return ` ${escapeHtml(key)}="${escapeHtml(value)}"`;
    })
    .join("");
}

export function navButton(label, target, isGhost = false, options = {}) {
  const chevron = options.isBack
    ? `
      <span class="header-nav__back-chevron" aria-hidden="true">
        <svg viewBox="0 0 10 18" focusable="false" aria-hidden="true">
          <path d="M8.5 1.5 2 9l6.5 7.5" />
        </svg>
      </span>
    `
    : "";
  return `<button class="header-nav__button${
    isGhost ? " header-nav__button--ghost" : ""
  }${
    options.isBack ? " header-nav__button--back" : ""
  }${options.disabled ? " is-disabled" : ""}" data-nav-target="${escapeHtml(target)}"${disabledActionAttributes(options)}>${chevron}<span>${escapeHtml(label)}</span></button>`;
}

export function actionNavButton(label, action, isGhost = false, options = {}) {
  const chevron = options.isBack
    ? `
      <span class="header-nav__back-chevron" aria-hidden="true">
        <svg viewBox="0 0 10 18" focusable="false" aria-hidden="true">
          <path d="M8.5 1.5 2 9l6.5 7.5" />
        </svg>
      </span>
    `
    : "";
  return `<button class="header-nav__button${
    isGhost ? " header-nav__button--ghost" : ""
  }${
    options.isBack ? " header-nav__button--back" : ""
  }${options.disabled ? " is-disabled" : ""}" data-action="${escapeHtml(action)}"${disabledActionAttributes(options)}>${chevron}<span>${escapeHtml(label)}</span></button>`;
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
  const tooltip = options.tooltip
    ? tooltipAttributes(options.tooltip, options.tooltipOptions)
    : "";
  const className = typeof options.className === "string" && options.className.trim()
    ? ` ${escapeHtml(options.className.trim())}`
    : "";
  return `<button class="button button--secondary${options.compact ? " button--compact" : ""}${options.disabled ? " is-disabled" : ""}${className}" data-action="${escapeHtml(
    action,
  )}"${tooltip}${disabledActionAttributes(options)}>${escapeHtml(label)}</button>`;
}

export function textAction(label, action, options = {}) {
  const tooltip = options.tooltip
    ? tooltipAttributes(options.tooltip, options.tooltipOptions)
    : "";
  return `<button class="text-action${options.disabled ? " is-disabled" : ""}" data-action="${escapeHtml(
    action,
  )}"${tooltip}${disabledActionAttributes(options)}>${escapeHtml(label)}</button>`;
}

export function renderChevronIcon(direction = "right", className = "") {
  const directionClass = direction === "down"
    ? "chevron-icon--down"
    : "";
  const classes = ["chevron-icon", directionClass, className]
    .filter(Boolean)
    .join(" ");
  return `
    <span class="${classes}" aria-hidden="true">
      <svg viewBox="0 0 12 12" focusable="false" aria-hidden="true">
        <path d="M3 2 7 6 3 10" />
      </svg>
    </span>
  `;
}

export function renderCollapseChevron(isOpen = false, className = "") {
  const classes = ["collapse-chevron", isOpen ? "is-open" : "", className]
    .filter(Boolean)
    .join(" ");
  return renderChevronIcon(isOpen ? "down" : "right", classes);
}

export function renderFlowArrowIcon(className = "") {
  const classes = ["flow-arrow-icon", className]
    .filter(Boolean)
    .join(" ");
  return `
    <span class="${classes}" aria-hidden="true">
      <svg viewBox="0 0 16 10" focusable="false" aria-hidden="true">
        <path d="M1 5h12" />
        <path d="m9.5 1.5 4 3.5-4 3.5" />
      </svg>
    </span>
  `;
}

export function titleRefreshButton(action, options = {}) {
  const spinDelayMs =
    options.spinning && Number.isFinite(options.spinStartedAt)
      ? Math.max(0, Math.floor(performance.now() - options.spinStartedAt))
      : 0;
  const spinStyle =
    options.spinning && spinDelayMs > 0
      ? ` style="--title-icon-spin-delay: -${spinDelayMs}ms;"`
      : "";
  return `
    <button
      class="title-icon-button${options.disabled ? " is-disabled" : ""}${options.spinning ? " is-spinning" : ""}"
      data-action="${escapeHtml(action)}"
      aria-label="Refresh page"
      ${tooltipAttributes("Refresh page", { side: "bottom" })}
      ${options.disabled ? 'aria-disabled="true" data-offline-blocked="true"' : ""}
    >
      <span
        class="title-icon-button__icon${options.spinning ? " is-spinning" : ""}"
        aria-hidden="true"
        ${spinStyle}
      >${refreshIconSvg}</span>
    </button>
  `;
}

export function buildPageRefreshAction(appState, syncState = appState?.pageSync, action = "refresh-page", options = {}) {
  const backgroundRefreshing = options.backgroundRefreshing === true;
  const spinning = syncState?.status === "syncing" || backgroundRefreshing;
  return titleRefreshButton(action, {
    spinning,
    spinStartedAt: syncState?.startedAt,
    disabled: appState?.offline?.isEnabled === true || spinning,
  });
}

export function sectionSeparator({ label, action, isOpen = false }) {
  return `
    <button class="section-separator" data-action="${escapeHtml(action)}">
      <span class="section-separator__line" aria-hidden="true"></span>
      <span class="section-separator__label collapse-affordance">
        ${escapeHtml(label)}
        ${renderCollapseChevron(isOpen, "section-separator__chevron")}
      </span>
      <span class="section-separator__line" aria-hidden="true"></span>
    </button>
  `;
}

const sectionNavConfig = {
  teams: [
    { label: "Logout", target: "start" },
  ],
  projects: [
    { label: "Teams", target: "teams", isBack: true },
    { label: "Members", target: "users" },
    { label: "Glossaries", target: "glossaries" },
    { label: "AI Settings", target: "aiKey", ownerOnly: true },
    { label: "Logout", target: "start" },
  ],
  users: [
    { label: "Teams", target: "teams", isBack: true },
    { label: "Projects", target: "projects" },
    { label: "Glossaries", target: "glossaries" },
    { label: "AI Settings", target: "aiKey", ownerOnly: true },
    { label: "Logout", target: "start" },
  ],
  glossaries: [
    { label: "Teams", target: "teams", isBack: true },
    { label: "Projects", target: "projects" },
    { label: "Members", target: "users" },
    { label: "AI Settings", target: "aiKey", ownerOnly: true },
    { label: "Logout", target: "start" },
  ],
  aiKey: [
    { label: "Teams", target: "teams" },
    { label: "Projects", target: "projects" },
    { label: "Glossaries", target: "glossaries" },
    { label: "Members", target: "users" },
    { label: "Logout", target: "start" },
  ],
  glossaryEditor: [
    { label: "Glossaries", target: "glossaries", isBack: true },
    { label: "Projects", target: "projects" },
  ],
  translate: [
    { label: "Projects", target: "projects", isBack: true },
    { label: "Glossaries", target: "glossaries" },
  ],
};

export function buildSectionNav(screen, options = {}) {
  const includeAiSettings = options.includeAiSettings === true;
  return (sectionNavConfig[screen] ?? [])
    .filter((item) => !item.ownerOnly || includeAiSettings)
    .map(({ label, target, isBack }) =>
      navButton(label, target, false, { isBack }),
    );
}

export function renderStateCard({ eyebrow = "", title = "", subtitle = "", tone = "" }) {
  const toneClass =
    tone === "error"
      ? " card--state-error"
      : tone === "warning"
        ? " card--state-warning"
        : "";

  return `
    <article class="card card--hero card--empty${toneClass}">
      <div class="card__body">
        ${eyebrow ? `<p class="card__eyebrow">${escapeHtml(eyebrow)}</p>` : ""}
        ${title ? `<h2 class="card__title card__title--small">${escapeHtml(title)}</h2>` : ""}
        ${subtitle ? `<p class="card__subtitle">${escapeHtml(subtitle)}</p>` : ""}
      </div>
    </article>
  `;
}

export function renderInlineStateBox({
  tone = "warning",
  message = "",
  help = "",
  className = "",
  actionLabel = "",
  action = "",
  actionDisabled = false,
}) {
  const normalizedMessage = String(message ?? "").trim();
  const normalizedHelp = String(help ?? "").trim();
  const normalizedActionLabel = String(actionLabel ?? "").trim();
  const normalizedAction = String(action ?? "").trim();
  if (!normalizedMessage && !normalizedHelp && !(normalizedActionLabel && normalizedAction)) {
    return "";
  }

  const toneClass =
    tone === "error"
      ? "message-box--error"
      : tone === "success"
        ? "message-box--success"
        : "message-box--warning";
  const classes = ["message-box", toneClass, className].filter(Boolean).join(" ");

  return `
    <div class="${classes}">
      <p class="message-box__text">${escapeHtml(normalizedMessage)}</p>
      ${normalizedHelp ? `<p class="message-box__text">${escapeHtml(normalizedHelp)}</p>` : ""}
      ${
        normalizedActionLabel && normalizedAction
          ? `<div class="message-box__actions">${textAction(normalizedActionLabel, normalizedAction, { disabled: actionDisabled })}</div>`
          : ""
      }
    </div>
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
            <h1 class="page-header__title">${escapeHtml(title)}</h1>
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

export function createSearchField(config = "Search") {
  const options =
    typeof config === "string"
      ? { placeholder: config }
      : (config ?? {});
  const placeholder = options.placeholder ?? "Search";
  const value = options.value ?? "";
  const showIcon = options.showIcon !== false;
  const className = [
    "search-field",
    showIcon ? "" : "search-field--no-icon",
    typeof options.className === "string" ? options.className : "",
  ]
    .filter(Boolean)
    .join(" ");
  const inputAttributes = serializeAttributes(options.inputAttributes ?? {});
  const labelAttributes = serializeAttributes(options.labelAttributes ?? {});
  const endAdornment = typeof options.endAdornment === "string" ? options.endAdornment : "";

  return `
    <label class="${className}"${labelAttributes}>
      ${showIcon ? '<span class="search-field__icon">⌕</span>' : ""}
      <input type="text" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}"${inputAttributes} />
      ${endAdornment}
    </label>
  `;
}

export function renderSelectPillControl({
  label = "",
  value = "",
  className = "",
  tooltip = "",
  tooltipOptions = {},
  disabled = false,
  wrapperAttributes = {},
  selectAttributes = {},
  options = [],
}) {
  const classes = ["select-pill", "select-pill--control", className]
    .concat(disabled ? ["is-disabled"] : [])
    .filter(Boolean)
    .join(" ");
  const wrapperTooltip = tooltip
    ? tooltipAttributes(tooltip, tooltipOptions)
    : "";
  const wrapperProps = serializeAttributes({
    ...wrapperAttributes,
    "aria-disabled": disabled ? "true" : false,
  });
  const attributes = serializeAttributes({
    ...selectAttributes,
    disabled,
  });

  return `
    <label class="${classes}"${wrapperTooltip}${wrapperProps}>
      ${label ? `<span class="select-pill__label">${escapeHtml(label)}</span>` : ""}
      <span class="select-pill__value">${escapeHtml(value)}</span>
      ${renderChevronIcon("down", "select-pill__chevron")}
      <select${attributes}>
        ${options
          .map(
            (option) => `
              <option value="${escapeHtml(option?.value ?? "")}" ${option?.selected ? "selected" : ""}>${escapeHtml(option?.label ?? "")}</option>
            `,
          )
          .join("")}
      </select>
    </label>
  `;
}
