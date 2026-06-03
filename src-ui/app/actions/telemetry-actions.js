import {
  openTelemetryDisclosureSettings,
  saveTelemetryDisclosureSettings,
} from "../telemetry-disclosure-flow.js";

export function createTelemetryActions(render) {
  return {
    "open-error-reporting-settings": () => {
      openTelemetryDisclosureSettings(render);
    },
    "save-error-reporting-settings": async () => {
      await saveTelemetryDisclosureSettings(render);
    },
  };
}
