const AUTH_REQUIRED_PREFIX = "AUTH_REQUIRED:";
const APP_UPDATE_REQUIRED_PREFIX = "APP_UPDATE_REQUIRED:";

const CONNECTION_PATTERNS = [
  "failed to fetch",
  "fetch failed",
  "failed to connect",
  "error sending request",
  "sending request for url",
  "networkerror",
  "network error",
  "network is unreachable",
  "could not reach",
  "could not resolve host",
  "dns error",
  "name or service not known",
  "temporary failure in name resolution",
  "client error (connect)",
  "tcp connect error",
  "load failed",
  "could not connect",
  "connection refused",
  "connection reset",
  "connection closed",
  "connection timed out",
  "operation timed out",
  "ssl connect error",
  "timed out",
  "timeout",
  "offline",
];

const RESOURCE_ACCESS_LOST_PATTERNS = [
  "you no longer have access to this team",
  "no longer have access to this team",
  "team access was removed",
  "membership in this team was removed",
  "not a member of this organization",
  "not a member of this team",
  "resource access lost",
];

export function classifySyncError(error, context = {}) {
  const message = (error?.message ?? String(error ?? "")).trim();
  const normalized = message.toLowerCase();
  const status = Number(error?.status ?? context.status ?? NaN);

  if (message.startsWith(APP_UPDATE_REQUIRED_PREFIX)) {
    return { type: "app_update_required", message, status };
  }

  if (
    message.startsWith(AUTH_REQUIRED_PREFIX) ||
    message === "Unauthorized" ||
    normalized.includes("your github session expired") ||
    normalized.includes("bad credentials") ||
    status === 401
  ) {
    return { type: "auth_invalid", message, status };
  }

  if (CONNECTION_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return {
      type: "connection_unavailable",
      source: classifyConnectionSource(message, normalized),
      message,
      status,
    };
  }

  if (
    (status === 403 || status === 404)
    && RESOURCE_ACCESS_LOST_PATTERNS.some((pattern) => normalized.includes(pattern))
  ) {
    return { type: "resource_access_lost", message, status };
  }

  if (isTemporaryRemoteOutage(status, normalized)) {
    return {
      type: "connection_unavailable",
      source: classifyConnectionSource(message, normalized),
      message,
      status,
    };
  }

  if (status >= 500 && status < 600) {
    return { type: "server_temporary", message, status };
  }

  return { type: "unknown", message, status };
}

function classifyConnectionSource(message, normalized) {
  if (
    normalized.includes("github app broker")
    || normalized.includes("gnosis tms server")
    || normalized.includes("gnosis-github-app-broker-8bfus.ondigitalocean.app")
  ) {
    return "broker";
  }

  if (
    normalized.includes("github.com")
    || normalized.includes("github api")
    || normalized.includes("git fetch")
    || normalized.includes("git pull")
    || normalized.includes("git push")
    || normalized.includes("raw.githubusercontent.com")
  ) {
    return "github";
  }

  if (
    normalized.includes("offline")
    || normalized.includes("dns error")
    || normalized.includes("network is unreachable")
    || normalized.includes("could not resolve host")
    || normalized.includes("name or service not known")
    || normalized.includes("temporary failure in name resolution")
  ) {
    return "internet";
  }

  return "unknown";
}

function isTemporaryRemoteOutage(status, normalized) {
  if (status === 502 || status === 503 || status === 504) {
    return true;
  }

  return status === 500 && normalized.includes("github app broker");
}
