import { invoke } from "./runtime.js";
import { queryClient } from "./query-client.js";

const knownPieces = new WeakMap();
const isPiece = (value) => typeof value?._studioArtifact === "string";
const passageSteps = new Set(["3", "4.1", "4.2", "4.3", "4.4.1", "4.4.2", "4.6", "4.7", "5", "6", "8", "9", "10a", "10b"]);
const storageInput = (study) => ({ installationId: study.scope.installationId,
  glossaryId: study.scope.glossaryId, studyId: study.id });
const digest = async (text) => `sha256:${[...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;

// Old request keys embedded the whole prompt. Preserve that original request as
// evidence, but index it with the same compact signature used by new requests.
export async function normalizeStudioToolCache(study) {
  const cache = {};
  for (const [key, entry] of Object.entries(study.cache ?? {})) {
    const split = key.lastIndexOf(":retry:");
    const signature = split < 0 ? key : key.slice(0, split);
    const suffix = split < 0 ? ":retry:0" : key.slice(split);
    cache[`${signature.startsWith("sha256:") ? signature : await digest(signature)}${suffix}`] = signature.startsWith("sha256:") ? entry
      : { ...entry, request: { legacySignature: signature } };
  }
  study.cache = cache;
  if (study.lastToolSignature?.startsWith("{")) study.lastToolSignature = await digest(study.lastToolSignature);
  if (study.toolRetries) study.toolRetries = Object.fromEntries(await Promise.all(Object.entries(study.toolRetries)
    .map(async ([key, value]) => [key.startsWith("sha256:") ? key : await digest(key), value])));
  return study;
}

export async function resolveStudioEvidence(study, value) {
  if (!isPiece(value)) return value;
  const result = await queryClient.fetchQuery({
    queryKey: ["glossaryResearchEvidence", ...Object.values(storageInput(study)), value._studioArtifact],
    staleTime: Infinity, gcTime: 60_000, structuralSharing: false,
    queryFn: () => invoke("glossary_studio_storage", { operation: "artifact-read", input: { ...storageInput(study), value } }),
  });
  if (result && typeof result === "object") knownPieces.set(result, value);
  return result;
}

export async function hydrateStudioStep(study, step) {
  if (passageSteps.has(step) && isPiece(study.passages)) study.passages = await resolveStudioEvidence(study, study.passages);
  const record = study.steps?.[step];
  if (!record) return;
  for (const key of ["value", "approved"]) if (isPiece(record[key])) record[key] = await resolveStudioEvidence(study, record[key]);
}

// Only curated findings travel downstream. Raw retrievals and full source audits
// live in the artifact; opening that step or exporting requests the full output.
function reportPreview(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const fields = new Set(["summary", "meanings", "citations", "assignments", "compounds", "skipped", "reason", "pending", "complete",
    "paragraphCount", "occurrenceCount", "sourceStudyId", "dictionaryVersion", "total", "paragraphs", "missing", "recoveryConsidered", "branch"]);
  return Object.fromEntries(Object.entries(value).filter(([key]) => fields.has(key)));
}

// Capture now, before the asynchronous write queue. Large immutable values are
// copied only the first time they become evidence, not on every checkpoint.
export function captureStudioEvidence(study) {
  // A new study (including a populated split child) must exist before evidence
  // writes are allowed. Its first atomic snapshot also survives interruption.
  if (!study.revision) {
    const value = structuredClone(study);
    return async () => ({ value, committed() {} });
  }
  const pieces = []; const slots = [];
  function piece(value, path, preview = false) {
    if (!value || typeof value !== "object" || isPiece(value)) return value;
    const mutableDraft = path[0] === "steps" && path[2] === "value"
      && ["2a", "4.5", "4.6", "4.7", "6", "7", "8", "9"].includes(path[1]);
    const known = mutableDraft ? null : knownPieces.get(value);
    if (known) {
      const ref = preview ? { _studioArtifact: known._studioArtifact, bytes: known.bytes, ...structuredClone(reportPreview(value)) }
        : path[0] === "passages" && Array.isArray(value) ? { ...known, ids: value.map((p) => p.id) } : known;
      slots.push({ path, value, ref }); return ref;
    }
    const index = pieces.length;
    const view = preview ? structuredClone(reportPreview(value)) : Array.isArray(value)
      ? { length: value.length, ...(path[0] === "passages" ? { ids: value.map((p) => p.id) } : {}) } : {};
    pieces.push({ original: value, value: structuredClone(value), view });
    const placeholder = { _pendingStudioPiece: index, ...view };
    slots.push({ path, value, index });
    return placeholder;
  }
  const draft = { ...study, _storageVersion: 2,
    cache: Object.fromEntries(Object.entries(study.cache ?? {}).map(([key, row]) => [key, { ...row,
      value: piece(row.value, ["cache", key, "value"]),
      ...(row.request ? { request: piece(row.request, ["cache", key, "request"]) } : {}),
    }])),
    steps: Object.fromEntries(Object.entries(study.steps ?? {}).map(([step, record]) => [step, { ...record,
      ...(record.value ? { value: piece(record.value, ["steps", step, "value"], true) } : {}),
      ...(record.approved ? { approved: piece(record.approved, ["steps", step, "approved"], true) } : {}),
    }])),
  };
  if (study.comparisonReference) draft.comparisonReference = piece(study.comparisonReference, ["comparisonReference"], true);
  if (study.comparisonResults) draft.comparisonResults = Object.fromEntries(Object.entries(study.comparisonResults).map(([key, value]) => [key, piece(value, ["comparisonResults", key])]));
  if (study.population) draft.population = piece(study.population, ["population"]);
  if (study.passages?.length) draft.passages = piece(study.passages, ["passages"]);
  if (study.testHistory) draft.testHistory = study.testHistory.map((row, i) => piece(row, ["testHistory", i]));
  if (study.comparisonStarts) draft.comparisonStarts = Object.fromEntries(Object.entries(study.comparisonStarts)
    .map(([step, value]) => [step, piece(value, ["comparisonStarts", step])]));
  if (study.comparisonHistory) draft.comparisonHistory = Object.fromEntries(Object.entries(study.comparisonHistory)
    .map(([step, rows]) => [step, rows.map((row, i) => piece(row, ["comparisonHistory", step, i]))]));
  const snapshot = structuredClone(draft);
  return async () => {
    const refs = pieces.length ? await invoke("glossary_studio_storage", { operation: "artifact-write",
      input: { ...storageInput(snapshot), value: pieces.map((p) => p.value) } }) : [];
    if (!Array.isArray(refs) || refs.length !== pieces.length || refs.some((ref) => !/^[a-f0-9]{64}$/u.test(ref?._studioArtifact))) throw new Error("Research evidence could not be saved. The previous checkpoint was kept.");
    const descriptors = refs.map((ref, i) => ({ ...pieces[i].view, ...ref }));
    const replace = (value) => {
      if (value && typeof value === "object" && Number.isInteger(value._pendingStudioPiece)) return descriptors[value._pendingStudioPiece];
      if (Array.isArray(value)) return value.map(replace);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, replace(v)]));
      return value;
    };
    const value = replace(snapshot);
    return { value, committed() {
      pieces.forEach((p, i) => knownPieces.set(p.original, descriptors[i]));
      for (const slot of slots) {
        const parent = slot.path.slice(0, -1).reduce((item, key) => item?.[key], study);
        const key = slot.path.at(-1);
        const retain = slot.path[0] === "steps" && slot.path[1] === study.step
          || slot.path[0] === "passages" && passageSteps.has(study.step)
          || slot.path[0] === "population" && study.step === "3";
        if (!retain && parent?.[key] === slot.value) parent[key] = slot.ref ?? descriptors[slot.index];
      }
    } };
  };
}
