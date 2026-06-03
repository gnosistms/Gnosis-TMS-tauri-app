import test from "node:test";
import assert from "node:assert/strict";

import { renderTelemetryDisclosureModal } from "./telemetry-disclosure-modal.js";

test("telemetry disclosure modal renders requested copy and actions", () => {
  const html = renderTelemetryDisclosureModal({
    telemetryDisclosureModal: { isOpen: true, enabled: true },
  });

  assert.match(html, /Error logging/);
  assert.match(html, /Send error reports to Gnosis TMS developers/);
  assert.match(
    html,
    /If your app has errors, the development team would like to know so they can fix them\./,
  );
  assert.match(html, /data-telemetry-disclosure-enabled-toggle/);
  assert.match(html, /Send error reports/);
  assert.match(html, /checked/);
  assert.match(html, /data-action="save-error-reporting-settings"/);
  assert.match(html, />Save</);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
});

test("telemetry disclosure switch reflects disabled draft state", () => {
  const html = renderTelemetryDisclosureModal({
    telemetryDisclosureModal: { isOpen: true, enabled: false },
  });

  assert.match(html, /data-telemetry-disclosure-enabled-toggle/);
  assert.doesNotMatch(html, /checked/);
});

test("telemetry disclosure modal does not render when closed", () => {
  assert.equal(
    renderTelemetryDisclosureModal({
      telemetryDisclosureModal: { isOpen: false },
    }),
    "",
  );
});
