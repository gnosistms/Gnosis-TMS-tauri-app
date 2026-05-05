import fs from "node:fs/promises";

const root = "/Users/hans/Desktop/GnosisTMS/alignment-lab";
const inputPath = `${root}/section-sparse-dp.json`;
const outputJsonPath = `${root}/section-candidate-search-dry-run.json`;
const outputHtmlPath = `${root}/section-candidate-search-dry-run.html`;

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
  return value;
}

const dropSourceRange = argValue("--drop-source-range", "4-7");
const blockSize = Number(argValue("--block-size", "4"));
const maxExpansionBlocks = Number(argValue("--max-expansion-blocks", "20"));
const anchorCount = Number(argValue("--anchor-count", "4"));

const [dropStart, dropEnd] = dropSourceRange.split("-").map((value) => Number(value.trim()));
if (!Number.isInteger(dropStart) || !Number.isInteger(dropEnd) || dropStart < 1 || dropEnd < dropStart) {
  throw new Error(`Invalid --drop-source-range ${dropSourceRange}`);
}

const data = JSON.parse(await fs.readFile(inputPath, "utf8"));
const droppedSourceIds = new Set();
for (let sourceId = dropStart; sourceId <= dropEnd; sourceId += 1) {
  droppedSourceIds.add(sourceId);
}

const sourceSummaries = data.sourceSummaries.filter((section) => !droppedSourceIds.has(section.sectionId));
const targetSummaries = data.targetSummaries;
const sourceById = new Map(sourceSummaries.map((section) => [section.sectionId, section]));
const cachedMatchesByTarget = new Map(
  data.labelRows.map((row) => [
    row.targetSectionId,
    row.matches.filter((match) => !droppedSourceIds.has(match.sourceSectionId)),
  ])
);

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

const sourceAnchors = new Map(sourceSummaries.map((summary) => [summary.sectionId, anchorTokens(summary.summary)]));
const targetAnchors = new Map(targetSummaries.map((summary) => [summary.sectionId, anchorTokens(summary.summary)]));

function overlapCount(a, b) {
  let count = 0;
  for (const token of a) {
    if (b.has(token)) count += 1;
  }
  return count;
}

function expectedSourceIndex(targetIndex) {
  if (targetSummaries.length === 1 || sourceSummaries.length === 1) return sourceSummaries[0].sectionId;
  const position = Math.round(((targetIndex - 1) * (sourceSummaries.length - 1)) / (targetSummaries.length - 1));
  return sourceSummaries[Math.max(0, Math.min(sourceSummaries.length - 1, position))].sectionId;
}

function nearestSourceId(sourceId) {
  let best = sourceSummaries[0].sectionId;
  let bestDistance = Math.abs(best - sourceId);
  for (const source of sourceSummaries) {
    const distance = Math.abs(source.sectionId - sourceId);
    if (distance < bestDistance) {
      best = source.sectionId;
      bestDistance = distance;
    }
  }
  return best;
}

function blockAround(center) {
  const nearest = nearestSourceId(center);
  const nearestIndex = sourceSummaries.findIndex((section) => section.sectionId === nearest);
  const startIndex = Math.max(0, Math.min(sourceSummaries.length - blockSize, nearestIndex - Math.floor((blockSize - 1) / 2)));
  return sourceSummaries.slice(startIndex, startIndex + blockSize).map((section) => section.sectionId);
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
  function addBlock(reason, ids) {
    const key = blockKey(ids);
    if (seen.has(key)) return;
    seen.add(key);
    blocks.push({ reason, sourceSectionIds: ids });
  }

  for (const center of centers) {
    addBlock(center.reason, blockAround(center.center));
  }

  const primaryCenter = centers[0]?.center ?? expected;
  let staleSteps = 0;
  for (let step = 1; blocks.length < maxExpansionBlocks; step += 1) {
    const before = blocks.length;
    addBlock(`expand_forward_${step}`, blockAround(primaryCenter + step * blockSize));
    if (blocks.length >= maxExpansionBlocks) break;
    addBlock(`expand_backward_${step}`, blockAround(primaryCenter - step * blockSize));
    staleSteps = blocks.length === before ? staleSteps + 1 : 0;
    if (staleSteps >= 2) break;
  }

  return { expectedSourceSectionId: expected, startingCenters: centers, blocks: blocks.slice(0, maxExpansionBlocks) };
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

const rows = [];
let continuationSourceId = null;
for (const targetSummary of targetSummaries) {
  const plan = searchBlocksForTarget(targetSummary, continuationSourceId);
  const cachedMatches = cachedMatchesByTarget.get(targetSummary.sectionId) ?? [];
  let foundMatches = [];
  const searchedBlocks = [];

  for (const block of plan.blocks) {
    const blockSourceSet = new Set(block.sourceSectionIds);
    const matchesInBlock = cachedMatches.filter((match) => blockSourceSet.has(match.sourceSectionId));
    searchedBlocks.push({ ...block, matches: matchesInBlock });
    if (matchesInBlock.length > 0) {
      foundMatches = matchesInBlock;
      break;
    }
  }

  rows.push({
    targetSectionId: targetSummary.sectionId,
    expectedSourceSectionId: plan.expectedSourceSectionId,
    startingCenters: plan.startingCenters,
    searchedBlocks,
    foundMatches,
    stoppedBecause: foundMatches.length > 0 ? "match_found" : "search_exhausted",
  });
  continuationSourceId = bestContinuationSourceId(foundMatches, continuationSourceId);
}

const output = {
  scenario: "Dry run of adaptive candidate search after deleting source summaries before candidate generation. Cached GPT matches are used only as simulated block outcomes.",
  droppedSourceIds: [...droppedSourceIds],
  options: { blockSize, maxExpansionBlocks, anchorCount },
  sourceSummaries,
  targetSummaries,
  rows,
};

await fs.writeFile(outputJsonPath, JSON.stringify(output, null, 2));

function sourceList(ids) {
  return ids.map((id) => `S${id}`).join(", ");
}

const tableRows = rows
  .map((row) => {
    const blocks = row.searchedBlocks
      .map((block, index) => {
        const hit = block.matches.length > 0;
        const matches = block.matches.map((match) => `S${match.sourceSectionId} ${match.estimatedOverlapPercent}%`).join(", ");
        return `<div class="block ${hit ? "hit" : "miss"}">
          <strong>${index + 1}. ${block.reason}</strong>
          <span>${sourceList(block.sourceSectionIds)}</span>
          <em>${hit ? `hit: ${matches}` : "no match"}</em>
        </div>`;
      })
      .join("");
    return `<tr>
      <td class="target">T${row.targetSectionId}</td>
      <td>S${row.expectedSourceSectionId}</td>
      <td>${row.startingCenters.map((center) => `${center.reason}: S${center.center}`).join("<br>")}</td>
      <td>${blocks}</td>
      <td>${row.foundMatches.length > 0 ? row.foundMatches.map((match) => `S${match.sourceSectionId}`).join(", ") : "none"}</td>
    </tr>`;
  })
  .join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Candidate Search Dry Run</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #1f2933; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    p { margin: 0 0 16px; color: #52616b; max-width: 1040px; line-height: 1.45; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; margin-top: 14px; }
    th, td { border: 1px solid #d8dee6; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f4f6f8; font-weight: 650; }
    td.target { font-weight: 700; width: 70px; }
    .block { border: 1px solid #d8dee6; border-radius: 6px; padding: 7px; margin: 0 0 6px; background: #f8fafc; }
    .block strong { display: block; font-size: 13px; }
    .block span { display: block; margin-top: 3px; }
    .block em { display: block; margin-top: 3px; font-style: normal; color: #697586; }
    .block.hit { background: #dff7e5; border-color: #8bd99c; }
    .block.hit em { color: #174a28; font-weight: 700; }
    .block.miss { background: #fff7f7; }
  </style>
</head>
<body>
  <h1>Candidate Search Dry Run</h1>
  <p>Dropped source summaries before candidate generation: ${sourceList([...droppedSourceIds])}. This uses cached GPT labels only to simulate whether each searched block would have produced a match; it makes no API calls.</p>
  <table>
    <thead><tr><th>Target</th><th>Global expected</th><th>Search centers</th><th>Searched blocks</th><th>Found</th></tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
</body>
</html>`;

await fs.writeFile(outputHtmlPath, html);
console.log(`JSON: ${outputJsonPath}`);
console.log(`HTML: file://${outputHtmlPath}`);
