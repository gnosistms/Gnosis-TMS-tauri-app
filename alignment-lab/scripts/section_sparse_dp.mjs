import fs from "node:fs/promises";
import {
  buildContentSignature,
  hashJson,
  openAlignmentJob,
} from "./cache_progress.mjs";

const root = "/Users/hans/Desktop/GnosisTMS/alignment-lab";
const model = "gpt-5.5";
const promptVersion = "adaptive-sparse-overlap-top3-v1";
const summaryCachePath = `${root}/section-summary-cache.json`;
const candidatePath = `${root}/section-sparse-candidates.json`;
const expansionPath = `${root}/section-candidate-expansions.json`;
const labelPath = `${root}/section-sparse-labels.json`;
const dpPath = `${root}/section-sparse-dp.json`;
const htmlPath = `${root}/section-sparse-dp.html`;
const apiKeyPath = `${root}/openai-api-key.txt`;

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

const blockSize = Number(argValue("--block-size", "4"));
const anchorCount = Number(argValue("--anchor-count", "4"));
const maxExpansionBlocks = Number(argValue("--max-expansion-blocks", "20"));
const strongOverlapPercent = Number(argValue("--strong-overlap", "70"));
const jobId = argValue("--job-id", "section-sparse-dp");
const forceRelabel = hasFlag("--force-relabel");

let cachedApiKey = null;
async function getApiKey() {
  if (cachedApiKey !== null) return cachedApiKey;
  cachedApiKey = (await fs.readFile(apiKeyPath, "utf8")).trim();
  if (!cachedApiKey) {
    throw new Error(`${apiKeyPath} is empty`);
  }
  return cachedApiKey;
}

const summaryCache = JSON.parse(await fs.readFile(summaryCachePath, "utf8"));
if (summaryCache.summaryLanguageMode !== "input_language") {
  throw new Error(
    `Summary cache was not generated with same-language summaries. Regenerate it with: node alignment-lab/scripts/section_summary_cache.mjs --source-language Spanish --target-language Vietnamese`
  );
}

const sourceSummaries = summaryCache.sectionSummaries
  .filter((summary) => summary.docRole === "source")
  .sort((a, b) => a.sectionId - b.sectionId);
const targetSummaries = summaryCache.sectionSummaries
  .filter((summary) => summary.docRole === "target")
  .sort((a, b) => a.sectionId - b.sectionId);

if (sourceSummaries.length === 0 || targetSummaries.length === 0) {
  throw new Error("Summary cache does not contain both source and target summaries");
}

const sourceById = new Map(sourceSummaries.map((summary) => [summary.sectionId, summary]));
const sourceUnits = unitsFromSections(summaryCache.sourceSections ?? []);
const targetUnits = unitsFromSections(summaryCache.targetSections ?? []);

if (sourceUnits.length === 0 || targetUnits.length === 0) {
  throw new Error("Summary cache does not contain sourceSections and targetSections with units");
}

function unitsFromSections(sections) {
  const byId = new Map();
  for (const section of sections) {
    for (const unit of section.units ?? []) byId.set(unit.id, unit);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

function normalizeText(text) {
  return text.normalize("NFKC");
}

function anchorTokens(text) {
  const normalized = normalizeText(text);
  const digitTokens = normalized.match(/\p{Number}+/gu) ?? [];
  const namedTokens = normalized.match(/\b\p{Lu}[\p{Letter}\p{Mark}]{2,}\b/gu) ?? [];
  const quotedTokens = [...normalized.matchAll(/[“"']([^“"']{3,40})[”"']/gu)].map((match) => match[1]);
  return new Set(
    [...digitTokens, ...namedTokens, ...quotedTokens]
      .map((token) => token.toLocaleLowerCase())
      .filter((token) => token.length >= 2)
  );
}

const sourceAnchors = new Map(
  sourceSummaries.map((summary) => [summary.sectionId, anchorTokens(summary.summary)])
);
const targetAnchors = new Map(
  targetSummaries.map((summary) => [summary.sectionId, anchorTokens(summary.summary)])
);

function overlapCount(a, b) {
  let count = 0;
  for (const token of a) {
    if (b.has(token)) count += 1;
  }
  return count;
}

function expectedSourceIndex(targetIndex) {
  if (targetSummaries.length === 1 || sourceSummaries.length === 1) return 1;
  return Math.round(1 + ((targetIndex - 1) * (sourceSummaries.length - 1)) / (targetSummaries.length - 1));
}

function clampSourceId(sourceId) {
  return Math.max(1, Math.min(sourceSummaries.length, Math.round(sourceId)));
}

function blockAround(center) {
  const maxStart = Math.max(1, sourceSummaries.length - blockSize + 1);
  const start = Math.max(1, Math.min(maxStart, clampSourceId(center) - Math.floor((blockSize - 1) / 2)));
  const end = Math.min(sourceSummaries.length, start + blockSize - 1);
  const ids = [];
  for (let sourceId = start; sourceId <= end; sourceId += 1) ids.push(sourceId);
  return ids;
}

function blockKey(sourceSectionIds) {
  return sourceSectionIds.join(",");
}

function anchorCentersForTarget(targetSummary, expected) {
  const targetAnchorSet = targetAnchors.get(targetSummary.sectionId);
  return sourceSummaries
    .map((sourceSummary) => ({
      sourceId: sourceSummary.sectionId,
      score: overlapCount(targetAnchorSet, sourceAnchors.get(sourceSummary.sectionId)),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || Math.abs(a.sourceId - expected) - Math.abs(b.sourceId - expected))
    .slice(0, anchorCount)
    .map((candidate) => candidate.sourceId);
}

function searchBlocksForTarget(targetSummary, continuationSourceId) {
  const expected = expectedSourceIndex(targetSummary.sectionId);
  const centers = [];
  if (continuationSourceId !== null) centers.push({ reason: "continuation", center: continuationSourceId });
  centers.push({ reason: "global_expected", center: expected });
  for (const sourceId of anchorCentersForTarget(targetSummary, expected)) {
    centers.push({ reason: "anchor", center: sourceId });
  }

  const blocks = [];
  const seen = new Set();
  function addBlock(reason, ids, isStartingCenter = false) {
    const key = blockKey(ids);
    if (seen.has(key)) return;
    seen.add(key);
    blocks.push({ reason, sourceSectionIds: ids, isStartingCenter });
  }

  for (const center of centers) {
    addBlock(center.reason, blockAround(center.center), true);
  }

  const primaryCenter = centers[0]?.center ?? expected;
  let staleExpansionSteps = 0;
  for (let step = 1; blocks.length < maxExpansionBlocks; step += 1) {
    const before = blocks.length;
    addBlock(`expand_forward_${step}`, blockAround(primaryCenter + step * blockSize));
    if (blocks.length >= maxExpansionBlocks) break;
    addBlock(`expand_backward_${step}`, blockAround(primaryCenter - step * blockSize));
    staleExpansionSteps = blocks.length === before ? staleExpansionSteps + 1 : 0;
    if (staleExpansionSteps >= 2) break;
  }

  return {
    expectedSourceSectionId: expected,
    startingCenters: centers,
    blocks: blocks.slice(0, maxExpansionBlocks),
  };
}

function writeJson(path, value) {
  return fs.writeFile(path, JSON.stringify(value, null, 2));
}

function cacheSignature() {
  const sectionIdentity = (summary) => ({
    docRole: summary.docRole,
    sectionId: summary.sectionId,
    unitRange: summary.unitRange,
    language: summary.language,
    sectionContentHash: summary.sectionContentHash,
    model: summary.model,
    promptVersion: summary.promptVersion,
  });
  const summaryIdentity = (summary) => ({
    ...sectionIdentity(summary),
    summaryHash: hashJson(summary.summary ?? ""),
  });

  const baseSignature = buildContentSignature({
    sourceUnits,
    targetUnits,
    sourceLanguage: summaryCache.languages?.source,
    targetLanguage: summaryCache.languages?.target,
    chunkSize: summaryCache.chunkSize,
    stride: summaryCache.stride,
    models: {
      summary: summaryCache.model,
      sectionMatch: model,
    },
    promptVersions: {
      summary: summaryCache.promptVersion,
      sectionMatch: promptVersion,
    },
    dpVersion: "adaptive-sparse-dp-v1",
  });

  return {
    ...baseSignature,
    model,
    promptVersion,
    summaryCache: {
      signatureHash: hashJson(summaryCache.signature ?? {}),
      promptVersion: summaryCache.promptVersion,
      summaryLanguageMode: summaryCache.summaryLanguageMode,
      languages: summaryCache.languages,
      chunkSize: summaryCache.chunkSize,
      stride: summaryCache.stride,
      sourceSectionHash: hashJson(sourceSummaries.map(sectionIdentity)),
      targetSectionHash: hashJson(targetSummaries.map(sectionIdentity)),
      sourceSummaryHash: hashJson(sourceSummaries.map(summaryIdentity)),
      targetSummaryHash: hashJson(targetSummaries.map(summaryIdentity)),
    },
    options: {
      blockSize,
      anchorCount,
      maxExpansionBlocks,
      strongOverlapPercent,
    },
  };
}

function signaturesMatch(cache) {
  return hashJson(cache?.signature ?? null) === hashJson(signature);
}

const signature = cacheSignature();
const job = await openAlignmentJob({ root, jobId, signature });

async function openaiStructured({ name, schema, prompt }) {
  const apiKey = await getApiKey();
  const body = {
    model,
    input: prompt,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name,
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
          "User-Agent": "alignment-lab-section-adaptive-sparse-dp",
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
  if (!response.ok) {
    throw new Error(`OpenAI request failed ${response.status}: ${responseText}`);
  }

  const envelope = JSON.parse(responseText);
  let outputText = envelope.output_text;
  if (!outputText) {
    for (const output of envelope.output ?? []) {
      for (const content of output.content ?? []) {
        if (content.type === "output_text" && content.text) outputText = content.text;
      }
    }
  }
  if (!outputText) {
    throw new Error("OpenAI returned no output text");
  }
  return JSON.parse(outputText);
}

function matchSchemaFor() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["matches"],
    properties: {
      matches: {
        type: "array",
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["targetSectionId", "sourceSectionId", "estimatedOverlapPercent"],
          properties: {
            targetSectionId: { type: "integer", minimum: 1 },
            sourceSectionId: { type: "integer", minimum: 1 },
            estimatedOverlapPercent: { type: "integer", minimum: 1, maximum: 100 },
          },
        },
      },
    },
  };
}

function validateMatches(targetSummary, candidates, matches) {
  if (matches.length > 3) {
    throw new Error(`T${targetSummary.sectionId}: expected at most 3 matches, got ${matches.length}`);
  }
  const expectedSources = new Set(candidates.map((summary) => summary.sectionId));
  const bySource = new Map();
  for (const match of matches) {
    if (match.targetSectionId !== targetSummary.sectionId) {
      throw new Error(`T${targetSummary.sectionId}: returned targetSectionId ${match.targetSectionId}`);
    }
    if (!expectedSources.has(match.sourceSectionId)) {
      throw new Error(`T${targetSummary.sectionId}: returned non-candidate sourceSectionId ${match.sourceSectionId}`);
    }
    if (bySource.has(match.sourceSectionId)) {
      throw new Error(`T${targetSummary.sectionId}: duplicate sourceSectionId ${match.sourceSectionId}`);
    }
    bySource.set(match.sourceSectionId, {
      ...match,
      label: "match",
    });
  }
  return [...bySource.values()].sort((a, b) => b.estimatedOverlapPercent - a.estimatedOverlapPercent || a.sourceSectionId - b.sourceSectionId);
}

async function classifyBlock(targetSummary, sourceSectionIds) {
  const candidates = sourceSectionIds.map((sourceId) => sourceById.get(sourceId));
  const prompt = `Find overlapping source sections for one target-language section.

Match means the two sections contain overlapping translated/source rows. These are 50-row windows with 25-row stride, so each target row should have no more than 3 matching source sections.

Return only the matching candidates, up to 3 total, with estimatedOverlapPercent as the integer percent of the target section covered by that source section. Omit non-matching candidates. If none match, return an empty matches array. Do not explain.

Target section:
${JSON.stringify(targetSummary, null, 2)}

Candidate source sections:
${JSON.stringify(candidates, null, 2)}`;

  const result = await openaiStructured({
    name: "adaptive_sparse_section_overlap_matches",
    schema: matchSchemaFor(),
    prompt,
  });
  return validateMatches(targetSummary, candidates, result.matches);
}

let expansionCache = {
  model,
  signature,
  sourceSummaries,
  targetSummaries,
  rows: [],
};

try {
  const parsed = JSON.parse(await fs.readFile(expansionPath, "utf8"));
  if (!forceRelabel && signaturesMatch(parsed)) {
    expansionCache = parsed;
  }
} catch {
}

function rowCacheFor(targetSectionId) {
  let row = expansionCache.rows.find((item) => item.targetSectionId === targetSectionId);
  if (!row) {
    row = { targetSectionId, searchBlocks: [] };
    expansionCache.rows.push(row);
  }
  return row;
}

async function saveExpansionCache() {
  await writeJson(expansionPath, expansionCache);
}

function cachedBlock(row, sourceSectionIds) {
  const key = blockKey(sourceSectionIds);
  return row.searchBlocks.find((block) => block.key === key);
}

function bestContinuationSourceId(matches, fallback) {
  if (matches.length === 0) return fallback;
  const weighted = matches.reduce(
    (acc, match) => {
      acc.totalWeight += match.estimatedOverlapPercent;
      acc.weightedSource += match.sourceSectionId * match.estimatedOverlapPercent;
      return acc;
    },
    { totalWeight: 0, weightedSource: 0 }
  );
  return Math.round(weighted.weightedSource / weighted.totalWeight);
}

async function runAdaptiveSearch() {
  const candidateRows = [];
  const labelRows = [];
  let continuationSourceId = null;
  let completedTargets = 0;
  let cachedSearchBlocks = 0;

  await job.emit("find_section_matches", {
    status: "running",
    completed: completedTargets,
    total: targetSummaries.length,
    cached: cachedSearchBlocks,
    message: "Starting adaptive section match search",
  });

  for (const targetSummary of targetSummaries) {
    const searchPlan = searchBlocksForTarget(targetSummary, continuationSourceId);
    const rowCache = rowCacheFor(targetSummary.sectionId);
    rowCache.expectedSourceSectionId = searchPlan.expectedSourceSectionId;
    rowCache.startingCenters = searchPlan.startingCenters;
    const lastStartingBlockIndex = searchPlan.blocks.findLastIndex((block) => block.isStartingCenter);

    let finalMatches = [];
    let searchedAll = false;
    let stopReason = "search_exhausted";

    function addMatches(matches) {
      const bySource = new Map(finalMatches.map((match) => [match.sourceSectionId, match]));
      for (const match of matches) {
        const current = bySource.get(match.sourceSectionId);
        if (!current || match.estimatedOverlapPercent > current.estimatedOverlapPercent) {
          bySource.set(match.sourceSectionId, match);
        }
      }
      finalMatches = [...bySource.values()]
        .sort((a, b) => b.estimatedOverlapPercent - a.estimatedOverlapPercent || a.sourceSectionId - b.sourceSectionId)
        .slice(0, 3);
    }

    function hasStrongMatch() {
      return finalMatches.some((match) => match.estimatedOverlapPercent >= strongOverlapPercent);
    }

    for (let blockIndex = 0; blockIndex < searchPlan.blocks.length; blockIndex += 1) {
      const block = searchPlan.blocks[blockIndex];
      const existing = cachedBlock(rowCache, block.sourceSectionIds);
      let searchResult = existing;

      if (!searchResult) {
        console.error(`Searching T${targetSummary.sectionId} ${block.reason}: ${block.sourceSectionIds.map((id) => `S${id}`).join(", ")}`);
        const matches = await classifyBlock(targetSummary, block.sourceSectionIds);
        searchResult = {
          key: blockKey(block.sourceSectionIds),
          reason: block.reason,
          sourceSectionIds: block.sourceSectionIds,
          status: "searched",
          matches,
        };
        rowCache.searchBlocks.push(searchResult);
        await saveExpansionCache();
        await job.apiCall("find_section_matches");
      } else {
        console.error(`Using cached search T${targetSummary.sectionId} ${searchResult.reason}: ${searchResult.sourceSectionIds.map((id) => `S${id}`).join(", ")}`);
        cachedSearchBlocks += 1;
        await job.cacheHit("find_section_matches");
      }

      addMatches(searchResult.matches);
      if (blockIndex > lastStartingBlockIndex && hasStrongMatch()) {
        stopReason = "strong_match_found";
        break;
      }
      if (blockIndex >= lastStartingBlockIndex && hasStrongMatch()) {
        stopReason = "strong_starting_match_found";
        break;
      }
      searchedAll = blockIndex === searchPlan.blocks.length - 1;
    }

    candidateRows.push({
      targetSectionId: targetSummary.sectionId,
      expectedSourceSectionId: searchPlan.expectedSourceSectionId,
      startingCenters: searchPlan.startingCenters,
      searchedSourceSectionIds: [...new Set(rowCache.searchBlocks.flatMap((block) => block.sourceSectionIds))].sort((a, b) => a - b),
      stoppedBecause: finalMatches.length > 0
        ? (stopReason === "search_exhausted" ? "weak_matches_after_search_exhausted" : stopReason)
        : searchedAll ? "search_exhausted" : "search_stopped",
    });

    labelRows.push({
      targetSectionId: targetSummary.sectionId,
      matches: finalMatches,
    });

    continuationSourceId = bestContinuationSourceId(finalMatches, continuationSourceId);
    completedTargets += 1;
    await job.emit("find_section_matches", {
      status: "running",
      completed: completedTargets,
      total: targetSummaries.length,
      cached: cachedSearchBlocks,
      message: `Processed target section T${targetSummary.sectionId}`,
    });
  }

  await job.emit("find_section_matches", {
    status: "complete",
    completed: completedTargets,
    total: targetSummaries.length,
    cached: cachedSearchBlocks,
    message: `Completed adaptive section search for ${completedTargets} target sections`,
  });

  return { candidateRows, labelRows };
}

const { candidateRows, labelRows } = await runAdaptiveSearch();

const candidateCache = {
  model,
  signature,
  sourceSummaries,
  targetSummaries,
  rows: candidateRows,
};
await writeJson(candidatePath, candidateCache);

const labelCache = {
  model,
  signature,
  expansionPath,
  matrix: labelRows,
};
await writeJson(labelPath, labelCache);

function runSparseDp(rows) {
  const nullPenalty = 35;
  const backwardPenalty = 10_000;
  const jumpPenalty = 4;
  const matchBase = 60;
  const statesByTarget = rows.map((row) => {
    const matchStates = row.matches.map((match) => ({
      targetSectionId: row.targetSectionId,
      sourceSectionId: match.sourceSectionId,
      label: "match",
      estimatedOverlapPercent: match.estimatedOverlapPercent,
      localScore: matchBase + match.estimatedOverlapPercent,
    }));
    return [
      ...matchStates,
      {
        targetSectionId: row.targetSectionId,
        sourceSectionId: null,
        label: "null",
        estimatedOverlapPercent: 0,
        localScore: -nullPenalty,
      },
    ];
  });

  const dp = statesByTarget.map((states) =>
    states.map((state) => ({ state, score: Number.NEGATIVE_INFINITY, previousIndex: null }))
  );

  for (let stateIndex = 0; stateIndex < statesByTarget[0].length; stateIndex += 1) {
    dp[0][stateIndex].score = statesByTarget[0][stateIndex].localScore;
  }

  for (let targetIndex = 1; targetIndex < statesByTarget.length; targetIndex += 1) {
    for (let stateIndex = 0; stateIndex < statesByTarget[targetIndex].length; stateIndex += 1) {
      const state = statesByTarget[targetIndex][stateIndex];
      for (let previousIndex = 0; previousIndex < statesByTarget[targetIndex - 1].length; previousIndex += 1) {
        const previousState = statesByTarget[targetIndex - 1][previousIndex];
        let transitionPenalty = 0;
        if (state.sourceSectionId !== null && previousState.sourceSectionId !== null) {
          if (state.sourceSectionId < previousState.sourceSectionId) {
            transitionPenalty += backwardPenalty;
          } else {
            const jump = state.sourceSectionId - previousState.sourceSectionId;
            transitionPenalty += Math.max(0, jump - 1) * jumpPenalty;
          }
        }
        const score = dp[targetIndex - 1][previousIndex].score + state.localScore - transitionPenalty;
        if (score > dp[targetIndex][stateIndex].score) {
          dp[targetIndex][stateIndex].score = score;
          dp[targetIndex][stateIndex].previousIndex = previousIndex;
        }
      }
    }
  }

  let bestIndex = 0;
  const lastRow = dp.at(-1);
  for (let index = 1; index < lastRow.length; index += 1) {
    if (lastRow[index].score > lastRow[bestIndex].score) bestIndex = index;
  }

  const path = [];
  for (let targetIndex = dp.length - 1, stateIndex = bestIndex; targetIndex >= 0; targetIndex -= 1) {
    const cell = dp[targetIndex][stateIndex];
    path.push({
      targetSectionId: cell.state.targetSectionId,
      sourceSectionId: cell.state.sourceSectionId,
      label: cell.state.label,
      estimatedOverlapPercent: cell.state.estimatedOverlapPercent,
      localScore: cell.state.localScore,
      cumulativeScore: cell.score,
    });
    stateIndex = cell.previousIndex;
    if (stateIndex === null && targetIndex > 0) {
      throw new Error("DP backtrace failed");
    }
  }

  path.reverse();
  return {
    scoring: { nullPenalty, backwardPenalty, jumpPenalty, matchBase },
    totalScore: lastRow[bestIndex].score,
    centerlinePath: path,
    path,
  };
}

function buildSectionCorridor(rows, centerlinePath) {
  const centerlineByTarget = new Map(
    centerlinePath.map((step) => [step.targetSectionId, step.sourceSectionId])
  );

  return rows.map((row) => {
    const centerlineSourceSectionId = centerlineByTarget.get(row.targetSectionId) ?? null;
    const matches = row.matches
      .slice()
      .sort((a, b) => a.sourceSectionId - b.sourceSectionId)
      .map((match) => ({
        sourceSectionId: match.sourceSectionId,
        estimatedOverlapPercent: match.estimatedOverlapPercent,
        isCenterline: match.sourceSectionId === centerlineSourceSectionId,
      }));

    return {
      targetSectionId: row.targetSectionId,
      sourceSectionIds: matches.map((match) => match.sourceSectionId),
      centerlineSourceSectionId,
      matches,
      isNull: matches.length === 0,
    };
  });
}

await job.emit("select_corridor", {
  status: "running",
  completed: 0,
  total: targetSummaries.length,
  message: "Selecting section corridor with sparse DP",
});

const dp = runSparseDp(labelRows);
const sectionCorridor = buildSectionCorridor(labelRows, dp.centerlinePath);

const dpOutput = {
  model,
  promptVersion,
  signature,
  candidatesPath: candidatePath,
  expansionsPath: expansionPath,
  matchesPath: labelPath,
  sourceSummaries,
  targetSummaries,
  candidateRows,
  expansionRows: expansionCache.rows,
  labelRows,
  sectionCorridor,
  dp,
};

await writeJson(dpPath, dpOutput);
const selectedPairs = sectionCorridor.reduce((total, row) => total + row.sourceSectionIds.length, 0);
const nullRows = sectionCorridor.filter((row) => row.sourceSectionIds.length === 0).length;
await job.emit("select_corridor", {
  status: "complete",
  completed: sectionCorridor.length,
  total: targetSummaries.length,
  message: `Selected ${selectedPairs} section pairs with ${nullRows} null target sections`,
});

function renderHtml(output) {
  const selectedByTarget = new Map(
    output.dp.centerlinePath.map((step) => [step.targetSectionId, step.sourceSectionId])
  );
  const corridorByTarget = new Map(
    output.sectionCorridor.map((row) => [row.targetSectionId, new Set(row.sourceSectionIds)])
  );
  const sourceIds = output.sourceSummaries.map((summary) => summary.sectionId);
  const headerCells = sourceIds
    .map((sourceId) => {
      const summary = output.sourceSummaries.find((item) => item.sectionId === sourceId);
      return `<th>S${sourceId}<small>${summary.unitRange[0]}-${summary.unitRange[1]}</small></th>`;
    })
    .join("");

  const rows = output.labelRows
    .map((row) => {
      const target = output.targetSummaries.find((summary) => summary.sectionId === row.targetSectionId);
      const expansionRow = output.expansionRows.find((item) => item.targetSectionId === row.targetSectionId);
      const searched = new Set(expansionRow?.searchBlocks.flatMap((block) => block.sourceSectionIds) ?? []);
      const matches = new Map(row.matches.map((match) => [match.sourceSectionId, match]));
      const selectedSourceId = selectedByTarget.get(row.targetSectionId);
      const corridor = corridorByTarget.get(row.targetSectionId) ?? new Set();
      const cells = sourceIds
        .map((sourceId) => {
          const match = matches.get(sourceId);
          const selected = corridor.has(sourceId);
          const centerline = selectedSourceId === sourceId;
          if (match) {
            return `<td class="match${selected ? " corridor" : ""}${centerline ? " centerline" : ""}">${match.estimatedOverlapPercent}%</td>`;
          }
          if (searched.has(sourceId)) {
            return `<td class="searched${centerline ? " centerline" : ""}">x</td>`;
          }
          return `<td class="${centerline ? "centerline empty" : "empty"}"></td>`;
        })
        .join("");
      const nullSelected = selectedSourceId === null ? " null-selected" : "";
      return `<tr><th class="target${nullSelected}">T${row.targetSectionId}<small>${target.unitRange[0]}-${target.unitRange[1]}</small></th>${cells}</tr>`;
    })
    .join("\n");

  const corridorRows = output.sectionCorridor
    .map((row) => {
      const sources = row.sourceSectionIds.length === 0 ? "null" : row.sourceSectionIds.map((id) => `S${id}`).join(", ");
      const centerline = row.centerlineSourceSectionId === null ? "null" : `S${row.centerlineSourceSectionId}`;
      const overlaps = row.matches.map((match) => `S${match.sourceSectionId}: ${match.estimatedOverlapPercent}%`).join(", ");
      return `<tr><td>T${row.targetSectionId}</td><td>${sources}</td><td>${centerline}</td><td>${overlaps || ""}</td></tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Adaptive Sparse Section DP</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #1f2933; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    p { margin: 0 0 16px; color: #52616b; max-width: 980px; line-height: 1.45; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; margin-top: 14px; }
    th, td { border: 1px solid #d8dee6; padding: 8px; text-align: center; vertical-align: middle; }
    th { background: #f4f6f8; font-weight: 650; }
    th.target { width: 92px; }
    small { display: block; margin-top: 3px; font-size: 11px; color: #697586; font-weight: 500; }
    td.match { background: #c8f2d1; color: #174a28; font-weight: 700; }
    td.searched { background: #fff1f1; color: #8a2d2d; }
    td.empty { background: #f8fafc; color: #c4ced8; }
    td.corridor { box-shadow: inset 0 0 0 2px #2f6fed; }
    td.centerline { outline: 3px solid #184fb8; outline-offset: -3px; }
    th.null-selected { outline: 3px solid #7c3aed; outline-offset: -3px; }
    .path { max-width: 760px; }
    .path table { table-layout: auto; }
  </style>
</head>
<body>
  <h1>Adaptive Sparse Section DP</h1>
  <p>Each target section starts with a small candidate block. If GPT returns no overlap, the script expands to another source block until it finds matches or exhausts the search budget. Green cells are returned overlaps and form the selected corridor, red cells were searched and omitted as implicit no-match, blank cells were not sent to GPT, and the darker outline is the DP centerline used for continuity scoring.</p>
  <table>
    <thead><tr><th></th>${headerCells}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <section class="path">
    <h2>Selected Corridor</h2>
    <table>
      <thead><tr><th>Target</th><th>Source corridor</th><th>Centerline</th><th>Overlaps</th></tr></thead>
      <tbody>${corridorRows}</tbody>
    </table>
  </section>
</body>
</html>
`;
}

await fs.writeFile(htmlPath, renderHtml(dpOutput));

console.log(`Candidates: ${candidatePath}`);
console.log(`Expansions: ${expansionPath}`);
console.log(`Labels: ${labelPath}`);
console.log(`DP: ${dpPath}`);
console.log(`HTML: file://${htmlPath}`);
