function defaultSearch() {
  if (typeof window !== "object" || typeof window.location?.search !== "string") {
    return "";
  }

  return window.location.search;
}

function normalizePlatformOverride(value) {
  const normalizedValue = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalizedValue === "windows" || normalizedValue === "win") {
    return "windows";
  }

  if (normalizedValue === "mac" || normalizedValue === "macos") {
    return "mac";
  }

  return null;
}

function parsePositiveInteger(value, fallback) {
  const normalizedValue = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(normalizedValue) && normalizedValue > 0 ? normalizedValue : fallback;
}

function normalizeEditorFixture(value) {
  const normalizedValue = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalizedValue === "editor") {
    return "editor";
  }

  if (normalizedValue === "1" || normalizedValue === "true" || normalizedValue === "yes") {
    return "editor";
  }

  return null;
}

export function readDevRuntimeFlags(options = {}) {
  const isDev = options.isDev ?? import.meta.env?.DEV === true;
  if (!isDev) {
    return {
      platformOverride: null,
      editorFixture: null,
    };
  }

  const search = typeof options.search === "string" ? options.search : defaultSearch();
  const params = new URLSearchParams(search);
  const fixture =
    normalizeEditorFixture(params.get("fixture"))
    ?? normalizeEditorFixture(params.get("editorFixture"));

  return {
    platformOverride: normalizePlatformOverride(params.get("platform")),
    editorFixture:
      fixture === "editor"
        ? {
            rowCount: parsePositiveInteger(
              params.get("rows") ?? params.get("rowCount"),
              200,
            ),
          }
        : null,
  };
}
