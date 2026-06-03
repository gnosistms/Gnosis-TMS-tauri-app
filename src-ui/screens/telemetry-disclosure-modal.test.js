import test from "node:test";
import assert from "node:assert/strict";

import { renderTelemetryDisclosureModal } from "./telemetry-disclosure-modal.js";

test("telemetry disclosure modal renders requested copy and actions", () => {
  const html = renderTelemetryDisclosureModal({
    telemetryDisclosureModal: { isOpen: true },
  });

  assert.match(html, /Error logging/);
  assert.match(html, /Send error reports to Gnosis TMS developers/);
  assert.match(
    html,
    /If your app has errors, the development team would like to know so they can fix them\. To allow sending error reports, click Allow error reports\./,
  );
  assert.match(html, /data-action="deny-error-reports"/);
  assert.match(html, /Don&#39;t allow/);
  assert.match(html, /data-action="allow-error-reports"/);
  assert.match(html, /Allow error reports/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
});

test("telemetry disclosure modal does not render when closed", () => {
  assert.equal(
    renderTelemetryDisclosureModal({
      telemetryDisclosureModal: { isOpen: false },
    }),
    "",
  );
});
