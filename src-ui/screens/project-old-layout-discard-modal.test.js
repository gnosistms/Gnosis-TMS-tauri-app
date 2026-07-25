import test from "node:test";
import assert from "node:assert/strict";

import { renderProjectOldLayoutDiscardModal } from "./project-old-layout-discard-modal.js";

test("renders remote migrated old-layout discard confirmation modal", () => {
  const markup = renderProjectOldLayoutDiscardModal({
    projectOldLayoutDiscard: {
      isOpen: true,
      resourceName: "Meditation Chamber Books",
      status: "idle",
      error: "",
    },
  });

  assert.match(markup, /SYNC UPDATE/);
  assert.match(markup, /Overwrite local changes/);
  assert.match(markup, /A newer version of this project is available online/);
  assert.match(markup, /Discard my changes and continue/);
  assert.match(markup, /Meditation Chamber Books/);
});

test("old-layout discard modal is hidden when closed", () => {
  assert.equal(renderProjectOldLayoutDiscardModal({ projectOldLayoutDiscard: { isOpen: false } }), "");
});

test("project old-layout discard loading state uses a keyed destructive button", () => {
  const markup = renderProjectOldLayoutDiscardModal({
    projectOldLayoutDiscard: {
      isOpen: true,
      resourceName: "Meditation Chamber Books",
      status: "loading",
      error: "",
    },
  });

  assert.match(markup, /button--error button--loading/);
  assert.match(markup, /data-action="noop"/);
  assert.match(markup, /data-loading-spinner-key="confirm-project-old-layout-discard"/);
  assert.match(markup, /disabled aria-busy="true"/);
  assert.match(markup, /data-action="close-project-old-layout-discard"[^>]*disabled/);
});

test("project old-layout discard error state restores the real action", () => {
  const markup = renderProjectOldLayoutDiscardModal({
    projectOldLayoutDiscard: {
      isOpen: true,
      resourceName: "Meditation Chamber Books",
      status: "idle",
      error: "Could not discard local changes.",
    },
  });

  assert.match(markup, /data-action="confirm-project-old-layout-discard"/);
  assert.match(markup, /Could not discard local changes/);
  assert.doesNotMatch(markup, /data-loading-spinner-key/);
});
