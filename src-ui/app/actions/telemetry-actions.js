import {
  allowTelemetryReports,
  denyTelemetryReports,
} from "../telemetry-disclosure-flow.js";

export function createTelemetryActions(render) {
  return {
    "allow-error-reports": async () => {
      await allowTelemetryReports(render);
    },
    "deny-error-reports": () => {
      denyTelemetryReports(render);
    },
  };
}
