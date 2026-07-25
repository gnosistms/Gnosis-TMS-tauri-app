const LOADING_BUTTON_SELECTOR = "[data-loading-spinner-key]";
const SPINNER_SELECTOR = ".button__spinner";

function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function defaultAnimationDuration(spinner) {
  const duration = globalThis.getComputedStyle?.(spinner)?.animationDuration ?? "";
  const firstDuration = duration.split(",")[0]?.trim() ?? "";
  if (firstDuration.endsWith("ms")) {
    return Number.parseFloat(firstDuration);
  }
  if (firstDuration.endsWith("s")) {
    return Number.parseFloat(firstDuration) * 1000;
  }
  return 0;
}

export function loadingSpinnerPhaseDelay(startedAt, currentTime, durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 0;
  }
  const elapsed = Math.max(0, currentTime - startedAt);
  const phase = elapsed % durationMs;
  return phase === 0 ? 0 : -phase;
}

function spinnerContinuityKey(spinner) {
  const explicitHost = spinner.closest?.(LOADING_BUTTON_SELECTOR);
  const explicitKey = String(
    explicitHost?.getAttribute?.("data-loading-spinner-key") ?? "",
  ).trim();
  if (explicitKey) {
    return `explicit:${explicitKey}`;
  }
  return "";
}

function spinnersInSubtree(node) {
  if (!node || node.nodeType !== 1) {
    return [];
  }
  const descendants = Array.from(node.querySelectorAll?.(SPINNER_SELECTOR) ?? []);
  return node.matches?.(SPINNER_SELECTOR) ? [node, ...descendants] : descendants;
}

export function createLoadingSpinnerContinuity(options = {}) {
  const now = options.now ?? defaultNow;
  const getAnimationDuration =
    options.getAnimationDuration ?? defaultAnimationDuration;
  const startsByKey = new Map();
  const mountedCountByKey = new Map();
  const keyBySpinner = new WeakMap();

  function mountSubtree(node) {
    const currentTime = now();
    for (const spinner of spinnersInSubtree(node)) {
      if (keyBySpinner.has(spinner)) {
        continue;
      }
      const key = spinnerContinuityKey(spinner);
      if (!key) {
        continue;
      }
      const mountedCount = mountedCountByKey.get(key) ?? 0;
      if (mountedCount === 0) {
        startsByKey.set(key, currentTime);
      }
      mountedCountByKey.set(key, mountedCount + 1);
      keyBySpinner.set(spinner, key);
      const delay = loadingSpinnerPhaseDelay(
        startsByKey.get(key),
        currentTime,
        getAnimationDuration(spinner),
      );
      spinner.style.animationDelay = `${delay}ms`;
    }
  }

  function unmountSubtree(node) {
    for (const spinner of spinnersInSubtree(node)) {
      const key = keyBySpinner.get(spinner);
      if (!key) {
        continue;
      }
      keyBySpinner.delete(spinner);
      const mountedCount = (mountedCountByKey.get(key) ?? 1) - 1;
      if (mountedCount <= 0) {
        mountedCountByKey.delete(key);
        startsByKey.delete(key);
      } else {
        mountedCountByKey.set(key, mountedCount);
      }
    }
  }

  return { mountSubtree, unmountSubtree };
}

export function registerLoadingSpinnerContinuity(root, options = {}) {
  const continuity = createLoadingSpinnerContinuity(options);
  const Observer = options.MutationObserver ?? globalThis.MutationObserver;
  continuity.mountSubtree(root);
  if (typeof Observer !== "function") {
    return () => {};
  }

  const observer = new Observer((mutations) => {
    // Mount replacements before unmounting their predecessors so a key keeps its
    // original phase across a single DOM replacement batch.
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes ?? []) {
        continuity.mountSubtree(node);
      }
    }
    for (const mutation of mutations) {
      for (const node of mutation.removedNodes ?? []) {
        continuity.unmountSubtree(node);
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
