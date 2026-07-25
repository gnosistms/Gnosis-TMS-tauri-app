import assert from "node:assert/strict";
import test from "node:test";

import { renderRepoOldLayoutDiscardModal } from "./repo-old-layout-discard-modal.js";

const resources = [
  {
    label: "Glossary",
    closeAction: "close-glossary-old-layout-discard",
    confirmAction: "confirm-glossary-old-layout-discard",
  },
  {
    label: "QA list",
    closeAction: "close-qa-list-old-layout-discard",
    confirmAction: "confirm-qa-list-old-layout-discard",
  },
];

for (const resource of resources) {
  test(`${resource.label} old-layout discard preserves its keyed destructive action`, () => {
    const loadingHtml = renderRepoOldLayoutDiscardModal({
      modal: {
        isOpen: true,
        resourceName: `${resource.label} fixture`,
        status: "loading",
        error: "",
      },
      resourceLabel: resource.label,
      closeAction: resource.closeAction,
      confirmAction: resource.confirmAction,
    });
    assert.match(loadingHtml, new RegExp(`data-loading-spinner-key="${resource.confirmAction}"`));
    assert.match(loadingHtml, /button--error button--loading/);
    assert.match(loadingHtml, /data-action="noop"/);
    assert.match(loadingHtml, /disabled aria-busy="true"/);
    assert.match(loadingHtml, new RegExp(`data-action="${resource.closeAction}"[^>]*disabled`));
    assert.match(loadingHtml, new RegExp(`${resource.label} fixture`));

    const errorHtml = renderRepoOldLayoutDiscardModal({
      modal: {
        isOpen: true,
        resourceName: `${resource.label} fixture`,
        status: "idle",
        error: "Discard failed.",
      },
      resourceLabel: resource.label,
      closeAction: resource.closeAction,
      confirmAction: resource.confirmAction,
    });
    assert.match(errorHtml, new RegExp(`data-action="${resource.confirmAction}"`));
    assert.match(errorHtml, /Discard failed\./);
    assert.doesNotMatch(errorHtml, /data-loading-spinner-key/);
  });
}
