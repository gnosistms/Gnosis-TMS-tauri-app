import test from "node:test";
import assert from "node:assert/strict";

import { renderAppUpdateModal } from "./app-update-modal.js";

test("app update modal renders install failures as modal errors", () => {
  const html = renderAppUpdateModal({
    appUpdate: {
      status: "installError",
      error: "No update is ready to install.",
      message: "A newer version is required.",
      available: true,
      required: true,
      version: "0.3.1",
      currentVersion: "0.3.0",
      promptVisible: true,
    },
  });

  assert.match(html, /Update required/);
  assert.match(html, /class="modal__error" role="alert"/);
  assert.match(html, /No update is ready to install\./);
  assert.match(html, /data-action="install-app-update"/);
});
