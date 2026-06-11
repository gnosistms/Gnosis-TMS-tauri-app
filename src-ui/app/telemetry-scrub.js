// Scrubbing for telemetry payloads. Pure and dependency-free so it can be unit-tested
// without loading the Sentry SDK or any browser globals.
//
// These are hard privacy constraints (see plans/telemetry-plan.md): never transmit
// secrets, tokens, document/translation content, GitHub identity, or filesystem paths
// that contain the OS username. This module is the last line of defense before an event
// leaves the process, regardless of where the data originated.

// Object keys whose values are dropped entirely (case-insensitive, substring match).
const SENSITIVE_KEY_PATTERNS = [
  "token",
  "secret",
  "password",
  "passphrase",
  "apikey",
  "api_key",
  "authorization",
  "auth",
  "credential",
  "privatekey",
  "private_key",
  "keypair",
  "cookie",
  "session",
  "dsn",
];

const REDACTED = "<redacted>";
const MAX_STRING_LENGTH = 2048;
// Mirrors the broker.rs free-text truncation discipline for short command-error bodies.
export const COMMAND_ERROR_MAX_LENGTH = 200;
const MAX_DEPTH = 6;

// Patterns for secret-looking substrings that can appear inside free-text error messages.
const SECRET_VALUE_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, // GitHub tokens
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, // Anthropic keys
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // OpenAI-style keys
  /\bAIza[A-Za-z0-9_-]{30,}\b/g, // Google API keys (Gemini)
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, // JWTs
  /\b[Bb]earer\s+[A-Za-z0-9._-]{12,}/g, // Bearer tokens
];

// Home-directory prefixes → replace only the username segment, keep the structure so a
// path is still diagnostic ("/Users/<user>/…", "C:\Users\<user>\…").
const HOME_DIR_PATTERNS = [
  { re: /(\/(?:Users|home)\/)[^/\\]+/g, replace: "$1<user>" },
  { re: /([A-Za-z]:\\Users\\)[^\\]+/g, replace: "$1<user>" },
];

function isSensitiveKey(key) {
  if (typeof key !== "string") {
    return false;
  }
  const normalized = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));
}

/**
 * Redact secrets and home-directory usernames from a free-text string and bound its
 * length. `maxLength` defaults to a generous cap so stack traces stay useful; pass
 * `COMMAND_ERROR_MAX_LENGTH` for short bodies.
 */
export function scrubString(value, maxLength = MAX_STRING_LENGTH) {
  if (typeof value !== "string") {
    return value;
  }

  let scrubbed = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, REDACTED);
  }
  for (const { re, replace } of HOME_DIR_PATTERNS) {
    scrubbed = scrubbed.replace(re, replace);
  }

  if (scrubbed.length > maxLength) {
    // Keep head + tail: in long messages (git stderr after an HTML body, wrapped
    // errors) the actual failure reason often sits at the end, and head-only
    // truncation used to cut it off before it reached Sentry.
    const tailLength = Math.floor(maxLength / 4);
    const headLength = maxLength - tailLength;
    scrubbed = `${scrubbed.slice(0, headLength)}…${scrubbed.slice(scrubbed.length - tailLength)}`;
  }
  return scrubbed;
}

/**
 * Deep-clone arbitrary data, dropping sensitive keys and scrubbing string values.
 * Bounded in depth to avoid pathological structures.
 */
export function scrubData(value, depth = 0) {
  if (depth > MAX_DEPTH) {
    return "<truncated>";
  }

  if (typeof value === "string") {
    return scrubString(value);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubData(item, depth + 1));
  }

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED;
      continue;
    }
    result[key] = scrubData(item, depth + 1);
  }
  return result;
}

function scrubStacktrace(stacktrace) {
  if (!stacktrace || !Array.isArray(stacktrace.frames)) {
    return stacktrace;
  }
  return {
    ...stacktrace,
    frames: stacktrace.frames.map((frame) => {
      if (!frame || typeof frame !== "object") {
        return frame;
      }
      const next = { ...frame };
      if (typeof next.filename === "string") {
        next.filename = scrubString(next.filename);
      }
      if (typeof next.abs_path === "string") {
        next.abs_path = scrubString(next.abs_path);
      }
      // Local variables are never needed and can carry content/secrets.
      delete next.vars;
      return next;
    }),
  };
}

/**
 * Sentry `beforeSend` hook. Strips identity/host/request data, scrubs messages,
 * exception values, stack-frame paths, breadcrumbs, and extra/contexts/tags.
 */
export function scrubEvent(event) {
  if (!event || typeof event !== "object") {
    return event;
  }

  // Identity and host — never sent.
  delete event.user;
  delete event.server_name;
  delete event.request;

  if (typeof event.message === "string") {
    event.message = scrubString(event.message);
  }

  if (event.exception && Array.isArray(event.exception.values)) {
    event.exception.values = event.exception.values.map((entry) => {
      if (!entry || typeof entry !== "object") {
        return entry;
      }
      const next = { ...entry };
      if (typeof next.value === "string") {
        next.value = scrubString(next.value);
      }
      if (next.stacktrace) {
        next.stacktrace = scrubStacktrace(next.stacktrace);
      }
      return next;
    });
  }

  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) => {
      if (!crumb || typeof crumb !== "object") {
        return crumb;
      }
      const next = { ...crumb };
      if (typeof next.message === "string") {
        next.message = scrubString(next.message);
      }
      if (next.data !== undefined) {
        next.data = scrubData(next.data);
      }
      return next;
    });
  }

  if (event.extra !== undefined) {
    event.extra = scrubData(event.extra);
  }
  if (event.contexts !== undefined) {
    event.contexts = scrubData(event.contexts);
  }
  if (event.tags !== undefined) {
    event.tags = scrubData(event.tags);
  }

  return event;
}
