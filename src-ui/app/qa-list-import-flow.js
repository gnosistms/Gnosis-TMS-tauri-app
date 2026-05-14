import { findIsoLanguageOption } from "../lib/language-options.js";
import { invoke } from "./runtime.js";
import {
  createQaListCreationState,
  state,
} from "./state.js";
import {
  createRemoteQaListRepo,
  deleteRemoteQaListRepo,
  prepareLocalQaListRepo,
  teamSupportsQaListRepos,
} from "./qa-list-repo-flow.js";
import {
  createQaResourceId,
  currentQaListTeam,
  qaListCreationRollbackMessage,
  selectedQaListTeamMatches,
  syncSingleQaListOrThrow,
  upsertQaListForTeam,
} from "./qa-list-top-level-state.js";
import { makeQaListDefaultIfFirst } from "./qa-list-default-flow.js";
import { normalizeQaList, normalizeQaTerm } from "./qa-list-shared.js";
import { saveStoredQaListsForTeam } from "./qa-list-cache.js";

export function openQaListCreation(render) {
  state.qaListCreation = {
    ...createQaListCreationState(),
    isOpen: true,
  };
  render();
}

export function cancelQaListCreation(render) {
  state.qaListCreation = createQaListCreationState();
  render();
}

export function updateQaListCreationField(field, value) {
  if (field !== "title" && field !== "languageCode") {
    return;
  }

  state.qaListCreation = {
    ...state.qaListCreation,
    [field]: value,
    error: "",
  };
}

export async function submitQaListCreation(render) {
  const creation = state.qaListCreation;
  const title = String(creation.title ?? "").trim();
  const language = findIsoLanguageOption(creation.languageCode);
  if (!title) {
    state.qaListCreation = { ...creation, error: "Enter a QA list name." };
    render();
    return;
  }
  if (!language) {
    state.qaListCreation = { ...creation, error: "Choose a language." };
    render();
    return;
  }

  const team = currentQaListTeam();
  let createdRemoteRepo = null;
  let localRepoInitialized = false;
  let createdQaListId = null;
  try {
    if (teamSupportsQaListRepos(team)) {
      const qaListId = globalThis.crypto?.randomUUID?.() ?? createQaResourceId("qa-list");
      createdQaListId = qaListId;
      const remoteRepo = await createRemoteQaListRepo(team, title);
      createdRemoteRepo = remoteRepo;
      await prepareLocalQaListRepo(team, remoteRepo, qaListId);
      localRepoInitialized = true;
      const summary = await invoke("initialize_gtms_qa_list_repo", {
        input: {
          installationId: team.installationId,
          repoName: remoteRepo.name,
          qaListId,
          title,
          languageCode: language.code,
          languageName: language.name,
        },
      });
      if (!selectedQaListTeamMatches(team)) {
        throw new Error("The selected team changed before the QA list could be created.");
      }
      const qaList = normalizeQaList({
        ...summary,
        repoId: remoteRepo.repoId ?? null,
        nodeId: remoteRepo.nodeId ?? null,
        fullName: remoteRepo.fullName ?? null,
        htmlUrl: remoteRepo.htmlUrl ?? "",
        defaultBranchName: remoteRepo.defaultBranchName ?? "main",
        defaultBranchHeadOid: remoteRepo.defaultBranchHeadOid ?? null,
      });
      await syncSingleQaListOrThrow(team, qaList);
      if (!selectedQaListTeamMatches(team)) {
        throw new Error("The selected team changed before the QA list could be created.");
      }
      upsertQaListForTeam(team, qaList, null, { preserveCreate: true });
      makeQaListDefaultIfFirst(team, qaList);
      saveStoredQaListsForTeam(team, state.qaLists);
    } else {
      const now = new Date().toISOString();
      const qaList = {
        id: createQaResourceId("qa-list"),
        title,
        language,
        lifecycleState: "active",
        createdAt: now,
        updatedAt: now,
        terms: [],
      };
      upsertQaListForTeam(team, qaList, null, { preserveCreate: true });
      makeQaListDefaultIfFirst(team, qaList);
      saveStoredQaListsForTeam(team, state.qaLists);
    }
    state.qaListCreation = createQaListCreationState();
    state.qaListDiscovery = { status: "ready", error: "", recoveryMessage: "" };
  } catch (error) {
    let message = error?.message ?? "Could not create this QA list.";
    if (localRepoInitialized && createdRemoteRepo?.name) {
      try {
        await invoke("purge_local_gtms_qa_list_repo", {
          input: {
            installationId: team.installationId,
            repoName: createdRemoteRepo.name,
            qaListId: createdQaListId,
          },
        });
      } catch {}
    }
    if (createdRemoteRepo?.name) {
      try {
        await deleteRemoteQaListRepo(team, { repoName: createdRemoteRepo.name });
      } catch (rollbackError) {
        message = qaListCreationRollbackMessage(error, rollbackError);
      }
    }
    state.qaListCreation = {
      ...creation,
      error: message,
    };
  }
  render();
}

function textContent(node, selector) {
  return String(node?.querySelector?.(selector)?.textContent ?? "").trim();
}

function normalizeTmxLanguageCode(value) {
  return String(value ?? "").trim().replaceAll("_", "-").toLowerCase();
}

function tmxNodeLanguageCode(node) {
  return normalizeTmxLanguageCode(
    node?.getAttribute?.("xml:lang")
      ?? node?.getAttribute?.("lang")
      ?? "",
  );
}

function parseQaListTmx(text, fileName) {
  if (typeof DOMParser === "undefined") {
    throw new Error("TMX import is not available in this runtime.");
  }

  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("This TMX file could not be parsed.");
  }

  const detectedLanguageCodes = new Set();
  const headerLanguageCode = normalizeTmxLanguageCode(doc.querySelector("header")?.getAttribute("srclang"));
  if (headerLanguageCode) {
    detectedLanguageCodes.add(headerLanguageCode);
  }
  for (const tuv of Array.from(doc.querySelectorAll("tuv"))) {
    const languageCode = tmxNodeLanguageCode(tuv);
    if (languageCode) {
      detectedLanguageCodes.add(languageCode);
    }
  }
  if (detectedLanguageCodes.size > 1) {
    throw new Error("QA list TMX import only supports single-language TMX files.");
  }

  const languageCode = [...detectedLanguageCodes][0] ?? "";
  const language = findIsoLanguageOption(languageCode);
  if (!language) {
    throw new Error("The TMX file does not include a supported language.");
  }

  const terms = Array.from(doc.querySelectorAll("tu"))
    .map((tu) => {
      const segment = Array.from(tu.querySelectorAll("tuv"))
        .find((tuv) => {
          const segmentLanguageCode = tmxNodeLanguageCode(tuv);
          return !segmentLanguageCode || segmentLanguageCode === languageCode;
        })
        ?.querySelector("seg");
      return normalizeQaTerm({
        termId: createQaResourceId("qa-term"),
        text: String(segment?.textContent ?? textContent(tu, "seg")).trim(),
        notes: textContent(tu, 'prop[type="notes"], note'),
      });
    })
    .filter(Boolean);
  const fileTitle = String(fileName ?? "")
    .replace(/\.[^.]+$/, "")
    .replaceAll(/[-_]+/g, " ")
    .trim();

  return normalizeQaList({
    id: createQaResourceId("qa-list"),
    title: fileTitle || `QA List (${language.name})`,
    language,
    lifecycleState: "active",
    terms,
  });
}

export async function importQaListFromTmx(render) {
  if (typeof document === "undefined") {
    return;
  }

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".tmx,application/xml,text/xml";
  input.hidden = true;
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    let createdRemoteRepo = null;
    let localRepoInitialized = false;
    let createdQaListId = null;
    let importTeam = null;
    try {
      const team = currentQaListTeam();
      importTeam = team;
      if (teamSupportsQaListRepos(team)) {
        const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
        const preview = await invoke("inspect_tmx_qa_list_import", {
          input: {
            fileName: file.name,
            bytes,
          },
        });
        const qaListId = globalThis.crypto?.randomUUID?.() ?? createQaResourceId("qa-list");
        createdQaListId = qaListId;
        const remoteRepo = await createRemoteQaListRepo(team, preview.title);
        createdRemoteRepo = remoteRepo;
        await prepareLocalQaListRepo(team, remoteRepo, qaListId);
        localRepoInitialized = true;
        const summary = await invoke("import_tmx_to_gtms_qa_list_repo", {
          input: {
            installationId: team.installationId,
            repoName: remoteRepo.name,
            qaListId,
            fileName: file.name,
            bytes,
          },
        });
        if (!selectedQaListTeamMatches(team)) {
          throw new Error("The selected team changed before the QA list could be imported.");
        }
        const qaList = normalizeQaList({
          ...summary,
          repoId: remoteRepo.repoId ?? null,
          nodeId: remoteRepo.nodeId ?? null,
          fullName: remoteRepo.fullName ?? null,
          htmlUrl: remoteRepo.htmlUrl ?? "",
          defaultBranchName: remoteRepo.defaultBranchName ?? "main",
          defaultBranchHeadOid: remoteRepo.defaultBranchHeadOid ?? null,
        });
        await syncSingleQaListOrThrow(team, qaList);
        if (!selectedQaListTeamMatches(team)) {
          throw new Error("The selected team changed before the QA list could be imported.");
        }
        upsertQaListForTeam(team, qaList, null, { preserveCreate: true });
        makeQaListDefaultIfFirst(team, qaList);
        saveStoredQaListsForTeam(team, state.qaLists);
      } else {
        const text = await file.text();
        const qaList = parseQaListTmx(text, file.name);
        upsertQaListForTeam(team, qaList, null, { preserveCreate: true });
        makeQaListDefaultIfFirst(team, qaList);
        saveStoredQaListsForTeam(team, state.qaLists);
      }
      state.qaListDiscovery = { status: "ready", error: "", recoveryMessage: "" };
    } catch (error) {
      const team = importTeam ?? currentQaListTeam();
      let message = error?.message ?? "Could not import this QA list.";
      if (team && localRepoInitialized && createdRemoteRepo?.name) {
        try {
          await invoke("purge_local_gtms_qa_list_repo", {
            input: {
              installationId: team.installationId,
              repoName: createdRemoteRepo.name,
              qaListId: createdQaListId,
            },
          });
        } catch {}
      }
      if (team && createdRemoteRepo?.name) {
        try {
          await deleteRemoteQaListRepo(team, { repoName: createdRemoteRepo.name });
        } catch (rollbackError) {
          message = qaListCreationRollbackMessage(error, rollbackError);
        }
      }
      state.qaListDiscovery = {
        status: "error",
        error: message,
        recoveryMessage: "",
      };
    } finally {
      render();
      input.remove();
    }
  });
  document.body.append(input);
  input.click();
}
