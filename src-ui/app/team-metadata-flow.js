import { requireBrokerSession } from "./auth-flow.js";
import { invoke } from "./runtime.js";

function metadataRouteUnavailable(error, resourcePath, methods = ["PATCH", "DELETE"]) {
  const message = String(error?.message ?? error ?? "");
  return message.includes(resourcePath) && methods.some((method) => message.includes(`Cannot ${method} `));
}

function normalizeMetadataError(error, fallbackMessage, resourcePath, methods) {
  if (metadataRouteUnavailable(error, resourcePath, methods)) {
    return new Error(fallbackMessage);
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error ?? fallbackMessage));
}

function metadataLanguagePayload(language) {
  const code =
    typeof language?.code === "string" && language.code.trim()
      ? language.code.trim()
      : "";
  const name =
    typeof language?.name === "string" && language.name.trim()
      ? language.name.trim()
      : "";

  if (!code || !name) {
    return null;
  }

  return { code, name };
}

function normalizeMetadataLanguage(language) {
  const code =
    typeof language?.code === "string" && language.code.trim()
      ? language.code.trim()
      : "";
  const name =
    typeof language?.name === "string" && language.name.trim()
      ? language.name.trim()
      : "";
  return code && name ? { code, name } : null;
}

function normalizeStringList(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  )];
}

function normalizeProjectMetadataRecord(record) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const id =
    typeof record.id === "string" && record.id.trim()
      ? record.id.trim()
      : null;
  const title =
    typeof record.title === "string" && record.title.trim()
      ? record.title.trim()
      : null;
  const repoName =
    typeof record.repoName === "string" && record.repoName.trim()
      ? record.repoName.trim()
      : null;
  if (!id || !title || !repoName) {
    return null;
  }

  return {
    id,
    kind: "project",
    title,
    repoName,
    previousRepoNames: normalizeStringList(record.previousRepoNames),
    githubRepoId: Number.isFinite(record.githubRepoId) ? record.githubRepoId : null,
    githubNodeId:
      typeof record.githubNodeId === "string" && record.githubNodeId.trim()
        ? record.githubNodeId.trim()
        : null,
    fullName:
      typeof record.fullName === "string" && record.fullName.trim()
        ? record.fullName.trim()
        : null,
    defaultBranch:
      typeof record.defaultBranch === "string" && record.defaultBranch.trim()
        ? record.defaultBranch.trim()
        : "main",
    lifecycleState:
      record.lifecycleState === "softDeleted" || record.lifecycleState === "deleted"
        ? "deleted"
        : "active",
    remoteState:
      typeof record.remoteState === "string" && record.remoteState.trim()
        ? record.remoteState.trim()
        : "pendingCreate",
    recordState:
      typeof record.recordState === "string" && record.recordState.trim()
        ? record.recordState.trim()
        : "live",
    deletedAt:
      typeof record.deletedAt === "string" && record.deletedAt.trim()
        ? record.deletedAt.trim()
        : null,
    chapterCount: Number.isFinite(record.chapterCount) ? record.chapterCount : 0,
  };
}

function normalizeGlossaryMetadataRecord(record) {
  const shared = normalizeProjectMetadataRecord(record);
  if (!shared) {
    return null;
  }

  return {
    ...shared,
    kind: "glossary",
    sourceLanguage: normalizeMetadataLanguage(record.sourceLanguage),
    targetLanguage: normalizeMetadataLanguage(record.targetLanguage),
    termCount: Number.isFinite(record.termCount) ? record.termCount : 0,
  };
}

function previousRepoNamesPayload(previousRepoNames = []) {
  const names = [...new Set(
    (Array.isArray(previousRepoNames) ? previousRepoNames : [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  )];
  return names.length > 0 ? names : undefined;
}

export async function upsertProjectMetadataRecord(team, record) {
  try {
    await invoke("upsert_gnosis_project_metadata_record", {
      input: {
        installationId: team.installationId,
        orgLogin: team.githubOrg,
        projectId: record.projectId,
        title: record.title,
        repoName: record.repoName,
        previousRepoNames: previousRepoNamesPayload(record.previousRepoNames),
        githubRepoId: Number.isFinite(record.githubRepoId) ? record.githubRepoId : null,
        githubNodeId:
          typeof record.githubNodeId === "string" && record.githubNodeId.trim()
            ? record.githubNodeId.trim()
            : null,
        fullName:
          typeof record.fullName === "string" && record.fullName.trim()
            ? record.fullName.trim()
            : null,
        defaultBranch:
          typeof record.defaultBranch === "string" && record.defaultBranch.trim()
            ? record.defaultBranch.trim()
            : null,
        lifecycleState: record.lifecycleState ?? null,
        remoteState: record.remoteState ?? null,
        recordState: record.recordState ?? null,
        deletedAt:
          typeof record.deletedAt === "string" && record.deletedAt.trim()
            ? record.deletedAt.trim()
            : null,
        chapterCount: Number.isFinite(record.chapterCount) ? record.chapterCount : null,
      },
      sessionToken: requireBrokerSession(),
    });
  } catch (error) {
    throw normalizeMetadataError(
      error,
      "The broker does not have project metadata routes deployed yet. Team metadata could not be updated.",
      "/gnosis-projects/metadata-record",
      ["PATCH", "DELETE"],
    );
  }
}

export async function deleteProjectMetadataRecord(team, projectId) {
  try {
    await invoke("delete_gnosis_project_metadata_record", {
      input: {
        installationId: team.installationId,
        orgLogin: team.githubOrg,
        projectId,
      },
      sessionToken: requireBrokerSession(),
    });
  } catch (error) {
    throw normalizeMetadataError(
      error,
      "The broker does not have project metadata routes deployed yet. Team metadata could not be updated.",
      "/gnosis-projects/metadata-record",
      ["PATCH", "DELETE"],
    );
  }
}

export async function upsertGlossaryMetadataRecord(team, record) {
  try {
    await invoke("upsert_gnosis_glossary_metadata_record", {
      input: {
        installationId: team.installationId,
        orgLogin: team.githubOrg,
        glossaryId: record.glossaryId,
        title: record.title,
        repoName: record.repoName,
        previousRepoNames: previousRepoNamesPayload(record.previousRepoNames),
        githubRepoId: Number.isFinite(record.githubRepoId) ? record.githubRepoId : null,
        githubNodeId:
          typeof record.githubNodeId === "string" && record.githubNodeId.trim()
            ? record.githubNodeId.trim()
            : null,
        fullName:
          typeof record.fullName === "string" && record.fullName.trim()
            ? record.fullName.trim()
            : null,
        defaultBranch:
          typeof record.defaultBranch === "string" && record.defaultBranch.trim()
            ? record.defaultBranch.trim()
            : null,
        lifecycleState: record.lifecycleState ?? null,
        remoteState: record.remoteState ?? null,
        recordState: record.recordState ?? null,
        deletedAt:
          typeof record.deletedAt === "string" && record.deletedAt.trim()
            ? record.deletedAt.trim()
            : null,
        sourceLanguage: metadataLanguagePayload(record.sourceLanguage),
        targetLanguage: metadataLanguagePayload(record.targetLanguage),
        termCount: Number.isFinite(record.termCount) ? record.termCount : null,
      },
      sessionToken: requireBrokerSession(),
    });
  } catch (error) {
    throw normalizeMetadataError(
      error,
      "The broker does not have glossary metadata routes deployed yet. Team metadata could not be updated.",
      "/gnosis-glossaries/metadata-record",
      ["PATCH", "DELETE"],
    );
  }
}

export async function listProjectMetadataRecords(team) {
  try {
    const records = await invoke("list_gnosis_project_metadata_records", {
      input: {
        installationId: team.installationId,
        orgLogin: team.githubOrg,
      },
      sessionToken: requireBrokerSession(),
    });
    return (Array.isArray(records) ? records : [])
      .map(normalizeProjectMetadataRecord)
      .filter(Boolean);
  } catch (error) {
    throw normalizeMetadataError(
      error,
      "The broker does not have project metadata read routes deployed yet. Project metadata could not be loaded.",
      "/gnosis-projects/metadata-records",
      ["GET"],
    );
  }
}

export async function listGlossaryMetadataRecords(team) {
  try {
    const records = await invoke("list_gnosis_glossary_metadata_records", {
      input: {
        installationId: team.installationId,
        orgLogin: team.githubOrg,
      },
      sessionToken: requireBrokerSession(),
    });
    return (Array.isArray(records) ? records : [])
      .map(normalizeGlossaryMetadataRecord)
      .filter(Boolean);
  } catch (error) {
    throw normalizeMetadataError(
      error,
      "The broker does not have glossary metadata read routes deployed yet. Glossary metadata could not be loaded.",
      "/gnosis-glossaries/metadata-records",
      ["GET"],
    );
  }
}
