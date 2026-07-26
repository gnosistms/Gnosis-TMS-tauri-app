import { loadStoredQaListsForTeam } from "./qa-list-cache.js";
import { loadStoredDefaultQaListIdsForTeam } from "./qa-list-default-cache.js";
import { languageBaseCode } from "./editor-language-utils.js";
import { normalizeQaList } from "./qa-list-shared.js";
import { selectedProjectsTeam } from "./project-context.js";
import { invoke } from "./runtime.js";
import { state } from "./state.js";

function uniqueQaLists(values) {
  const byId = new Map();
  for (const value of values) {
    const normalized = normalizeQaList(value);
    if (normalized?.id && !byId.has(normalized.id)) {
      byId.set(normalized.id, normalized);
    }
  }
  return [...byId.values()];
}

function selectQaListForLanguage(qaLists, team, languageCode) {
  const active = qaLists.filter((qaList) =>
    qaList.lifecycleState === "active"
    && qaList.language?.code === languageCode
  );
  const storedDefaultId = loadStoredDefaultQaListIdsForTeam(team)[languageCode];
  const storedDefault = active.find((qaList) => qaList.id === storedDefaultId);
  if (storedDefault) {
    return storedDefault;
  }
  return active.length === 1 ? active[0] : null;
}

async function resolveQaListForAiReview(team, languageCode) {
  const cached = loadStoredQaListsForTeam(team);
  let candidates = uniqueQaLists([
    ...(Array.isArray(state.qaLists) ? state.qaLists : []),
    ...(Array.isArray(cached?.qaLists) ? cached.qaLists : []),
  ]);
  const qaList = selectQaListForLanguage(candidates, team, languageCode);
  if (qaList) {
    return qaList;
  }
  const storedDefaultId = loadStoredDefaultQaListIdsForTeam(team)[languageCode];
  if (!storedDefaultId) {
    return null;
  }

  const local = await invoke("list_local_gtms_qa_lists", {
    input: { installationId: team.installationId },
  });
  candidates = uniqueQaLists([...candidates, ...(Array.isArray(local) ? local : [])]);
  return selectQaListForLanguage(candidates, team, languageCode);
}

export async function loadEditorAiReviewQaHints({
  targetLanguageCode,
  rows,
}) {
  const team = selectedProjectsTeam();
  const targetColumnCode = String(targetLanguageCode ?? "").trim();
  const targetLanguage = (Array.isArray(state.editorChapter?.languages)
    ? state.editorChapter.languages
    : [])
    .find((language) => language?.code === targetColumnCode);
  const languageCode = languageBaseCode(targetLanguage) || targetColumnCode;
  const rowList = Array.isArray(rows) ? rows : [];
  if (!Number.isFinite(team?.installationId) || !languageCode || rowList.length === 0) {
    return new Map();
  }

  const qaList = await resolveQaListForAiReview(team, languageCode);
  if (!qaList) {
    return new Map();
  }

  const payload = await invoke("match_gtms_qa_list_terms", {
    input: {
      installationId: team.installationId,
      qaListId: qaList.id,
      repoName: qaList.repoName ?? "",
      languageCode,
      rows: rowList.map((row) => ({
        rowId: String(row?.rowId ?? row?.id ?? "").trim(),
        text: String(row?.text ?? ""),
        footnote: String(row?.footnote ?? ""),
        imageCaption: String(row?.imageCaption ?? ""),
      })),
    },
  });

  return new Map(
    (Array.isArray(payload?.rows) ? payload.rows : []).map((row) => [
      String(row?.rowId ?? "").trim(),
      Array.isArray(row?.hints) ? row.hints : [],
    ]),
  );
}
