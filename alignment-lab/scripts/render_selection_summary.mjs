import fs from "node:fs/promises";

const root = "/Users/hans/Desktop/GnosisTMS/alignment-lab";
const inputPath = `${root}/section-sparse-dp.json`;
const outputPath = `${root}/section-selection-summary.html`;

const data = JSON.parse(await fs.readFile(inputPath, "utf8"));

const sourceById = new Map(data.sourceSummaries.map((section) => [section.sectionId, section]));
const targetById = new Map(data.targetSummaries.map((section) => [section.sectionId, section]));
const centerline = data.dp.centerlinePath ?? data.dp.path ?? [];
const centerlineByTarget = new Map(centerline.map((step) => [step.targetSectionId, step]));
const corridorRows =
  data.sectionCorridor ??
  data.labelRows.map((row) => {
    const centerlineStep = centerlineByTarget.get(row.targetSectionId);
    const centerlineSourceSectionId = centerlineStep?.sourceSectionId ?? null;
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sectionRange(section) {
  return section ? `${section.unitRange[0]}-${section.unitRange[1]}` : "";
}

function overlapText(row) {
  if (row.matches.length === 0) return "No source section selected";
  return row.matches
    .map((match) => {
      const centerlineMark = match.isCenterline ? " center" : "";
      return `<span class="pill${centerlineMark}">S${match.sourceSectionId} ${match.estimatedOverlapPercent}%</span>`;
    })
    .join(" ");
}

const rowsHtml = corridorRows
  .map((row) => {
    const target = targetById.get(row.targetSectionId);
    const sourceRanges = row.sourceSectionIds
      .map((sourceId) => {
        const source = sourceById.get(sourceId);
        return `S${sourceId} <span class="muted">${sectionRange(source)}</span>`;
      })
      .join("<br>");
    const centerlineSource =
      row.centerlineSourceSectionId === null
        ? "null"
        : `S${row.centerlineSourceSectionId} <span class="muted">${sectionRange(sourceById.get(row.centerlineSourceSectionId))}</span>`;

    return `<tr>
      <td class="target">T${row.targetSectionId}<span>${sectionRange(target)}</span></td>
      <td>${sourceRanges || '<span class="null">null</span>'}</td>
      <td>${centerlineSource}</td>
      <td>${overlapText(row)}</td>
    </tr>`;
  })
  .join("\n");

const selectedPairs = corridorRows.reduce((sum, row) => sum + row.sourceSectionIds.length, 0);
const nullRows = corridorRows.filter((row) => row.sourceSectionIds.length === 0).length;
const maxWidth = Math.max(...corridorRows.map((row) => row.sourceSectionIds.length));
const centerlinePath = centerline
  .map((step) => `T${step.targetSectionId}->${step.sourceSectionId === null ? "null" : `S${step.sourceSectionId}`}`)
  .join("  ");

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Section Selection Summary</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #1f2933; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    p { margin: 0 0 16px; color: #52616b; line-height: 1.45; max-width: 980px; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 10px; max-width: 820px; margin: 18px 0; }
    .stat { border: 1px solid #d8dee6; border-radius: 6px; padding: 10px 12px; background: #f8fafc; }
    .stat strong { display: block; font-size: 20px; }
    .stat span { color: #697586; font-size: 12px; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; margin-top: 16px; }
    th, td { border: 1px solid #d8dee6; padding: 9px; text-align: left; vertical-align: top; }
    th { background: #f4f6f8; font-weight: 650; }
    td.target { font-weight: 700; width: 110px; }
    td.target span, .muted { display: inline-block; color: #697586; font-size: 12px; font-weight: 500; margin-left: 4px; }
    .pill { display: inline-block; margin: 0 5px 5px 0; padding: 4px 7px; border-radius: 999px; background: #dff7e5; color: #174a28; font-weight: 650; font-size: 13px; }
    .pill.center { outline: 2px solid #184fb8; outline-offset: 1px; }
    .null { color: #7c3aed; font-weight: 700; }
    .path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: normal; background: #f8fafc; border: 1px solid #d8dee6; border-radius: 6px; padding: 10px; }
  </style>
</head>
<body>
  <h1>Section Selection Summary</h1>
  <p>This report uses cached sparse-section results only. The selected corridor is the set of source sections retained for row-level alignment; the centerline is the single DP path used for continuity scoring.</p>
  <div class="stats">
    <div class="stat"><strong>${corridorRows.length}</strong><span>target sections</span></div>
    <div class="stat"><strong>${selectedPairs}</strong><span>target/source pairs</span></div>
    <div class="stat"><strong>${maxWidth}</strong><span>max corridor width</span></div>
    <div class="stat"><strong>${nullRows}</strong><span>null target rows</span></div>
  </div>
  <h2>Centerline</h2>
  <div class="path">${escapeHtml(centerlinePath)}</div>
  <h2>Selected Corridor</h2>
  <table>
    <thead>
      <tr><th>Target</th><th>Source corridor</th><th>Centerline source</th><th>Overlap estimates</th></tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;

await fs.writeFile(outputPath, html);
console.log(`HTML: file://${outputPath}`);
