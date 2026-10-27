import { compactStudioStepSignatures } from "./glossary-research-studio-workflow.js";
import { queryClient } from "./query-client.js";
import { invoke } from "./runtime.js";
import { createGlossaryEditorQueryOptions, getCachedGlossaryEditorPayload } from "./glossary-editor-query.js";
import { state } from "./state.js";
import { captureStudioEvidence, hydrateStudioStep, normalizeStudioToolCache } from "./glossary-research-studio-evidence.js";

queryClient.setQueryDefaults(["glossaryResearchStudio"], { structuralSharing: false });

export function studioGlossaryEntries(scope) {
  const team = { installationId: scope.installationId };
  const glossary = { id: scope.glossaryId, glossaryId: scope.glossaryId, repoName: scope.repoName };
  return getCachedGlossaryEditorPayload(team, glossary)?.terms ?? state.glossaryEditor.terms;
}

export async function refreshStudioGlossary(scope) {
  const team = state.teams.find((t) => t.id === scope.teamId);
  const glossary = state.glossaries.find((g) => g.id === scope.glossaryId)
    ?? { id: scope.glossaryId, repoName: scope.repoName };
  const options = createGlossaryEditorQueryOptions(team, glossary);
  // A read started before a research commit must not become its final snapshot.
  await queryClient.cancelQueries({ queryKey: options.queryKey, exact: true }, { silent: true });
  await queryClient.invalidateQueries({ queryKey: options.queryKey, exact: true });
  return queryClient.fetchQuery(options);
}

const key = (scope, id = "history") => ["glossaryResearchStudio", scope.installationId, scope.glossaryId, id];
const input = (scope) => ({ installationId: scope.installationId, glossaryId: scope.glossaryId });

export function loadStudioHistory(scope) {
  return queryClient.fetchQuery({ queryKey: key(scope), staleTime: 0,
    queryFn: () => invoke("glossary_studio_storage", { operation: "list", input: input(scope) }) });
}

export function loadStudioStudy(scope, studyId) {
  return queryClient.fetchQuery({ queryKey: key(scope, studyId), staleTime: 0,
    queryFn: async () => {
      const study = await normalizeStudioToolCache(await compactStudioStepSignatures(await invoke("glossary_studio_storage", { operation: "manifest", input: { ...input(scope), studyId } })));
      await hydrateStudioStep(study, study.step);
      return study;
    } });
}

let writes = Promise.resolve();
let pendingSave = null;
export function saveStudioStudy(study) {
  const capture = captureStudioEvidence(study);
  const studyKey = JSON.stringify(key(study.scope, study.id));
  // A running write is immutable. Adjacent edits waiting behind it need only
  // persist their latest snapshot; all callers still await that durable write.
  if (pendingSave && !pendingSave.started && pendingSave.key === studyKey) {
    pendingSave.capture = capture;
    return pendingSave.result;
  }
  const job = { key: studyKey, capture, started: false };
  const save = async () => {
    job.started = true;
    if (pendingSave === job) pendingSave = null;
    const prepared = await job.capture();
    const snapshot = await compactStudioStepSignatures(prepared.value);
    const previous = queryClient.getQueryData(key(snapshot.scope, snapshot.id));
    const value = { ...snapshot, updatedAt: new Date().toISOString() };
    const receipt = await invoke("glossary_studio_storage", { operation: "save", input: {
      ...input(snapshot.scope), value,
      expectedRevision: previous?.revision ?? snapshot.revision,
    } });
    if (receipt?.id !== snapshot.id || !Number.isSafeInteger(receipt.revision) || receipt.revision < 1
      || typeof receipt.updatedAt !== "string") throw new Error("Research storage returned an invalid save confirmation. Reopen the study before saving again.");
    // The backend changes only the revision. Keep the exact durable submitted
    // snapshot without transferring its full evidence back over IPC after save.
    const saved = { ...value, revision: receipt.revision, updatedAt: receipt.updatedAt };
    prepared.committed();
    queryClient.setQueryData(key(snapshot.scope, snapshot.id), saved);
    queryClient.invalidateQueries({ queryKey: key(snapshot.scope) });
    return saved;
  };
  const result = writes.then(save);
  job.result = result;
  pendingSave = job;
  writes = result.catch(() => {});
  return result;
}

export async function exportStudioStudy(study, outputPath = null) {
  const saved = await saveStudioStudy(study);
  study.revision = saved.revision; study.updatedAt = saved.updatedAt;
  return invoke("glossary_studio_storage", { operation: outputPath ? "export" : "load", input: {
    ...input(study.scope), studyId: study.id, ...(outputPath ? { outputPath } : {}),
  } });
}

export function deleteStudioStudy(scope, studyId) {
  pendingSave = null;
  const remove = async () => {
    await invoke("glossary_studio_storage", { operation: "delete", input: { ...input(scope), studyId } });
    // Deletion may detach parent/child links in other study records too.
    queryClient.removeQueries({ queryKey: key(scope).slice(0, 3) });
  };
  const result = writes.then(remove);
  writes = result.catch(() => {});
  return result;
}
