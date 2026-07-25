import test from "node:test";
import assert from "node:assert/strict";

import { renderEditorCloseWaitModal } from "./editor-close-wait-modal.js";

function stateWithCloseWait(closeWait) {
  return { editorCloseWait: closeWait };
}

test("renders nothing while the close wait is not open", () => {
  assert.equal(renderEditorCloseWaitModal(stateWithCloseWait({ isOpen: false })), "");
  assert.equal(renderEditorCloseWaitModal(stateWithCloseWait(null)), "");
});

test("renders the pending count, progress, and both actions", () => {
  const markup = renderEditorCloseWaitModal(
    stateWithCloseWait({ isOpen: true, pendingCount: 3, initialCount: 4 }),
  );

  assert.match(markup, /Saving changes before closing/);
  assert.match(markup, /3 changes left to save\.\.\./);
  assert.match(markup, /aria-valuemax="4"/);
  assert.match(markup, /aria-valuenow="1"/);
  assert.match(markup, /width: 25%/);
  assert.match(markup, /data-action="editor-close-wait-keep-open"/);
  assert.match(markup, /data-action="editor-close-wait-force-close"/);
});

test("uses singular wording for a single pending change", () => {
  const markup = renderEditorCloseWaitModal(
    stateWithCloseWait({ isOpen: true, pendingCount: 1, initialCount: 2 }),
  );

  assert.match(markup, /1 change left to save\.\.\./);
});

test("a zero pending count shows the finishing message instead of a count", () => {
  const markup = renderEditorCloseWaitModal(
    stateWithCloseWait({ isOpen: true, pendingCount: 0, initialCount: 2 }),
  );

  assert.match(markup, /Finishing the last save\.\.\./);
  assert.match(markup, /width: 100%/);
});

test("a pending count above the initial count never renders negative progress", () => {
  const markup = renderEditorCloseWaitModal(
    stateWithCloseWait({ isOpen: true, pendingCount: 5, initialCount: 2 }),
  );

  assert.match(markup, /aria-valuemax="5"/);
  assert.match(markup, /aria-valuenow="0"/);
  assert.match(markup, /width: 0%/);
});
