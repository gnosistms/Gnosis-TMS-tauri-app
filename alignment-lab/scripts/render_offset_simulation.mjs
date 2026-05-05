import fs from "node:fs/promises";

const root = "/Users/hans/Desktop/GnosisTMS/alignment-lab";
const inputPath = `${root}/section-sparse-dp.json`;
function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
  return value;
}

const dropTargetCount = Number(argValue("--drop-target-count", "4"));
const dropSourceRange = argValue("--drop-source-range", "");
const outputStem = argValue("--output-stem", "section-offset-simulation");
const outputJsonPath = `${root}/${outputStem}.json`;
const outputHtmlPath = `${root}/${outputStem}.html`;
const data = JSON.parse(await fs.readFile(inputPath, "utf8"));

const sortedTargetIds = data.targetSummaries
  .map((section) => section.sectionId)
  .sort((a, b) => a - b);
const droppedTargetIds = new Set(sortedTargetIds.slice(0, dropTargetCount));
const droppedSourceIds = new Set();
if (dropSourceRange) {
  const [start, end] = dropSourceRange.split("-").map((value) => Number(value.trim()));
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    throw new Error(`Invalid --drop-source-range ${dropSourceRange}`);
  }
  for (let sourceId = start; sourceId <= end; sourceId += 1) {
    droppedSourceIds.add(sourceId);
  }
}

const sourceSummaries = data.sourceSummaries.filter((section) => !droppedSourceIds.has(section.sectionId));
const targetSummaries = data.targetSummaries.filter((section) => !droppedTargetIds.has(section.sectionId));
const labelRows = data.labelRows
  .filter((row) => !droppedTargetIds.has(row.targetSectionId))
  .map((row) => ({
    targetSectionId: row.targetSectionId,
    matches: row.matches.filter((match) => !droppedSourceIds.has(match.sourceSectionId)),
  }));
const sourceById = new Map(sourceSummaries.map((section) => [section.sectionId, section]));
const targetById = new Map(targetSummaries.map((section) => [section.sectionId, section]));

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

  const centerlinePath = [];
  for (let targetIndex = dp.length - 1, stateIndex = bestIndex; targetIndex >= 0; targetIndex -= 1) {
    const cell = dp[targetIndex][stateIndex];
    centerlinePath.push({
      targetSectionId: cell.state.targetSectionId,
      sourceSectionId: cell.state.sourceSectionId,
      label: cell.state.label,
      estimatedOverlapPercent: cell.state.estimatedOverlapPercent,
      localScore: cell.state.localScore,
      cumulativeScore: cell.score,
    });
    stateIndex = cell.previousIndex;
    if (stateIndex === null && targetIndex > 0) throw new Error("DP backtrace failed");
  }

  centerlinePath.reverse();
  return {
    scoring: { nullPenalty, backwardPenalty, jumpPenalty, matchBase },
    totalScore: lastRow[bestIndex].score,
    centerlinePath,
  };
}

function buildSectionCorridor(rows, centerlinePath) {
  const centerlineByTarget = new Map(centerlinePath.map((step) => [step.targetSectionId, step.sourceSectionId]));
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

const dp = runSparseDp(labelRows);
const sectionCorridor = buildSectionCorridor(labelRows, dp.centerlinePath);
const output = {
  sourceScenario: "Simulates source/target offset or deleted sections by dropping cached target/source sections before recomputing DP.",
  dropTargetCount,
  droppedTargetIds: [...droppedTargetIds],
  droppedSourceIds: [...droppedSourceIds],
  sourceSummaries,
  targetSummaries,
  labelRows,
  sectionCorridor,
  dp,
};

await fs.writeFile(outputJsonPath, JSON.stringify(output, null, 2));

function sectionRange(section) {
  return section ? `${section.unitRange[0]}-${section.unitRange[1]}` : "";
}

const sourceIds = sourceSummaries.map((section) => section.sectionId);
const centerlineByTarget = new Map(dp.centerlinePath.map((step) => [step.targetSectionId, step.sourceSectionId]));
const corridorByTarget = new Map(sectionCorridor.map((row) => [row.targetSectionId, new Set(row.sourceSectionIds)]));

const headerCells = sourceIds
  .map((sourceId) => {
    const section = sourceById.get(sourceId);
    return `<th>S${sourceId}<small>${sectionRange(section)}</small></th>`;
  })
  .join("");

const matrixRows = labelRows
  .map((row) => {
    const target = targetById.get(row.targetSectionId);
    const matches = new Map(row.matches.map((match) => [match.sourceSectionId, match]));
    const centerlineSourceId = centerlineByTarget.get(row.targetSectionId);
    const corridor = corridorByTarget.get(row.targetSectionId) ?? new Set();
    const cells = sourceIds
      .map((sourceId) => {
        const match = matches.get(sourceId);
        const isCorridor = corridor.has(sourceId);
        const isCenterline = centerlineSourceId === sourceId;
        if (match) {
          return `<td class="match${isCorridor ? " corridor" : ""}${isCenterline ? " centerline" : ""}">${match.estimatedOverlapPercent}%</td>`;
        }
        return `<td class="empty"></td>`;
      })
      .join("");
    return `<tr><th class="target">T${row.targetSectionId}<small>${sectionRange(target)}</small></th>${cells}</tr>`;
  })
  .join("\n");

const summaryRows = sectionCorridor
  .map((row) => {
    const sources = row.sourceSectionIds.length === 0 ? "null" : row.sourceSectionIds.map((id) => `S${id}`).join(", ");
    const centerline = row.centerlineSourceSectionId === null ? "null" : `S${row.centerlineSourceSectionId}`;
    const overlaps = row.matches.map((match) => `S${match.sourceSectionId}: ${match.estimatedOverlapPercent}%`).join(", ");
    return `<tr><td>T${row.targetSectionId}</td><td>${sources}</td><td>${centerline}</td><td>${overlaps}</td></tr>`;
  })
  .join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Section Deletion Simulation</title>
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
    td.empty { background: #f8fafc; }
    td.corridor { box-shadow: inset 0 0 0 2px #2f6fed; }
    td.centerline { outline: 3px solid #184fb8; outline-offset: -3px; }
    .summary { max-width: 860px; }
    .summary table { table-layout: auto; }
  </style>
</head>
<body>
  <h1>Section Deletion Simulation</h1>
  <p>Dropped target sections: ${[...droppedTargetIds].map((id) => `T${id}`).join(", ") || "none"}. Dropped source sections: ${[...droppedSourceIds].map((id) => `S${id}`).join(", ") || "none"}. The report recomputes the DP centerline and corridor from cached match results only.</p>
  <table>
    <thead><tr><th></th>${headerCells}</tr></thead>
    <tbody>${matrixRows}</tbody>
  </table>
  <section class="summary">
    <h2>Selection Summary</h2>
    <table>
      <thead><tr><th>Target</th><th>Source corridor</th><th>Centerline</th><th>Overlaps</th></tr></thead>
      <tbody>${summaryRows}</tbody>
    </table>
  </section>
</body>
</html>`;

await fs.writeFile(outputHtmlPath, html);
console.log(`JSON: ${outputJsonPath}`);
console.log(`HTML: file://${outputHtmlPath}`);
