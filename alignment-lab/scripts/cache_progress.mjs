import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const STAGES = [
  { id: "prepare_units", number: 1, name: "Preparing text units" },
  { id: "build_sections", number: 2, name: "Building overlapping sections" },
  { id: "summarize_sections", number: 3, name: "Summarizing sections" },
  { id: "find_section_matches", number: 4, name: "Finding section matches" },
  { id: "select_corridor", number: 5, name: "Selecting section corridor" },
  { id: "row_alignment", number: 6, name: "Aligning rows inside matched sections" },
  { id: "merge_rows", number: 7, name: "Merging row-level results" },
  { id: "resolve_conflicts", number: 8, name: "Resolving conflicts" },
  { id: "split_targets", number: 9, name: "Splitting combined target rows" },
  { id: "build_preview", number: 10, name: "Building preview" },
  { id: "final_checks", number: 11, name: "Final checks" },
];

const STAGE_BY_ID = new Map(STAGES.map((stage) => [stage.id, stage]));

const STAGE_SIGNATURE_FIELDS = {
  prepare_units: [
    "sourceContentHash",
    "sourceOrderHash",
    "targetRawTextHash",
    "targetContentHash",
    "sourceLanguage",
    "targetLanguage",
    "parserVersion",
  ],
  build_sections: [
    "sourceContentHash",
    "targetContentHash",
    "parserVersion",
    "sectioningVersion",
    "chunkSize",
    "stride",
  ],
  summarize_sections: [
    "sourceContentHash",
    "targetContentHash",
    "sourceLanguage",
    "targetLanguage",
    "parserVersion",
    "sectioningVersion",
    "chunkSize",
    "stride",
    "models.summary",
    "promptVersions.summary",
  ],
  find_section_matches: [
    "sourceContentHash",
    "targetContentHash",
    "sourceLanguage",
    "targetLanguage",
    "sectioningVersion",
    "chunkSize",
    "stride",
    "models.summary",
    "models.sectionMatch",
    "promptVersions.summary",
    "promptVersions.sectionMatch",
  ],
  select_corridor: [
    "sourceContentHash",
    "targetContentHash",
    "chunkSize",
    "stride",
    "promptVersions.sectionMatch",
    "dpVersion",
  ],
  row_alignment: [
    "sourceContentHash",
    "targetContentHash",
    "sourceLanguage",
    "targetLanguage",
    "chunkSize",
    "stride",
    "corridorHash",
    "dpVersion",
    "models.rowAlignment",
    "promptVersions.rowAlignment",
  ],
  merge_rows: [
    "sourceContentHash",
    "targetContentHash",
    "chunkSize",
    "stride",
    "corridorHash",
    "dpVersion",
    "promptVersions.rowAlignment",
    "mergeVersion",
  ],
  resolve_conflicts: [
    "sourceContentHash",
    "targetContentHash",
    "chunkSize",
    "stride",
    "corridorHash",
    "promptVersions.rowAlignment",
    "models.conflictResolver",
    "promptVersions.conflictResolver",
    "mergeVersion",
  ],
  split_targets: [
    "sourceContentHash",
    "targetContentHash",
    "sourceLanguage",
    "targetLanguage",
    "mergeVersion",
    "models.splitTarget",
    "promptVersions.splitTarget",
  ],
  build_preview: [
    "sourceContentHash",
    "targetContentHash",
    "mergeVersion",
    "promptVersions.splitTarget",
    "htmlRendererVersion",
  ],
  final_checks: [
    "sourceContentHash",
    "targetContentHash",
    "mergeVersion",
    "promptVersions.splitTarget",
    "finalCheckVersion",
  ],
};

export function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hashJson(value) {
  return sha256(stableJson(value));
}

export function parseTextUnits(text, limit = Infinity) {
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ text: line.trim(), originalLineNumber: index + 1 }))
    .filter((unit) => unit.text.length > 0)
    .slice(0, limit)
    .map((unit, index) => ({
      id: index + 1,
      text: unit.text,
      originalLineNumber: unit.originalLineNumber,
    }));
}

export function buildContentSignature({
  sourceUnits,
  targetUnits,
  targetRawText,
  sourceLanguage,
  targetLanguage,
  chunkSize,
  stride,
  models = {},
  promptVersions = {},
  parserVersion = "plain-text-v1",
  sectioningVersion = "overlap-section-v1",
  dpVersion = "corridor-centerline-v1",
  mergeVersion = "row-merge-v1",
  htmlRendererVersion = "alignment-preview-v1",
  finalCheckVersion = "coverage-checks-v1",
}) {
  return {
    sourceContentHash: hashJson(sourceUnits.map((unit) => unit.text)),
    sourceOrderHash: hashJson(sourceUnits.map((unit) => unit.id)),
    targetRawTextHash: sha256(targetRawText ?? targetUnits.map((unit) => unit.text).join("\n")),
    targetContentHash: hashJson(targetUnits.map((unit) => unit.text)),
    sourceLanguage,
    targetLanguage,
    parserVersion,
    sectioningVersion,
    chunkSize,
    stride,
    models,
    promptVersions,
    dpVersion,
    mergeVersion,
    htmlRendererVersion,
    finalCheckVersion,
  };
}

function getPath(value, dottedPath) {
  return dottedPath.split(".").reduce((current, key) => current?.[key], value);
}

export function stageSignature(fullSignature, stageId) {
  const fields = STAGE_SIGNATURE_FIELDS[stageId];
  if (!fields) throw new Error(`Unknown stage id ${stageId}`);
  const signature = {};
  for (const field of fields) {
    signature[field] = getPath(fullSignature, field);
  }
  return signature;
}

export function stageSignatureHash(fullSignature, stageId) {
  return hashJson(stageSignature(fullSignature, stageId));
}

export class AlignmentJob {
  constructor({ root, jobId, signature }) {
    this.root = root;
    this.jobId = jobId;
    this.dir = path.join(root, "alignment-jobs", jobId);
    this.manifestPath = path.join(this.dir, "manifest.json");
    this.eventsPath = path.join(this.dir, "progress-events.jsonl");
    this.signature = signature;
    this.manifest = null;
  }

  async init() {
    await fs.mkdir(this.dir, { recursive: true });
    try {
      this.manifest = JSON.parse(await fs.readFile(this.manifestPath, "utf8"));
    } catch {
      this.manifest = {
        jobId: this.jobId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        signature: this.signature,
        stages: STAGES.map((stage) => this.initialStageRecord(stage)),
        apiUsage: { callsMade: 0, cacheHits: 0 },
        warnings: [],
      };
    }

    this.manifest.signature = this.signature;
    this.refreshStageStaleness();
    await this.save();
    return this;
  }

  initialStageRecord(stage) {
    return {
      stageId: stage.id,
      stageNumber: stage.number,
      stageName: stage.name,
      status: "not_started",
      completed: 0,
      total: null,
      percent: null,
      cached: 0,
      apiCallsMade: 0,
      warningCount: 0,
      message: "",
      signatureHash: stageSignatureHash(this.signature, stage.id),
      updatedAt: new Date().toISOString(),
    };
  }

  stageRecord(stageId) {
    const stage = STAGE_BY_ID.get(stageId);
    if (!stage) throw new Error(`Unknown stage id ${stageId}`);
    let record = this.manifest.stages.find((item) => item.stageId === stageId);
    if (!record) {
      record = this.initialStageRecord(stage);
      this.manifest.stages.push(record);
    }
    return record;
  }

  refreshStageStaleness() {
    let upstreamStale = false;
    for (const stage of STAGES) {
      const record = this.stageRecord(stage.id);
      const nextHash = stageSignatureHash(this.signature, stage.id);
      const selfStale = record.signatureHash && record.signatureHash !== nextHash;
      if (selfStale || upstreamStale) {
        record.status = "stale";
        record.staleReason = selfStale ? "stage signature changed" : "upstream stage is stale";
      }
      record.signatureHash = nextHash;
      upstreamStale = record.status === "stale" || upstreamStale;
    }
  }

  async save() {
    this.manifest.updatedAt = new Date().toISOString();
    await fs.writeFile(this.manifestPath, `${JSON.stringify(this.manifest, null, 2)}\n`);
  }

  async emit(stageId, update = {}) {
    const stage = STAGE_BY_ID.get(stageId);
    if (!stage) throw new Error(`Unknown stage id ${stageId}`);
    const record = this.stageRecord(stageId);
    Object.assign(record, update, {
      stageId,
      stageNumber: stage.number,
      stageName: stage.name,
      updatedAt: new Date().toISOString(),
    });
    if (record.total && record.total > 0 && Number.isFinite(record.completed)) {
      record.percent = Math.max(0, Math.min(100, (record.completed / record.total) * 100));
    }
    const event = {
      jobId: this.jobId,
      timestamp: record.updatedAt,
      stageId,
      stageNumber: stage.number,
      stageName: stage.name,
      status: record.status,
      completed: record.completed,
      total: record.total,
      percent: record.percent,
      cached: record.cached ?? 0,
      apiCallsMade: record.apiCallsMade ?? 0,
      message: record.message ?? "",
      warningCount: record.warningCount ?? 0,
    };
    await fs.appendFile(this.eventsPath, `${JSON.stringify(event)}\n`);
    await this.save();
    console.error(`[${stage.number}/11] ${stage.name}: ${event.status} ${event.completed ?? ""}/${event.total ?? ""} ${event.message ?? ""}`.trim());
    return event;
  }

  async cacheHit(stageId, count = 1) {
    this.manifest.apiUsage.cacheHits += count;
    const record = this.stageRecord(stageId);
    record.cached = (record.cached ?? 0) + count;
    await this.save();
  }

  async apiCall(stageId, count = 1) {
    this.manifest.apiUsage.callsMade += count;
    const record = this.stageRecord(stageId);
    record.apiCallsMade = (record.apiCallsMade ?? 0) + count;
    await this.save();
  }
}

export async function openAlignmentJob({ root, jobId, signature }) {
  return new AlignmentJob({ root, jobId, signature }).init();
}
