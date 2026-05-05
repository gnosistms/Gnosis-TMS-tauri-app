import fs from "node:fs/promises";
import {
  buildContentSignature,
  hashJson,
  openAlignmentJob,
  sha256,
  stageSignatureHash,
} from "./cache_progress.mjs";

const root = "/Users/hans/Desktop/GnosisTMS/alignment-lab";
const sourcePath = `${root}/fixtures/source.txt`;
const targetPath = `${root}/fixtures/target.txt`;
const sparseDpPath = `${root}/section-sparse-dp.json`;
const apiKeyPath = `${root}/openai-api-key.txt`;
const candidatePath = `${root}/row-alignment-candidates.json`;
const mergedPath = `${root}/row-alignment-merged.json`;
const conflictsPath = `${root}/chunk-conflicts.json`;
const htmlPath = `${root}/multi-row-alignment-report.html`;

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
  return value;
}

const model = argValue("--model", "gpt-5.5");
const maxRows = Number(argValue("--max-rows", "250"));
const chunkSize = Number(argValue("--chunk-size", "50"));
const stride = Number(argValue("--stride", "25"));
const sourceLanguage = argValue("--source-language", "Spanish");
const targetLanguage = argValue("--target-language", "Vietnamese");
const jobId = argValue("--job-id", `row-level-${maxRows}`);
const forceRows = process.argv.includes("--force-rows");
const forceConflicts = process.argv.includes("--force-conflicts");

let cachedApiKey = null;
async function getApiKey() {
  if (cachedApiKey !== null) return cachedApiKey;
  cachedApiKey = (await fs.readFile(apiKeyPath, "utf8")).trim();
  if (!cachedApiKey) throw new Error(`${apiKeyPath} is empty`);
  return cachedApiKey;
}

function parseUnits(text, limit) {
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ text: line.trim(), originalLineNumber: index + 1 }))
    .filter((unit) => unit.text.length > 0)
    .slice(0, limit)
    .map((unit, index) => ({ id: index + 1, text: unit.text, originalLineNumber: unit.originalLineNumber }));
}

function makeSections(units, docRole) {
  const sections = [];
  for (let startIndex = 0; startIndex < units.length; startIndex += stride) {
    const sectionUnits = units.slice(startIndex, startIndex + chunkSize);
    if (sectionUnits.length === 0) break;
    sections.push({
      sectionId: sections.length + 1,
      docRole,
      unitRange: [sectionUnits[0].id, sectionUnits.at(-1).id],
      sectionContentHash: hashJson(sectionUnits.map((unit) => unit.text)),
      units: sectionUnits,
    });
    if (startIndex + chunkSize >= units.length) break;
  }
  return sections;
}

function unitsInSections(sections) {
  const byId = new Map();
  for (const section of sections) {
    for (const unit of section.units) byId.set(unit.id, unit);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

function sourceExpansionSections(sourceSectionId, sourceSections) {
  return [sourceSectionId - 1, sourceSectionId, sourceSectionId + 1]
    .filter((id) => id >= 1 && id <= sourceSections.length)
    .map((id) => sourceSections[id - 1]);
}

function buildAlignmentPrompt(sourceUnits, targetUnits) {
  const input = JSON.stringify({ sourceUnits, targetUnits }, null, 2);
  return `You align translated target-language text units to authoritative source-language text units.

Rules:
- Return JSON matching the provided schema.
- Return every target unit exactly once.
- For each target unit, return only the targetId and sourceIds.
- Use sourceIds: [] when the target unit has no corresponding source text.
- Multiple target units may reference the same source id when one source unit is split across target units.
- One target unit may reference multiple source ids when it combines source units.
- Use only ids from the input. Do not copy, quote, rewrite, or translate any text in the response.
- Preserve the semantic reading order of sourceIds.

Input:
${input}`;
}

const alignmentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["alignments"],
  properties: {
    alignments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["targetId", "sourceIds"],
        properties: {
          targetId: { type: "integer", minimum: 1 },
          sourceIds: { type: "array", items: { type: "integer", minimum: 1 } },
        },
      },
    },
  },
};

const conflictSchema = {
  type: "object",
  additionalProperties: false,
  required: ["targetId", "sourceIds"],
  properties: {
    targetId: { type: "integer", minimum: 1 },
    sourceIds: { type: "array", items: { type: "integer", minimum: 1 } },
  },
};

async function openaiStructured({ schemaName, schema, prompt }) {
  const apiKey = await getApiKey();
  const body = {
    model,
    input: prompt,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: schemaName,
        strict: true,
        schema,
      },
    },
  };

  let response;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "alignment-lab-row-level-corridor",
        },
        body: JSON.stringify(body),
      });
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      console.error(`OpenAI request failed before response on attempt ${attempt}; retrying`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }

  const responseText = await response.text();
  if (!response.ok) throw new Error(`OpenAI request failed ${response.status}: ${responseText}`);
  const envelope = JSON.parse(responseText);
  let outputText = envelope.output_text;
  if (!outputText) {
    for (const output of envelope.output ?? []) {
      for (const content of output.content ?? []) {
        if (content.type === "output_text" && content.text) outputText = content.text;
      }
    }
  }
  if (!outputText) throw new Error("OpenAI returned no output text");
  return JSON.parse(outputText);
}

function validateAlignments(response, sourceUnits, targetUnits) {
  const sourceIds = new Set(sourceUnits.map((unit) => unit.id));
  const targetIds = new Set(targetUnits.map((unit) => unit.id));
  const seen = new Set();
  const byTarget = new Map();

  for (const alignment of response.alignments ?? []) {
    if (!targetIds.has(alignment.targetId)) throw new Error(`Returned unknown target id ${alignment.targetId}`);
    if (seen.has(alignment.targetId)) throw new Error(`Returned duplicate target id ${alignment.targetId}`);
    seen.add(alignment.targetId);
    for (const sourceId of alignment.sourceIds) {
      if (!sourceIds.has(sourceId)) throw new Error(`Returned unknown source id ${sourceId} for target ${alignment.targetId}`);
    }
    byTarget.set(alignment.targetId, {
      targetId: alignment.targetId,
      sourceIds: normalizeSourceIds(alignment.sourceIds),
    });
  }

  const missing = [...targetIds].filter((targetId) => !seen.has(targetId));
  if (missing.length > 0) throw new Error(`Missing target ids: ${missing.join(", ")}`);
  return [...targetIds].sort((a, b) => a - b).map((targetId) => byTarget.get(targetId));
}

function normalizeSourceIds(sourceIds) {
  return [...new Set(sourceIds)].sort((a, b) => a - b);
}

function sourceKey(sourceIds) {
  return normalizeSourceIds(sourceIds).join(",");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildConflictPrompt({ targetUnit, candidateSourceIds, sourceUnits, candidates }) {
  const input = JSON.stringify({ targetUnit, candidateSourceIds, sourceUnits, candidates }, null, 2);
  return `Resolve conflicting row-level alignment candidates.

Rules:
- Choose the source ids from sourceUnits that match the targetUnit.
- Return JSON matching the provided schema.
- Return only targetId and sourceIds.
- sourceIds may be [] if no source unit corresponds to the target.
- sourceIds may include multiple source units when the target combines source units.
- Use only ids from sourceUnits.
- Do not copy, quote, rewrite, or translate any text in the response.

Input:
${input}`;
}

function fallbackCandidate(candidates) {
  const grouped = new Map();
  for (const candidate of candidates) {
    const key = sourceKey(candidate.sourceIds);
    const current = grouped.get(key) ?? {
      sourceIds: normalizeSourceIds(candidate.sourceIds),
      count: 0,
      centerlineCount: 0,
      maxOverlap: 0,
    };
    current.count += 1;
    if (candidate.isCenterlineSection) current.centerlineCount += 1;
    current.maxOverlap = Math.max(current.maxOverlap, candidate.estimatedOverlapPercent ?? 0);
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((a, b) => {
    const scoreA = a.count * 1000 + a.centerlineCount * 100 + a.maxOverlap + (a.sourceIds.length > 0 ? 10 : 0);
    const scoreB = b.count * 1000 + b.centerlineCount * 100 + b.maxOverlap + (b.sourceIds.length > 0 ? 10 : 0);
    return scoreB - scoreA;
  })[0].sourceIds;
}

function sourceRegionForConflict(candidates, sourceUnits) {
  const ids = candidates.flatMap((candidate) => candidate.sourceIds);
  if (ids.length === 0) return [];
  const min = Math.max(1, Math.min(...ids) - 1);
  const max = Math.min(sourceUnits.length, Math.max(...ids) + 1);
  return sourceUnits.filter((unit) => unit.id >= min && unit.id <= max);
}

async function resolveConflict({ targetUnit, candidates, sourceUnits, conflictCache }) {
  const distinctCandidateSourceIds = [...new Map(candidates.map((candidate) => [sourceKey(candidate.sourceIds), normalizeSourceIds(candidate.sourceIds)])).values()];
  const sourceRegion = sourceRegionForConflict(candidates, sourceUnits);
  if (sourceRegion.length === 0) {
    return { sourceIds: [], resolution: "fallback_empty_region", error: "No non-empty candidate source ids." };
  }

  const cacheKey = sha256(JSON.stringify({ targetId: targetUnit.id, distinctCandidateSourceIds, sourceRegion: sourceRegion.map((unit) => unit.id) }));
  if (conflictCache.resolutions[cacheKey] && !forceConflicts) {
    return { ...conflictCache.resolutions[cacheKey], resolution: "cached_resolver" };
  }

  try {
    const prompt = buildConflictPrompt({
      targetUnit,
      candidateSourceIds: distinctCandidateSourceIds,
      sourceUnits: sourceRegion,
      candidates: candidates.map((candidate) => ({
        sectionRunId: candidate.sectionRunId,
        sourceIds: candidate.sourceIds,
        isCenterlineSection: candidate.isCenterlineSection,
        estimatedOverlapPercent: candidate.estimatedOverlapPercent,
      })),
    });
    const response = await openaiStructured({
      schemaName: "row_conflict_resolution",
      schema: conflictSchema,
      prompt,
    });
    if (response.targetId !== targetUnit.id) throw new Error(`Resolver returned targetId ${response.targetId}`);
    const regionIds = new Set(sourceRegion.map((unit) => unit.id));
    for (const sourceId of response.sourceIds) {
      if (!regionIds.has(sourceId)) throw new Error(`Resolver returned source id ${sourceId} outside conflict region`);
    }
    const sourceIds = normalizeSourceIds(response.sourceIds);
    const result = {
      sourceIds,
      resolution: "resolver",
      promptHash: sha256(prompt),
      candidateSourceIds: distinctCandidateSourceIds,
      sourceRegion: sourceRegion.map((unit) => unit.id),
    };
    conflictCache.resolutions[cacheKey] = result;
    await fs.writeFile(conflictsPath, JSON.stringify(conflictCache, null, 2));
    return result;
  } catch (error) {
    const sourceIds = fallbackCandidate(candidates);
    const result = {
      sourceIds,
      resolution: "fallback_after_resolver_error",
      error: String(error.message ?? error),
      candidateSourceIds: distinctCandidateSourceIds,
      sourceRegion: sourceRegion.map((unit) => unit.id),
    };
    conflictCache.errors.push({ targetId: targetUnit.id, ...result });
    await fs.writeFile(conflictsPath, JSON.stringify(conflictCache, null, 2));
    return result;
  }
}

function buildPreviewModel({ sourceUnits, targetUnits, alignments }) {
  const targetById = new Map(targetUnits.map((unit) => [unit.id, unit]));
  const targetFirstSource = new Map(
    alignments
      .filter((alignment) => alignment.sourceIds.length > 0)
      .map((alignment) => [alignment.targetId, alignment.sourceIds[0]])
  );
  const targetsBySource = new Map();
  const unaligned = [];
  const targetOccurrences = new Map();
  const unresolvedSplitTargetIds = [];

  function makeTargetBlock(alignment, target) {
    targetOccurrences.set(target.id, (targetOccurrences.get(target.id) ?? 0) + 1);
    return {
      targetId: target.id,
      text: target.text,
      splitUnresolved: alignment.sourceIds.length > 1,
    };
  }

  for (const alignment of alignments) {
    const target = targetById.get(alignment.targetId);
    if (!target) continue;
    if (alignment.sourceIds.length === 0) {
      targetOccurrences.set(target.id, (targetOccurrences.get(target.id) ?? 0) + 1);
      unaligned.push({
        slot: inferUnalignedSlot(target.id, targetUnits, targetFirstSource, sourceUnits.length),
        targetBlock: { targetId: target.id, text: target.text, splitUnresolved: false },
      });
      continue;
    }
    if (alignment.sourceIds.length > 1) unresolvedSplitTargetIds.push(alignment.targetId);
    for (const sourceId of alignment.sourceIds) {
      if (!targetsBySource.has(sourceId)) targetsBySource.set(sourceId, []);
      targetsBySource.get(sourceId).push(makeTargetBlock(alignment, target));
    }
  }
  const unalignedBySlot = new Map();
  for (const row of unaligned) {
    if (!unalignedBySlot.has(row.slot)) unalignedBySlot.set(row.slot, []);
    unalignedBySlot.get(row.slot).push(row.targetBlock);
  }

  const rows = [];
  const sourceTexts = [];
  const targetTexts = [];

  function pushRow(row) {
    rows.push(row);
    if (row.source) sourceTexts.push(row.source.text);
    for (const targetBlock of row.targetBlocks) targetTexts.push(targetBlock.text);
  }

  for (let index = 0; index < sourceUnits.length; index += 1) {
    for (const targetBlock of (unalignedBySlot.get(index) ?? []).sort((a, b) => a.targetId - b.targetId)) {
      pushRow({ source: null, targetBlocks: [targetBlock] });
    }
    const source = sourceUnits[index];
    const targetBlocks = (targetsBySource.get(source.id) ?? []).sort((a, b) => a.targetId - b.targetId);
    pushRow({ source, targetBlocks });
  }
  for (const targetBlock of (unalignedBySlot.get(sourceUnits.length) ?? []).sort((a, b) => a.targetId - b.targetId)) {
    pushRow({ source: null, targetBlocks: [targetBlock] });
  }

  return {
    rows,
    sourceTexts,
    targetTexts,
    targetOccurrences,
    unresolvedSplitTargetIds: [...new Set(unresolvedSplitTargetIds)].sort((a, b) => a - b),
  };
}

function renderAlignmentHtml({ previewModel, finalChecks, modelId, sourceCount, targetCount }) {
  function renderTargetBlocks(targetBlocks) {
    if (targetBlocks.length === 0) return '<span class="empty">No target unit aligned</span>';
    return targetBlocks
      .map((target) => {
        const warning = target.splitUnresolved
          ? '<span class="target-warning">Split target unresolved</span>'
          : "";
        return `<div class="target-unit"><span class="id">T${target.targetId}</span>${escapeHtml(target.text)}${warning}</div>`;
      })
      .join("\n");
  }

  const rows = previewModel.rows.map((row) => {
    const sourceCell = row.source
      ? `<span class="id">S${row.source.id}</span>${escapeHtml(row.source.text)}`
      : '<span class="empty">No source unit aligned</span>';
    return `<tr><td>${sourceCell}</td><td>${renderTargetBlocks(row.targetBlocks)}</td></tr>`;
  });

  const failedChecks = finalChecks.filter((check) => !check.passed).map((check) => check.name);
  const warnings = finalChecks.filter((check) => check.warning && check.details.length > 0);
  const checksHtml =
    failedChecks.length === 0
      ? '<div class="checks">Final checks: passed</div>'
      : `<div class="checks checks-failed">Final checks failed: ${escapeHtml(failedChecks.join(", "))}</div>`;
  const warningsHtml = warnings.length
    ? `<div class="checks checks-warning">Warnings: ${escapeHtml(warnings.map((check) => `${check.name} (${check.details.length})`).join(", "))}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Multi-Chunk Alignment Report</title>
<style>
body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#18212f;background:#f7f8fb;}
main{padding:20px;max-width:1500px;margin:0 auto;}
h1{font-size:22px;margin:0 0 6px;}
.meta{color:#5b6472;font-size:13px;margin:0 0 18px;}
.checks{display:inline-block;margin:0 0 14px;padding:5px 8px;border:1px solid #b8d8c2;background:#eef8f1;color:#176033;font-size:13px;font-weight:700;}
.checks-failed{border-color:#efb4ac;background:#fff1ef;color:#9d2b1e;}
.checks-warning{margin-left:8px;border-color:#e7ca80;background:#fff8e6;color:#765200;}
table{width:100%;border-collapse:collapse;table-layout:fixed;background:#fff;border:1px solid #d7deea;}
th,td{border-bottom:1px solid #e7ebf2;vertical-align:top;text-align:left;padding:10px 12px;line-height:1.5;white-space:pre-wrap;}
th{position:sticky;top:0;background:#eef2f7;z-index:1;font-size:13px;}
.id{display:inline-block;min-width:42px;color:#697386;font-size:12px;font-weight:700;}
.target-unit+.target-unit{margin-top:8px;}
.target-warning{display:block;margin-top:4px;color:#9d5d00;font-size:12px;font-weight:700;}
.empty{color:#9aa3b2;}
</style>
</head>
<body><main>
<h1>Multi-Chunk Alignment Report</h1>
<p class="meta">Model: ${escapeHtml(modelId)} &nbsp; Rows: first ${sourceCount} source / ${targetCount} target</p>
${checksHtml}${warningsHtml}
<table><thead><tr><th>Source</th><th>Aligned Target</th></tr></thead><tbody>
${rows.join("\n")}
</tbody></table>
</main></body></html>`;
}

function inferUnalignedSlot(targetId, targetUnits, targetFirstSource, sourceCount) {
  const previous = [...targetUnits].reverse().find((unit) => unit.id < targetId && targetFirstSource.has(unit.id));
  const next = targetUnits.find((unit) => unit.id > targetId && targetFirstSource.has(unit.id));
  if (previous) return Math.min(targetFirstSource.get(previous.id), sourceCount);
  if (next) return Math.max(0, Math.min(targetFirstSource.get(next.id) - 1, sourceCount));
  return sourceCount;
}

function normalizeIgnoringWhitespace(text) {
  return text.replace(/\s+/gu, "");
}

function finalChecks(sourceUnits, targetUnits, previewModel) {
  const inputSourceText = normalizeIgnoringWhitespace(sourceUnits.map((unit) => unit.text).join(""));
  const outputSourceText = normalizeIgnoringWhitespace(previewModel.sourceTexts.join(""));
  const outputTargetText = previewModel.targetTexts.join(" ");
  const missing = [];
  const counts = new Map();
  for (const token of targetUnits.flatMap((unit) => unit.text.split(/\s+/).filter(Boolean))) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const outputCounts = new Map();
  for (const token of outputTargetText.split(/\s+/).filter(Boolean)) {
    outputCounts.set(token, (outputCounts.get(token) ?? 0) + 1);
  }
  for (const [token, count] of counts) {
    if ((outputCounts.get(token) ?? 0) < count) missing.push(`${token}: expected ${count}, found ${outputCounts.get(token) ?? 0}`);
  }
  const duplicateTargetDetails = [...previewModel.targetOccurrences.entries()]
    .filter(([, count]) => count > 1)
    .map(([targetId, count]) => `T${targetId}: displayed ${count} times`);
  return [
    {
      name: "sourceTextCoverage",
      passed: inputSourceText === outputSourceText,
      details: inputSourceText === outputSourceText
        ? []
        : [`input chars ${inputSourceText.length}, output chars ${outputSourceText.length}`],
    },
    { name: "targetWordCoverage", passed: missing.length === 0, details: missing },
    {
      name: "duplicatedTargetText",
      passed: true,
      warning: duplicateTargetDetails.length > 0,
      details: duplicateTargetDetails,
    },
  ];
}

function validateSparseDpForCurrentInput(sparseDp, sourceSections, targetSections) {
  const sourceSummaryById = new Map((sparseDp.sourceSummaries ?? []).map((summary) => [summary.sectionId, summary]));
  const targetSummaryById = new Map((sparseDp.targetSummaries ?? []).map((summary) => [summary.sectionId, summary]));
  const mismatches = [];

  function validateSection(section, summary, label) {
    if (!summary) {
      mismatches.push(`${label}${section.sectionId}: missing from ${sparseDpPath}`);
      return;
    }
    if (summary.unitRange?.[0] !== section.unitRange[0] || summary.unitRange?.[1] !== section.unitRange[1]) {
      mismatches.push(`${label}${section.sectionId}: unit range changed`);
    }
    if (summary.sectionContentHash !== section.sectionContentHash) {
      mismatches.push(`${label}${section.sectionId}: content hash changed`);
    }
  }

  for (const section of sourceSections) validateSection(section, sourceSummaryById.get(section.sectionId), "S");
  for (const section of targetSections) validateSection(section, targetSummaryById.get(section.sectionId), "T");

  if (mismatches.length > 0) {
    throw new Error(
      `Stale section corridor: ${sparseDpPath} does not match the current parsed input. ` +
      `Regenerate section summaries and sparse DP before row-level alignment. Details: ${mismatches.slice(0, 8).join("; ")}`
    );
  }
}

const sourceRawText = await fs.readFile(sourcePath, "utf8");
const targetRawText = await fs.readFile(targetPath, "utf8");
const sourceUnits = parseUnits(sourceRawText, maxRows);
const targetUnits = parseUnits(targetRawText, maxRows);
const sourceSections = makeSections(sourceUnits, "source");
const targetSections = makeSections(targetUnits, "target");
const sparseDp = JSON.parse(await fs.readFile(sparseDpPath, "utf8"));
validateSparseDpForCurrentInput(sparseDp, sourceSections, targetSections);
const sectionCorridor = (sparseDp.sectionCorridor ?? []).filter(
  (row) => row.targetSectionId <= targetSections.length
);
const signature = {
  ...buildContentSignature({
    sourceUnits,
    targetUnits,
    targetRawText,
    sourceLanguage,
    targetLanguage,
    chunkSize,
    stride,
    models: {
      rowAlignment: model,
      conflictResolver: model,
      splitTarget: null,
    },
    promptVersions: {
      rowAlignment: "row-align-v1",
      conflictResolver: "row-conflict-v1",
      splitTarget: "whole-target-fallback-v1",
    },
    htmlRendererVersion: "alignment-preview-v2",
    finalCheckVersion: "coverage-checks-v2",
  }),
  chunkSize,
  stride,
  maxRows,
  corridorHash: hashJson(sectionCorridor),
};
const legacySignature = {
  model,
  maxRows,
  chunkSize,
  stride,
  sourceHash: sha256(JSON.stringify(sourceUnits)),
  targetHash: sha256(JSON.stringify(targetUnits)),
  corridorHash: sha256(JSON.stringify(sectionCorridor)),
};
function signatureMatches(cache, stageId) {
  if (!cache?.signature) return false;
  try {
    if (stageSignatureHash(cache.signature, stageId) === stageSignatureHash(signature, stageId)) {
      return true;
    }
  } catch {
  }
  return JSON.stringify(cache.signature) === JSON.stringify(legacySignature);
}
const job = await openAlignmentJob({ root, jobId, signature });

await job.emit("prepare_units", {
  status: "complete",
  completed: sourceUnits.length + targetUnits.length,
  total: sourceUnits.length + targetUnits.length,
  message: `Prepared ${sourceUnits.length} source units and ${targetUnits.length} target units`,
});
await job.emit("build_sections", {
  status: "complete",
  completed: sourceSections.length + targetSections.length,
  total: sourceSections.length + targetSections.length,
  message: `Built ${sourceSections.length} source sections and ${targetSections.length} target sections`,
});
await job.emit("select_corridor", {
  status: "cached",
  completed: sectionCorridor.length,
  total: targetSections.length,
  cached: sectionCorridor.length,
  message: `Loaded selected corridor from ${sparseDpPath}`,
});

let candidateCache = null;
try {
  candidateCache = JSON.parse(await fs.readFile(candidatePath, "utf8"));
} catch {
}
if (forceRows || !candidateCache || !signatureMatches(candidateCache, "row_alignment")) {
  candidateCache = { signature, sectionRuns: [], candidates: [] };
} else {
  candidateCache.signature = signature;
}
const runById = new Map(candidateCache.sectionRuns.map((run) => [run.sectionRunId, run]));
const totalRowRuns = sectionCorridor.reduce((total, corridorRow) => {
  if (corridorRow.targetSectionId > targetSections.length) return total;
  const count = corridorRow.sourceSectionIds.filter((sourceId) => sourceId <= sourceSections.length).length;
  return total + (count === 0 ? 1 : count);
}, 0);
let completedRowRuns = 0;
let cachedRowRuns = 0;
await job.emit("row_alignment", {
  status: "running",
  completed: completedRowRuns,
  total: totalRowRuns,
  cached: cachedRowRuns,
  message: "Starting row-level alignment for selected corridor pairs",
});

for (const corridorRow of sectionCorridor) {
  const targetSection = targetSections[corridorRow.targetSectionId - 1];
  if (!targetSection) continue;
  const corridorSourceIds = corridorRow.sourceSectionIds.filter((sourceId) => sourceId <= sourceSections.length);
  if (corridorSourceIds.length === 0) {
    const sectionRunId = `t${corridorRow.targetSectionId}-null`;
    if (runById.has(sectionRunId)) {
      cachedRowRuns += 1;
      completedRowRuns += 1;
      await job.cacheHit("row_alignment");
      await job.emit("row_alignment", {
        status: "running",
        completed: completedRowRuns,
        total: totalRowRuns,
        cached: cachedRowRuns,
        message: `Loaded cached unaligned row run ${sectionRunId}`,
      });
    } else {
      const candidates = targetSection.units.map((targetUnit) => ({
        targetId: targetUnit.id,
        sourceIds: [],
        targetSectionId: corridorRow.targetSectionId,
        sourceSectionId: null,
        sourceExpansionRange: [],
        sectionRunId,
        isCenterlineSection: corridorRow.centerlineSourceSectionId === null,
        estimatedOverlapPercent: 0,
      }));
      const run = { sectionRunId, targetSectionId: corridorRow.targetSectionId, sourceSectionId: null, candidates };
      candidateCache.sectionRuns.push(run);
      candidateCache.candidates.push(...candidates);
      runById.set(sectionRunId, run);
      await fs.writeFile(candidatePath, JSON.stringify(candidateCache, null, 2));
      completedRowRuns += 1;
      await job.emit("row_alignment", {
        status: "running",
        completed: completedRowRuns,
        total: totalRowRuns,
        cached: cachedRowRuns,
        message: `Created unaligned row run ${sectionRunId}`,
      });
    }
    continue;
  }

  for (const sourceSectionId of corridorSourceIds) {
    const sectionRunId = `t${corridorRow.targetSectionId}-s${sourceSectionId}`;
    if (runById.has(sectionRunId)) {
      console.error(`Using cached row run ${sectionRunId}`);
      cachedRowRuns += 1;
      completedRowRuns += 1;
      await job.cacheHit("row_alignment");
      await job.emit("row_alignment", {
        status: "running",
        completed: completedRowRuns,
        total: totalRowRuns,
        cached: cachedRowRuns,
        message: `Loaded cached row run ${sectionRunId}`,
      });
      continue;
    }
    const expansionSections = sourceExpansionSections(sourceSectionId, sourceSections);
    const sourceInputUnits = unitsInSections(expansionSections);
    const targetInputUnits = targetSection.units;
    const prompt = buildAlignmentPrompt(sourceInputUnits, targetInputUnits);
    console.error(`Running row alignment ${sectionRunId}: target rows ${targetInputUnits[0].id}-${targetInputUnits.at(-1).id}, source rows ${sourceInputUnits[0].id}-${sourceInputUnits.at(-1).id}`);
    const response = await openaiStructured({
      schemaName: "row_alignment_response",
      schema: alignmentSchema,
      prompt,
    });
    await job.apiCall("row_alignment");
    const alignments = validateAlignments(response, sourceInputUnits, targetInputUnits);
    const match = corridorRow.matches.find((item) => item.sourceSectionId === sourceSectionId);
    const candidates = alignments.map((alignment) => ({
      targetId: alignment.targetId,
      sourceIds: alignment.sourceIds,
      targetSectionId: corridorRow.targetSectionId,
      sourceSectionId,
      sourceExpansionRange: [sourceInputUnits[0].id, sourceInputUnits.at(-1).id],
      sectionRunId,
      isCenterlineSection: corridorRow.centerlineSourceSectionId === sourceSectionId,
      estimatedOverlapPercent: match?.estimatedOverlapPercent ?? 0,
    }));
    const run = {
      sectionRunId,
      promptHash: sha256(prompt),
      targetSectionId: corridorRow.targetSectionId,
      sourceSectionId,
      sourceExpansionRange: [sourceInputUnits[0].id, sourceInputUnits.at(-1).id],
      candidates,
    };
    candidateCache.sectionRuns.push(run);
    candidateCache.candidates.push(...candidates);
    runById.set(sectionRunId, run);
    await fs.writeFile(candidatePath, JSON.stringify(candidateCache, null, 2));
    completedRowRuns += 1;
    await job.emit("row_alignment", {
      status: "running",
      completed: completedRowRuns,
      total: totalRowRuns,
      cached: cachedRowRuns,
      message: `Aligned ${sectionRunId}`,
    });
  }
}
await job.emit("row_alignment", {
  status: "complete",
  completed: completedRowRuns,
  total: totalRowRuns,
  cached: cachedRowRuns,
  message: `Completed ${completedRowRuns} row-level section runs`,
});

let conflictCache = { signature, resolutions: {}, errors: [] };
try {
  const parsed = JSON.parse(await fs.readFile(conflictsPath, "utf8"));
  if (!forceConflicts && signatureMatches(parsed, "resolve_conflicts")) {
    conflictCache = parsed;
    conflictCache.signature = signature;
  }
} catch {
}

const candidatesByTarget = new Map();
for (const candidate of candidateCache.candidates) {
  if (!candidatesByTarget.has(candidate.targetId)) candidatesByTarget.set(candidate.targetId, []);
  candidatesByTarget.get(candidate.targetId).push({ ...candidate, sourceIds: normalizeSourceIds(candidate.sourceIds) });
}

const mergeInputs = targetUnits.map((targetUnit) => {
  const candidates = candidatesByTarget.get(targetUnit.id) ?? [];
  const distinct = [...new Set(candidates.map((candidate) => sourceKey(candidate.sourceIds)))];
  return { targetUnit, candidates, distinct };
});
const conflictTotal = mergeInputs.filter((input) => input.distinct.length > 1).length;
const mergedAlignments = [];
const mergeRows = [];
let mergedCount = 0;
let resolvedConflictCount = 0;
await job.emit("merge_rows", {
  status: "running",
  completed: mergedCount,
  total: targetUnits.length,
  message: "Merging row-level alignment candidates",
});
await job.emit("resolve_conflicts", {
  status: conflictTotal === 0 ? "complete" : "running",
  completed: resolvedConflictCount,
  total: conflictTotal,
  message: conflictTotal === 0 ? "No row-level conflicts found" : `Resolving ${conflictTotal} row-level conflicts`,
});

for (const { targetUnit, candidates, distinct } of mergeInputs) {
  if (candidates.length === 0) {
    mergedAlignments.push({ targetId: targetUnit.id, sourceIds: [] });
    mergeRows.push({ targetId: targetUnit.id, acceptedSourceIds: [], status: "missing_candidates", candidates: [] });
    mergedCount += 1;
    if (mergedCount % 25 === 0 || mergedCount === targetUnits.length) {
      await job.emit("merge_rows", {
        status: "running",
        completed: mergedCount,
        total: targetUnits.length,
        message: `Merged ${mergedCount} / ${targetUnits.length} target rows`,
      });
    }
    continue;
  }
  if (distinct.length === 1) {
    const sourceIds = normalizeSourceIds(candidates[0].sourceIds);
    mergedAlignments.push({ targetId: targetUnit.id, sourceIds });
    mergeRows.push({
      targetId: targetUnit.id,
      acceptedSourceIds: sourceIds,
      status: sourceIds.length === 0 ? "agreed_unaligned" : "agreed",
      candidates,
    });
    mergedCount += 1;
    if (mergedCount % 25 === 0 || mergedCount === targetUnits.length) {
      await job.emit("merge_rows", {
        status: "running",
        completed: mergedCount,
        total: targetUnits.length,
        message: `Merged ${mergedCount} / ${targetUnits.length} target rows`,
      });
    }
    continue;
  }
  console.error(`Resolving conflict for target T${targetUnit.id}: ${distinct.map((key) => `[${key}]`).join(" vs ")}`);
  await job.emit("resolve_conflicts", {
    status: "running",
    completed: resolvedConflictCount,
    total: conflictTotal,
    message: `Resolving conflict for target T${targetUnit.id}`,
  });
  const resolution = await resolveConflict({ targetUnit, candidates, sourceUnits, conflictCache });
  if (resolution.resolution === "resolver") {
    await job.apiCall("resolve_conflicts");
  } else if (resolution.resolution === "cached_resolver") {
    await job.cacheHit("resolve_conflicts");
  }
  resolvedConflictCount += 1;
  await job.emit("resolve_conflicts", {
    status: "running",
    completed: resolvedConflictCount,
    total: conflictTotal,
    message: `Resolved conflict for target T${targetUnit.id}`,
  });
  mergedAlignments.push({ targetId: targetUnit.id, sourceIds: resolution.sourceIds });
  mergeRows.push({
    targetId: targetUnit.id,
    acceptedSourceIds: resolution.sourceIds,
    status: resolution.resolution,
    candidates,
    resolver: resolution,
  });
  mergedCount += 1;
  if (mergedCount % 25 === 0 || mergedCount === targetUnits.length) {
    await job.emit("merge_rows", {
      status: "running",
      completed: mergedCount,
      total: targetUnits.length,
      message: `Merged ${mergedCount} / ${targetUnits.length} target rows`,
    });
  }
}
await job.emit("merge_rows", {
  status: "complete",
  completed: mergedCount,
  total: targetUnits.length,
  message: `Merged ${mergedCount} target rows`,
});
await job.emit("resolve_conflicts", {
  status: "complete",
  completed: resolvedConflictCount,
  total: conflictTotal,
  message: `Resolved ${resolvedConflictCount} row-level conflicts`,
});

const unresolvedSplitTargetIds = mergedAlignments
  .filter((alignment) => alignment.sourceIds.length > 1)
  .map((alignment) => alignment.targetId);
await job.emit("split_targets", {
  status: unresolvedSplitTargetIds.length === 0 ? "complete" : "warning",
  completed: 0,
  total: unresolvedSplitTargetIds.length,
  warningCount: unresolvedSplitTargetIds.length,
  message: unresolvedSplitTargetIds.length === 0
    ? "No combined target rows found"
    : `Split-target pass is not implemented in the multi-row runner; using whole-target fallback for ${unresolvedSplitTargetIds.length} target rows`,
});

const previewModel = buildPreviewModel({ sourceUnits, targetUnits, alignments: mergedAlignments });
const checks = finalChecks(sourceUnits, targetUnits, previewModel);
const mergedReport = {
  signature,
  sourceUnits,
  targetUnits,
  sectionCorridor,
  rowAlignmentCandidatesPath: candidatePath,
  conflictsPath,
  alignments: mergedAlignments,
  mergeRows,
  splitTargets: {
    status: unresolvedSplitTargetIds.length === 0 ? "none" : "whole_target_fallback",
    unresolvedTargetIds: unresolvedSplitTargetIds,
  },
  preview: {
    targetDuplicateWarnings: checks.find((check) => check.name === "duplicatedTargetText")?.details ?? [],
  },
  finalChecks: checks,
};
await fs.writeFile(mergedPath, JSON.stringify(mergedReport, null, 2));
await job.emit("build_preview", {
  status: "running",
  completed: 0,
  total: sourceUnits.length,
  message: "Rendering combined alignment preview",
});
await fs.writeFile(htmlPath, renderAlignmentHtml({
  previewModel,
  finalChecks: checks,
  modelId: model,
  sourceCount: sourceUnits.length,
  targetCount: targetUnits.length,
}));
await job.emit("build_preview", {
  status: "complete",
  completed: sourceUnits.length,
  total: sourceUnits.length,
  message: `Wrote ${htmlPath}`,
});
await job.emit("final_checks", {
  status: checks.every((check) => check.passed) ? "complete" : "warning",
  completed: checks.length,
  total: checks.length,
  warningCount: checks.filter((check) => !check.passed).length,
  message: checks.every((check) => check.passed)
    ? "Final checks passed"
    : `Final checks failed: ${checks.filter((check) => !check.passed).map((check) => check.name).join(", ")}`,
});

console.log(`Candidates: ${candidatePath}`);
console.log(`Merged: ${mergedPath}`);
console.log(`Conflicts: ${conflictsPath}`);
console.log(`HTML: file://${htmlPath}`);
console.log(`Job manifest: ${job.manifestPath}`);
