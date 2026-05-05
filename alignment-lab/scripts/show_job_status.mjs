import fs from "node:fs/promises";
import path from "node:path";

const root = "/Users/hans/Desktop/GnosisTMS/alignment-lab";

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
  return value;
}

const jobId = argValue("--job-id", "row-level-250");
const manifestPath = path.join(root, "alignment-jobs", jobId, "manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

const rows = manifest.stages.map((stage) => ({
  stage: `${stage.stageNumber}. ${stage.stageName}`,
  status: stage.status,
  progress:
    stage.total === null || stage.total === undefined
      ? ""
      : `${stage.completed ?? 0} / ${stage.total}`,
  percent:
    stage.percent === null || stage.percent === undefined
      ? ""
      : `${stage.percent.toFixed(1)}%`,
  cached: stage.cached ?? 0,
  apiCalls: stage.apiCallsMade ?? 0,
  message: stage.message ?? "",
}));

console.log(JSON.stringify({
  jobId: manifest.jobId,
  createdAt: manifest.createdAt,
  updatedAt: manifest.updatedAt,
  apiUsage: manifest.apiUsage,
  stages: rows,
}, null, 2));
