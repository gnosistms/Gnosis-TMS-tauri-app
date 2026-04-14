export function projectsSearchModeIsActive(projectsSearchOrQuery) {
  if (typeof projectsSearchOrQuery === "string") {
    return projectsSearchOrQuery.trim().length > 0;
  }

  return String(projectsSearchOrQuery?.query ?? "").trim().length > 0;
}

export function projectsSearchModeIsActiveForState(state) {
  return projectsSearchModeIsActive(state?.projectsSearch);
}

export function projectsSearchResultCountLabel(projectsSearch = {}) {
  const total = Number.isFinite(projectsSearch?.total) ? projectsSearch.total : 0;
  const count = projectsSearch?.totalCapped === true ? `${total}+` : `${total}`;
  const suffix = total === 1 && projectsSearch?.totalCapped !== true ? "" : "s";
  return `${count} result${suffix}`;
}

export function indexProjectSearchResults(results = []) {
  return Object.fromEntries(
    (Array.isArray(results) ? results : []).map((result) => [String(result?.resultId ?? ""), result]),
  );
}
