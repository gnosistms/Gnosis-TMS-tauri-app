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
  if (projectsSearch?.includeWeakerMatches === true) {
    const total = Number.isFinite(projectsSearch?.total) ? projectsSearch.total : 0;
    const suffix = total === 1 ? "" : "s";
    const cappedSuffix = projectsSearch?.totalCapped === true ? " shown" : "";
    return `${total} matching row${suffix}${cappedSuffix}`;
  }

  const strongTotal = Number.isFinite(projectsSearch?.strongTotal)
    ? projectsSearch.strongTotal
    : (projectsSearch?.results ?? []).filter((row) => row?.qualityTier !== "weaker").length;
  const suffix = strongTotal === 1 ? "" : "s";
  const cappedSuffix = projectsSearch?.totalCapped === true ? " shown" : "";
  return `${strongTotal} strong matching row${suffix}${cappedSuffix}`;
}

export function projectSearchWeakerToggleLabel(projectsSearch = {}) {
  if (projectsSearch?.includeWeakerMatches === true) {
    return "Hide weaker matches";
  }
  const weakerTotal = Number.isFinite(projectsSearch?.weakerTotal)
    ? projectsSearch.weakerTotal
    : (projectsSearch?.results ?? []).filter((row) => row?.qualityTier === "weaker").length;
  if (projectsSearch?.totalCapped === true) {
    return `Include weaker matches (${weakerTotal} available)`;
  }
  return `Include ${weakerTotal} weaker match${weakerTotal === 1 ? "" : "es"}`;
}

export function projectSearchVisibleResults(projectsSearch = {}) {
  const results = Array.isArray(projectsSearch?.results) ? projectsSearch.results : [];
  if (projectsSearch?.includeWeakerMatches === true) {
    return results;
  }
  return results.filter((row) => row?.qualityTier !== "weaker");
}

function compareScoreThenTitle(left, right) {
  const scoreDifference = Number(right?.score ?? 0) - Number(left?.score ?? 0);
  if (scoreDifference !== 0) {
    return scoreDifference;
  }
  return String(left?.title ?? "").localeCompare(String(right?.title ?? ""));
}

export function buildProjectSearchTree(results = []) {
  const projectsById = new Map();

  for (const row of Array.isArray(results) ? results : []) {
    const projectId = String(row?.projectId ?? "").trim();
    const chapterId = String(row?.chapterId ?? "").trim();
    const rowId = String(row?.rowId ?? "").trim();
    if (!projectId || !chapterId || !rowId) {
      continue;
    }

    let project = projectsById.get(projectId);
    if (!project) {
      project = {
        id: projectId,
        title: String(row?.projectTitle ?? "Project"),
        score: Number(row?.score ?? 0),
        rowCount: 0,
        chaptersById: new Map(),
      };
      projectsById.set(projectId, project);
    }
    project.score = Math.max(project.score, Number(row?.score ?? 0));
    project.rowCount += 1;

    let chapter = project.chaptersById.get(chapterId);
    if (!chapter) {
      chapter = {
        id: chapterId,
        title: String(row?.chapterTitle ?? "Chapter"),
        score: Number(row?.score ?? 0),
        rowCount: 0,
        rows: [],
      };
      project.chaptersById.set(chapterId, chapter);
    }
    chapter.score = Math.max(chapter.score, Number(row?.score ?? 0));
    chapter.rowCount += 1;
    chapter.rows.push(row);
  }

  return [...projectsById.values()]
    .map((project) => ({
      ...project,
      chapters: [...project.chaptersById.values()]
        .map((chapter) => ({
          ...chapter,
          rows: [...chapter.rows].sort((left, right) =>
            String(left?.rowOrderKey ?? "").localeCompare(String(right?.rowOrderKey ?? ""))
            || String(left?.rowId ?? "").localeCompare(String(right?.rowId ?? ""))),
        }))
        .sort(compareScoreThenTitle),
    }))
    .sort(compareScoreThenTitle);
}
