const DEFAULT_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const DEFAULT_SCROLL_BEHAVIOR = "smooth";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function stripDiacritics(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeIndexKey(value, options = {}) {
  const alphabet = asArray(options.alphabet).length > 0
    ? options.alphabet.map((letter) => String(letter).toUpperCase())
    : DEFAULT_ALPHABET;
  const text = stripDiacritics(normalizeText(value));
  const first = [...text][0]?.toUpperCase() ?? "";
  if (!first) {
    return options.fallbackKey ?? "#";
  }
  if (alphabet.includes(first)) {
    return first;
  }
  if (/\d/.test(first)) {
    return options.numberKey ?? "#";
  }
  return options.fallbackKey ?? "#";
}

export function collectIndexSections(items, options = {}) {
  const alphabet = asArray(options.alphabet).length > 0
    ? options.alphabet.map((letter) => String(letter).toUpperCase())
    : DEFAULT_ALPHABET;
  const getLabel = typeof options.getLabel === "function"
    ? options.getLabel
    : (item) => item?.label ?? item?.textContent ?? "";
  const getTarget = typeof options.getTarget === "function"
    ? options.getTarget
    : (item) => item?.target ?? item;
  const getKey = typeof options.getKey === "function"
    ? options.getKey
    : (item) => normalizeIndexKey(getLabel(item), options);
  const includeMissing = options.includeMissing === true;
  const sectionsByKey = new Map();

  for (const item of asArray(items)) {
    const rawKey = normalizeText(getKey(item));
    if (!rawKey) {
      continue;
    }
    const key = rawKey.toUpperCase();
    if (!sectionsByKey.has(key)) {
      sectionsByKey.set(key, {
        key,
        label: key,
        target: getTarget(item),
        items: [],
        disabled: false,
      });
    }
    sectionsByKey.get(key).items.push(item);
  }

  const orderedKeys = [
    ...alphabet,
    ...[...sectionsByKey.keys()]
      .filter((key) => !alphabet.includes(key))
      .sort((left, right) => left.localeCompare(right)),
  ];

  return orderedKeys
    .map((key) => {
      const section = sectionsByKey.get(key);
      if (section) {
        return section;
      }
      return includeMissing
        ? {
            key,
            label: key,
            target: null,
            items: [],
            disabled: true,
          }
        : null;
    })
    .filter(Boolean);
}

export function selectIndexKeys(sections, options = {}) {
  const enabled = asArray(sections).filter((section) => section && section.disabled !== true);
  const maxItems = Number(options.maxItems);
  if (!Number.isFinite(maxItems) || maxItems <= 0 || enabled.length <= maxItems) {
    return enabled.map((section) => section.key);
  }

  const lastIndex = enabled.length - 1;
  const step = lastIndex / Math.max(1, maxItems - 1);
  const keys = new Set();
  for (let index = 0; index < maxItems; index += 1) {
    keys.add(enabled[Math.round(index * step)]?.key);
  }
  return [...keys].filter(Boolean);
}

function resolveSections(config) {
  if (Array.isArray(config.sections)) {
    return collectIndexSections(config.sections, {
      ...config,
      getLabel: (section) => section.label ?? section.key,
      getTarget: (section) => section.target,
      getKey: (section) => section.key,
    });
  }

  const items = [...config.scrollContainer.querySelectorAll(config.itemSelector ?? "[data-index-label]")];
  return collectIndexSections(items, {
    ...config,
    getLabel: config.getLabel ?? ((element) => element.dataset.indexLabel ?? element.textContent),
    getTarget: config.getTarget ?? ((element) => element),
  });
}

function scrollTargetIntoContainer(scrollContainer, target, options) {
  if (!target) {
    return;
  }
  const containerRect = scrollContainer.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const offset = Number(options.offset) || 0;
  const top = scrollContainer.scrollTop + targetRect.top - containerRect.top - offset;
  scrollContainer.scrollTo({
    top: Math.max(0, top),
    behavior: options.behavior ?? DEFAULT_SCROLL_BEHAVIOR,
  });
}

function showOverlay(host, key, options, state) {
  if (options.showOverlay === false) {
    return;
  }
  if (!state.overlay) {
    state.overlay = document.createElement("div");
    state.overlay.className = "ais-index__overlay";
    state.overlay.setAttribute("aria-hidden", "true");
    host.append(state.overlay);
  }

  state.overlay.textContent = key;
  state.overlay.classList.add("is-visible");
  clearTimeout(state.overlayTimer);
  state.overlayTimer = setTimeout(() => {
    state.overlay?.classList.remove("is-visible");
  }, options.overlayDuration ?? 450);
}

function buttonForPoint(x, y, nav) {
  const element = document.elementFromPoint(x, y);
  const button = element?.closest?.("[data-ais-index-key]");
  return button && nav.contains(button) ? button : null;
}

export function createAlphabetIndexScroll(config) {
  if (!config?.scrollContainer) {
    throw new Error("createAlphabetIndexScroll requires a scrollContainer element.");
  }

  const scrollContainer = config.scrollContainer;
  const host = config.indexHost ?? scrollContainer.parentElement ?? scrollContainer;
  const state = {
    sections: [],
    nav: null,
    overlay: null,
    overlayTimer: null,
    activePointerId: null,
  };

  host.classList.add("ais-host");
  scrollContainer.classList.add("ais-scroll-container");

  function scrollToKey(key) {
    const section = state.sections.find((candidate) => candidate.key === key && candidate.disabled !== true);
    if (!section) {
      return false;
    }
    scrollTargetIntoContainer(scrollContainer, section.target, config);
    showOverlay(host, section.label ?? section.key, config, state);
    config.onSelect?.(section);
    return true;
  }

  function handleIndexButton(button) {
    if (!button || button.disabled) {
      return;
    }
    scrollToKey(button.dataset.aisIndexKey);
  }

  function render() {
    state.nav?.remove();
    state.sections = resolveSections(config);
    const visibleKeys = new Set(selectIndexKeys(state.sections, { maxItems: config.maxItems }));
    const visibleSections = state.sections.filter((section) =>
      config.includeMissing === true || visibleKeys.has(section.key),
    );

    const nav = document.createElement("nav");
    nav.className = `ais-index ${config.className ?? ""}`.trim();
    nav.setAttribute("aria-label", config.ariaLabel ?? "Alphabetical jump navigation");

    for (const section of visibleSections) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ais-index__button";
      button.dataset.aisIndexKey = section.key;
      button.textContent = section.label ?? section.key;
      button.disabled = section.disabled === true;
      button.setAttribute("aria-label", `Jump to ${section.label ?? section.key}`);
      nav.append(button);
    }

    nav.addEventListener("click", (event) => {
      handleIndexButton(event.target.closest("[data-ais-index-key]"));
    });
    nav.addEventListener("pointerdown", (event) => {
      state.activePointerId = event.pointerId;
      nav.setPointerCapture?.(event.pointerId);
      handleIndexButton(buttonForPoint(event.clientX, event.clientY, nav));
    });
    nav.addEventListener("pointermove", (event) => {
      if (state.activePointerId !== event.pointerId) {
        return;
      }
      event.preventDefault();
      handleIndexButton(buttonForPoint(event.clientX, event.clientY, nav));
    });
    nav.addEventListener("pointerup", () => {
      state.activePointerId = null;
    });
    nav.addEventListener("pointercancel", () => {
      state.activePointerId = null;
    });

    host.append(nav);
    state.nav = nav;
    return state.sections;
  }

  render();

  return {
    update: render,
    destroy() {
      clearTimeout(state.overlayTimer);
      state.nav?.remove();
      state.overlay?.remove();
      scrollContainer.classList.remove("ais-scroll-container");
    },
    scrollToKey,
    get sections() {
      return [...state.sections];
    },
  };
}
