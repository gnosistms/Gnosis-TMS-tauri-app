import { normalizeGlossarySummary, sortGlossaries } from "./glossary-shared.js";
import { normalizeRemoteGlossaryRepo } from "./glossary-repo-flow.js";
import { createRepoResourceReconciliationPrimitives } from "./repo-resource/repo-flow.js";

const glossaryReconciliation = createRepoResourceReconciliationPrimitives({
  kind: "glossary",
  resourceIdField: "glossaryId",
  normalizeSummary: normalizeGlossarySummary,
  sortSummaries: sortGlossaries,
  normalizeRemoteRepo: normalizeRemoteGlossaryRepo,
  languageFieldsForMerge: (localGlossary, record) => ({
    sourceLanguage: localGlossary?.sourceLanguage ?? record.sourceLanguage ?? null,
    targetLanguage: localGlossary?.targetLanguage ?? record.targetLanguage ?? null,
  }),
});

export function findMatchingRemoteGlossary(
  record,
  remoteByRepoName,
  remoteByFullName,
  remoteByRepoId,
  remoteByNodeId,
) {
  return glossaryReconciliation.findMatchingRemote(
    record,
    remoteByRepoName,
    remoteByFullName,
    remoteByRepoId,
    remoteByNodeId,
  );
}

export function findConfirmedMissingGlossaryRecords(metadataRecords = [], remoteRepos = []) {
  const normalizedRemotes = (Array.isArray(remoteRepos) ? remoteRepos : [])
    .map(normalizeRemoteGlossaryRepo)
    .filter(Boolean);
  const remoteByRepoId = new Map(
    normalizedRemotes
      .filter((repo) => Number.isFinite(repo.repoId))
      .map((repo) => [repo.repoId, repo]),
  );
  const remoteByNodeId = new Map(
    normalizedRemotes
      .filter((repo) => typeof repo.nodeId === "string" && repo.nodeId.trim())
      .map((repo) => [repo.nodeId, repo]),
  );
  const remoteByRepoName = new Map(normalizedRemotes.map((repo) => [repo.name, repo]));
  const remoteByFullName = new Map(normalizedRemotes.map((repo) => [repo.fullName, repo]));

  return (Array.isArray(metadataRecords) ? metadataRecords : []).filter((record) =>
    record?.recordState === "live"
    && (record?.remoteState ?? "linked") === "linked"
    && !findMatchingRemoteGlossary(
      record,
      remoteByRepoName,
      remoteByFullName,
      remoteByRepoId,
      remoteByNodeId,
    )
  );
}

export function mergeMetadataBackedGlossarySummaries(
  localSummaries,
  metadataRecords,
  remoteRepos,
  options = {},
) {
  return glossaryReconciliation.mergeMetadataBackedSummaries(
    localSummaries,
    metadataRecords,
    remoteRepos,
    options,
  );
}
