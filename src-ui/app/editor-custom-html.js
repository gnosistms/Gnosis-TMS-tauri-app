function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Custom-HTML rows store hand-authored HTML verbatim. The raw string is what gets
// persisted and exported, but when we render it *inside* the app (the static, not-
// editing display) we must not let it execute, because the Tauri webview has IPC
// access. This module strips executable nodes, inline event handlers, and script
// URLs so the preview is safe. It is display-only — never use it for export.

// Elements that can run code or pull in remote resources have no place in an
// in-app preview. Their text content is dropped along with the element.
const FORBIDDEN_ELEMENTS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "noscript",
]);

const URL_ATTRIBUTES = new Set(["href", "src", "xlink:href", "action", "formaction"]);

function hasUnsafeUrlScheme(value) {
  // Strip the whitespace/control chars browsers ignore, then check the scheme.
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u0020]+/g, "")
    .toLowerCase();
  return (
    normalized.startsWith("javascript:")
    || normalized.startsWith("vbscript:")
    || normalized.startsWith("data:text/html")
  );
}

function sanitizeElement(element) {
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType !== 1) {
      continue;
    }
    const tagName = child.tagName.toLowerCase();
    if (FORBIDDEN_ELEMENTS.has(tagName)) {
      child.remove();
      continue;
    }
    for (const attribute of Array.from(child.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) {
        child.removeAttribute(attribute.name);
        continue;
      }
      if (URL_ATTRIBUTES.has(name) && hasUnsafeUrlScheme(attribute.value)) {
        child.removeAttribute(attribute.name);
      }
    }
    sanitizeElement(child);
  }
}

// Returns HTML safe to inject into the in-app preview. In environments without a
// DOM (the Node unit-test runner) we fall back to escaping the input so it renders
// as inert text rather than throwing.
export function sanitizeCustomHtmlForDisplay(html) {
  const source = String(html ?? "");
  if (!source.trim()) {
    return "";
  }
  if (typeof DOMParser === "undefined") {
    return escapeHtml(source);
  }
  const doc = new DOMParser().parseFromString(source, "text/html");
  sanitizeElement(doc.body);
  return doc.body.innerHTML;
}

// Plain-text projection of custom HTML, used when a print/electronic-incompatible
// export includes custom-HTML rows (tags stripped, entities resolved).
export function customHtmlToPlainText(html) {
  const source = String(html ?? "");
  if (!source.trim()) {
    return "";
  }
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(source, "text/html");
    return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
  }
  return source
    .replace(/<[^>]*>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/\s+/g, " ")
    .trim();
}
