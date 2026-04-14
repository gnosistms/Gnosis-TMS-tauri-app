export function projectsSearchModeIsActive(projectsSearchOrQuery) {
  if (typeof projectsSearchOrQuery === "string") {
    return projectsSearchOrQuery.trim().length > 0;
  }

  return String(projectsSearchOrQuery?.query ?? "").trim().length > 0;
}

export function indexProjectSearchResults(results = []) {
  return Object.fromEntries(
    (Array.isArray(results) ? results : []).map((result) => [String(result?.resultId ?? ""), result]),
  );
}
