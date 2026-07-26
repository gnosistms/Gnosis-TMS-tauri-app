import assert from "node:assert/strict";
import test from "node:test";

import {
  createLoadingSpinnerContinuity,
  loadingSpinnerPhaseDelay,
  registerLoadingSpinnerContinuity,
} from "./loading-spinner-continuity.js";
import {
  loadingButton as renderLoadingButton,
  loadingPrimaryButton,
  loadingSpinnerKeyAttribute,
  setImmediateLoadingButton,
} from "../lib/ui.js";

function loadingButton(key, options = {}) {
  const button = {
    className: "button button--primary button--loading",
    textContent: options.label ?? "Transferring...",
    getAttribute: (name) => {
      if (name === "data-loading-spinner-key") {
        return key;
      }
      return name === "data-action" ? options.action ?? "noop" : null;
    },
  };
  const spinner = {
    nodeType: 1,
    className: "button__spinner",
    dataset: {},
    parentElement: button,
    style: {},
    matches: (selector) => selector === ".button__spinner",
    querySelectorAll: () => [],
    closest: (selector) => {
      if (selector === "[data-loading-spinner-key]") {
        return key ? button : null;
      }
      return selector === "button" ? button : null;
    },
  };
  return {
    spinner,
  };
}

function rootWith(...buttons) {
  return {
    nodeType: 1,
    matches: () => false,
    querySelectorAll: () => buttons.map((button) => button.spinner),
  };
}

function spinnerSubtree(...buttons) {
  return rootWith(...buttons);
}

test("spinner phase delay follows the supplied CSS animation duration", () => {
  assert.equal(loadingSpinnerPhaseDelay(100, 100, 700), 0);
  assert.equal(loadingSpinnerPhaseDelay(100, 450, 700), -350);
  assert.equal(loadingSpinnerPhaseDelay(100, 900, 700), -100);
  assert.equal(loadingSpinnerPhaseDelay(100, 450, 0), 0);
});

test("continuity reads the active animation duration from CSS", () => {
  const originalGetComputedStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ animationDuration: "0.9s" });
  try {
    let currentTime = 100;
    const continuity = createLoadingSpinnerContinuity({
      now: () => currentTime,
    });
    const first = loadingButton("submit-project-transfer");
    continuity.mountSubtree(spinnerSubtree(first));

    currentTime = 1150;
    const replacement = loadingButton("submit-project-transfer");
    continuity.mountSubtree(spinnerSubtree(replacement));
    continuity.unmountSubtree(spinnerSubtree(first));
    assert.equal(replacement.spinner.style.animationDelay, "-150ms");
  } finally {
    if (originalGetComputedStyle) {
      globalThis.getComputedStyle = originalGetComputedStyle;
    } else {
      delete globalThis.getComputedStyle;
    }
  }
});

test("replacement loading buttons continue the original spinner phase", () => {
  let currentTime = 100;
  const continuity = createLoadingSpinnerContinuity({
    now: () => currentTime,
    getAnimationDuration: () => 700,
  });
  const first = loadingButton("submit-project-transfer");
  continuity.mountSubtree(spinnerSubtree(first));
  assert.equal(first.spinner.style.animationDelay, "0ms");

  currentTime = 450;
  const replacement = loadingButton("submit-project-transfer");
  continuity.mountSubtree(spinnerSubtree(replacement));
  continuity.unmountSubtree(spinnerSubtree(first));
  assert.equal(replacement.spinner.style.animationDelay, "-350ms");

  currentTime = 600;
  continuity.mountSubtree(spinnerSubtree(replacement));
  assert.equal(replacement.spinner.style.animationDelay, "-350ms");
});

test("a loading key starts fresh after it is no longer mounted", () => {
  let currentTime = 100;
  const continuity = createLoadingSpinnerContinuity({
    now: () => currentTime,
    getAnimationDuration: () => 700,
  });
  const first = loadingButton("submit-project-transfer");
  continuity.mountSubtree(spinnerSubtree(first));

  currentTime = 300;
  continuity.unmountSubtree(spinnerSubtree(first));

  currentTime = 500;
  const nextOperation = loadingButton("submit-project-transfer");
  continuity.mountSubtree(spinnerSubtree(nextOperation));
  assert.equal(nextOperation.spinner.style.animationDelay, "0ms");
});

test("unkeyed spinners are left alone instead of receiving unstable fallback identities", () => {
  const continuity = createLoadingSpinnerContinuity({
    now: () => 100,
    getAnimationDuration: () => 700,
  });
  const unkeyed = loadingButton("", { label: "Discarding..." });
  continuity.mountSubtree(spinnerSubtree(unkeyed));
  assert.equal(unkeyed.spinner.style.animationDelay, undefined);
});

test("observer processes only changed subtrees and preserves batched replacements", () => {
  let currentTime = 100;
  let observerCallback = null;
  let rootScanCount = 0;
  class FakeMutationObserver {
    constructor(callback) {
      observerCallback = callback;
    }
    observe() {}
    disconnect() {}
  }
  const root = {
    nodeType: 1,
    matches: () => false,
    querySelectorAll() {
      rootScanCount += 1;
      return [];
    },
  };
  registerLoadingSpinnerContinuity(root, {
    now: () => currentTime,
    getAnimationDuration: () => 700,
    MutationObserver: FakeMutationObserver,
  });

  const first = loadingButton("submit-project-transfer");
  observerCallback([{
    addedNodes: [spinnerSubtree(first)],
    removedNodes: [],
  }]);
  assert.equal(first.spinner.style.animationDelay, "0ms");

  currentTime = 450;
  const replacement = loadingButton("submit-project-transfer");
  observerCallback([{
    addedNodes: [spinnerSubtree(replacement)],
    removedNodes: [spinnerSubtree(first)],
  }]);
  assert.equal(replacement.spinner.style.animationDelay, "-350ms");
  assert.equal(rootScanCount, 1);
});

test("shared loading button helpers expose a stable spinner key", () => {
  const html = loadingPrimaryButton({
    label: "Transfer project",
    loadingLabel: "Transferring...",
    action: "submit-project-transfer",
    isLoading: true,
  });
  assert.match(html, /data-loading-spinner-key="submit-project-transfer"/);

  const attributes = new Map();
  const button = {
    dataset: { action: "submit-project-transfer" },
    classList: { add() {} },
    disabled: false,
    innerHTML: "",
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
  setImmediateLoadingButton(button, "Transferring...");
  assert.equal(button.dataset.loadingSpinnerKey, "submit-project-transfer");
  assert.equal(attributes.get("aria-busy"), "true");
});

test("shared loading button renderer supports standard variants and safe classes", () => {
  for (const variant of ["primary", "secondary", "error"]) {
    const html = renderLoadingButton({
      label: "Start",
      loadingLabel: "Working...",
      action: `start-${variant}`,
      isLoading: true,
      variant,
      compact: variant === "secondary",
      className: variant === "error" ? 'custom"button' : "",
    });
    assert.match(html, new RegExp(`button--${variant}`));
    assert.match(html, /button--loading/);
    assert.match(html, /data-action="noop"/);
    assert.match(html, new RegExp(`data-loading-spinner-key="start-${variant}"`));
    assert.match(html, /disabled aria-busy="true"/);
  }

  const secondary = renderLoadingButton({
    label: "Reconnect",
    loadingLabel: "Reconnect",
    action: "reconnect",
    isLoading: true,
    variant: "secondary",
    compact: true,
  });
  assert.match(secondary, /button--compact/);

  const escapedClass = renderLoadingButton({
    label: "Overwrite",
    loadingLabel: "Overwriting...",
    action: "overwrite",
    isLoading: true,
    variant: "error",
    className: 'custom"button',
  });
  assert.match(escapedClass, /custom&quot;button/);
});

test("idle shared loading buttons retain their action without loading attributes", () => {
  const html = renderLoadingButton({
    label: "Reconnect",
    loadingLabel: "Reconnect",
    action: "reconnect",
    isLoading: false,
    variant: "secondary",
  });
  assert.match(html, /data-action="reconnect"/);
  assert.doesNotMatch(html, /data-loading-spinner-key/);
  assert.doesNotMatch(html, /aria-busy/);
  assert.doesNotMatch(html, /button__spinner/);
});

test("spinner key attributes omit blank keys and escape operation identifiers", () => {
  assert.equal(loadingSpinnerKeyAttribute(""), "");
  assert.equal(
    loadingSpinnerKeyAttribute('review:"meaning"'),
    ' data-loading-spinner-key="review:&quot;meaning&quot;"',
  );
});
