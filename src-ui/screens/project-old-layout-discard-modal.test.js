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

  assert.match(markup, /SERVER HAS NEW DATA FORMAT/);
  assert.match(markup, /Overwrite local changes/);
  assert.match(markup, /Discard my changes and continue/);
  assert.match(markup, /Meditation Chamber Books/);
});

test("old-layout discard modal is hidden when closed", () => {
  assert.equal(renderProjectOldLayoutDiscardModal({ projectOldLayoutDiscard: { isOpen: false } }), "");
});
