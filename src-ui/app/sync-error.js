const AUTH_REQUIRED_PREFIX = "AUTH_REQUIRED:";

const CONNECTION_PATTERNS = [
  "failed to fetch",
  "fetch failed",
  "error sending request",
  "sending request for url",
  "networkerror",
  "network error",
  "could not reach",
  "dns error",
  "client error (connect)",
  "tcp connect error",
  "load failed",
  "could not connect",
  "connection refused",
  "connection reset",
  "connection closed",
  "timed out",
  "timeout",
  "offline",
];

export function classifySyncError(error, context = {}) {
  const message = (error?.message ?? String(error ?? "")).trim();
  const normalized = message.toLowerCase();
  const status = Number(error?.status ?? context.status ?? NaN);

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

  if (status === 403 || status === 404) {
    return { type: "resource_access_lost", message, status };
  }

  if (status >= 500 && status < 600) {
    return { type: "server_temporary", message, status };
  }

  return { type: "unknown", message, status };
}

function classifyConnectionSource(message, normalized) {
  if (normalized.includes("could not reach the github app broker")) {
    return "broker";
  }

  if (normalized.includes("fetch failed")) {
    return "github";
  }

  if (normalized.includes("github api")) {
    return "github";
  }

  if (normalized.includes("offline")) {
    return "internet";
  }

  return "unknown";
}
