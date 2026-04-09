import { requireBrokerSession } from "./auth-flow.js";
import { invoke } from "./runtime.js";

function metadataRouteUnavailable(error, resourcePath) {
  const message = String(error?.message ?? error ?? "");
  return message.includes(resourcePath) && (message.includes("Cannot PATCH ") || message.includes("Cannot DELETE "));
}

function normalizeMetadataError(error, fallbackMessage, resourcePath) {
  if (metadataRouteUnavailable(error, resourcePath)) {
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
        chapterCount: Number.isFinite(record.chapterCount) ? record.chapterCount : null,
      },
      sessionToken: requireBrokerSession(),
    });
  } catch (error) {
    throw normalizeMetadataError(
      error,
      "The broker does not have project metadata routes deployed yet. Team metadata could not be updated.",
      "/gnosis-projects/metadata-record",
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
    );
  }
}
