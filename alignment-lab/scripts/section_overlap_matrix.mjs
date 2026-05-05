import fs from "node:fs/promises";

const root = "/Users/hans/Desktop/GnosisTMS/alignment-lab";
const model = "gpt-5.5";
const summaryCachePath = `${root}/section-summary-cache.json`;
const matrixPath = `${root}/section-overlap-matrix.json`;
const htmlPath = `${root}/section-overlap-matrix.html`;
const apiKeyPath = `${root}/openai-api-key.txt`;

const apiKey = (await fs.readFile(apiKeyPath, "utf8")).trim();
if (!apiKey) {
  throw new Error(`${apiKeyPath} is empty`);
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

const matchSchema = {
  type: "object",
  additionalProperties: false,
  required: ["labels"],
  properties: {
    labels: {
      type: "array",
      minItems: sourceSummaries.length,
      maxItems: sourceSummaries.length,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["targetSectionId", "sourceSectionId", "label", "estimatedOverlapPercent"],
        properties: {
          targetSectionId: { type: "integer", minimum: 1 },
          sourceSectionId: { type: "integer", minimum: 1 },
          label: { type: "string", enum: ["match", "no_match"] },
          estimatedOverlapPercent: { type: "integer", minimum: 0, maximum: 100 },
        },
      },
    },
  },
};

async function openaiStructured({ name, schema, prompt }) {
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
          "User-Agent": "alignment-lab-section-overlap-test",
        },
        body: JSON.stringify(body),
      });
      break;
    } catch (error) {
      if (attempt === 3) {
        throw error;
      }
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
        if (content.type === "output_text" && content.text) {
          outputText = content.text;
        }
      }
    }
  }
  if (!outputText) {
    throw new Error("OpenAI returned no output text");
  }

  return JSON.parse(outputText);
}

function validateRow(targetSummary, labels) {
  if (labels.length !== sourceSummaries.length) {
    throw new Error(`Target section ${targetSummary.sectionId}: expected ${sourceSummaries.length} labels, got ${labels.length}`);
  }

  const bySource = new Map();
  for (const label of labels) {
    if (label.targetSectionId !== targetSummary.sectionId) {
      throw new Error(`Target section ${targetSummary.sectionId}: returned targetSectionId ${label.targetSectionId}`);
    }
    if (!sourceSummaries.some((summary) => summary.sectionId === label.sourceSectionId)) {
      throw new Error(`Target section ${targetSummary.sectionId}: unknown sourceSectionId ${label.sourceSectionId}`);
    }
    if (bySource.has(label.sourceSectionId)) {
      throw new Error(`Target section ${targetSummary.sectionId}: duplicate sourceSectionId ${label.sourceSectionId}`);
    }
    if (label.label === "no_match" && label.estimatedOverlapPercent !== 0) {
      throw new Error(`Target section ${targetSummary.sectionId}: no_match S${label.sourceSectionId} has nonzero overlap`);
    }
    if (label.label === "match" && label.estimatedOverlapPercent <= 0) {
      throw new Error(`Target section ${targetSummary.sectionId}: match S${label.sourceSectionId} has zero overlap`);
    }
    bySource.set(label.sourceSectionId, label);
  }

  return sourceSummaries.map((summary) => bySource.get(summary.sectionId));
}

function renderHtml(output) {
  const sourceHeaders = output.sourceSummaries
    .map((summary) => `<th>S${summary.sectionId}<small>${summary.unitRange[0]}-${summary.unitRange[1]}</small></th>`)
    .join("");

  const rows = output.matrix
    .map((row) => {
      const target = output.targetSummaries.find((summary) => summary.sectionId === row.targetSectionId);
      const cells = row.labels
        .map((label) => {
          const klass = label.label === "match" ? "match" : "no-match";
          const text = label.label === "match" ? `${label.estimatedOverlapPercent}%` : "";
          return `<td class="${klass}">${text}</td>`;
        })
        .join("");
      return `<tr><th class="target">T${row.targetSectionId}<small>${target.unitRange[0]}-${target.unitRange[1]}</small></th>${cells}</tr>`;
    })
    .join("\n");

  const detailRows = output.matrix
    .map((row) => {
      const matches = row.labels
        .filter((label) => label.label === "match")
        .map((label) => `S${label.sourceSectionId}: ${label.estimatedOverlapPercent}%`)
        .join(", ");
      return `<tr><td>T${row.targetSectionId}</td><td>${matches || "none"}</td></tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Section Overlap Matrix</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #1f2933; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    p { margin: 0 0 18px; color: #52616b; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; }
    th, td { border: 1px solid #d8dee6; padding: 8px; text-align: center; vertical-align: middle; }
    th { background: #f4f6f8; font-weight: 650; }
    th.target { width: 92px; }
    small { display: block; margin-top: 3px; font-size: 11px; color: #697586; font-weight: 500; }
    td.match { background: #c8f2d1; color: #174a28; font-weight: 700; }
    td.no-match { background: #fbfcfd; color: #b6c2cf; }
    .legend { display: flex; gap: 16px; margin: 16px 0; align-items: center; }
    .swatch { display: inline-block; width: 18px; height: 12px; border: 1px solid #cbd5df; margin-right: 6px; vertical-align: -1px; }
    .swatch.match { background: #c8f2d1; }
    .summary { margin-top: 28px; max-width: 720px; }
    .summary table { table-layout: auto; }
    .summary td:first-child { width: 80px; font-weight: 650; }
    .summary td { text-align: left; }
  </style>
</head>
<body>
  <h1>Section Overlap Matrix</h1>
  <p>Rows are target sections, columns are source sections. A match means GPT estimates overlapping translated content between the two sections. Cell values are estimated percent overlap.</p>
  <div class="legend"><span><span class="swatch match"></span>match</span><span><span class="swatch"></span>no match</span></div>
  <table>
    <thead><tr><th></th>${sourceHeaders}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <section class="summary">
    <h2>Row Matches</h2>
    <table><tbody>${detailRows}</tbody></table>
  </section>
</body>
</html>
`;
}

const matrix = [];
for (const targetSummary of targetSummaries) {
  console.error(`Classifying overlap row T${targetSummary.sectionId}`);
  const prompt = `Classify overlap between one target-language section and each source-language section.

Match means the two sections contain overlapping translated/source rows. These are 50-row windows with 25-row stride, so each target row typically has about 3 matching source sections; edges and document drift may vary.

For every source candidate, return only label "match" or "no_match" plus estimatedOverlapPercent, the integer percent of the target section covered by that source section. For "no_match", use 0. Do not explain.

Target section:
${JSON.stringify(targetSummary, null, 2)}

Source candidate sections:
${JSON.stringify(sourceSummaries, null, 2)}`;

  const result = await openaiStructured({
    name: "section_overlap_labels",
    schema: matchSchema,
    prompt,
  });
  matrix.push({
    targetSectionId: targetSummary.sectionId,
    labels: validateRow(targetSummary, result.labels),
  });
}

const output = {
  model,
  chunkSize: summaryCache.chunkSize,
  stride: summaryCache.stride,
  sourceSummaries,
  targetSummaries,
  matrix,
};

await fs.writeFile(matrixPath, JSON.stringify(output, null, 2));
await fs.writeFile(htmlPath, renderHtml(output));

console.log(`JSON: ${matrixPath}`);
console.log(`HTML: file://${htmlPath}`);
