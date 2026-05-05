import fs from "node:fs/promises";
import {
  buildContentSignature,
  hashJson,
  openAlignmentJob,
} from "./cache_progress.mjs";

const root = "/Users/hans/Desktop/GnosisTMS/alignment-lab";
const model = "gpt-5.5";
const chunkSize = 50;
const stride = 25;
const promptVersion = "same-language-v1";
const outputPath = `${root}/section-summary-cache.json`;
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

const sourceLanguage = argValue("--source-language", "Spanish");
const targetLanguage = argValue("--target-language", "Vietnamese");
const maxSourceSections = Number(argValue("--max-source", "10"));
const maxTargetSections = Number(argValue("--max-target", "12"));
const jobId = argValue("--job-id", "section-summary");

const apiKey = (await fs.readFile(apiKeyPath, "utf8")).trim();
if (!apiKey) {
  throw new Error(`${apiKeyPath} is empty`);
}

function parseUnits(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text, index) => ({ id: index + 1, text }));
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
      language: docRole === "source" ? sourceLanguage : targetLanguage,
      sectionContentHash: hashJson(sectionUnits.map((unit) => unit.text)),
      units: sectionUnits,
    });
    if (startIndex + chunkSize >= units.length) break;
  }
  return sections;
}

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
          "User-Agent": "alignment-lab-section-summary-cache",
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

const summarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["sectionSummary"],
  properties: {
    sectionSummary: {
      type: "object",
      additionalProperties: false,
      required: ["docRole", "sectionId", "unitRange", "language", "summary"],
      properties: {
        docRole: { type: "string", enum: ["source", "target"] },
        sectionId: { type: "integer", minimum: 1 },
        unitRange: {
          type: "array",
          minItems: 2,
          maxItems: 2,
          items: { type: "integer", minimum: 1 },
        },
        language: { type: "string" },
        summary: { type: "string" },
      },
    },
  },
};

async function summarizeSection(section) {
  const prompt = `Summarize this ${section.language} document section in approximately 100 words in ${section.language}.

Rules:
- Do not translate the summary into another language.
- Preserve important names, headings, numbers, dates, distinctive phrases, and terminology.
- Keep the summary faithful to the section text.
- Do not decide whether this section matches any other section.

Section:
${JSON.stringify(section, null, 2)}`;

  const result = await openaiStructured({
    name: "same_language_section_summary",
    schema: summarySchema,
    prompt,
  });

  const summary = result.sectionSummary;
  if (summary.docRole !== section.docRole || summary.sectionId !== section.sectionId) {
    throw new Error(`Summary returned wrong identity for ${section.docRole} section ${section.sectionId}`);
  }
  return summary;
}

const sourceUnits = parseUnits(await fs.readFile(`${root}/fixtures/source.txt`, "utf8"));
const targetRawText = await fs.readFile(`${root}/fixtures/target.txt`, "utf8");
const targetUnits = parseUnits(targetRawText);
const sourceSections = makeSections(sourceUnits, "source").slice(0, maxSourceSections);
const targetSections = makeSections(targetUnits, "target").slice(0, maxTargetSections);
const signature = buildContentSignature({
  sourceUnits,
  targetUnits,
  targetRawText,
  sourceLanguage,
  targetLanguage,
  chunkSize,
  stride,
  models: { summary: model },
  promptVersions: { summary: promptVersion },
});
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

let existingOutput = null;
try {
  existingOutput = JSON.parse(await fs.readFile(outputPath, "utf8"));
} catch {
}

const output = {
  model,
  promptVersion,
  summaryLanguageMode: "input_language",
  languages: {
    source: sourceLanguage,
    target: targetLanguage,
  },
  chunkSize,
  stride,
  sourceSections,
  targetSections,
  sectionSummaries: [],
};

function cachedSummaryFor(section) {
  return (existingOutput?.sectionSummaries ?? []).find(
    (summary) =>
      summary.docRole === section.docRole &&
      summary.sectionId === section.sectionId &&
      summary.language === section.language &&
      summary.sectionContentHash === section.sectionContentHash &&
      summary.model === model &&
      summary.promptVersion === promptVersion
  );
}

const allSections = [...sourceSections, ...targetSections];
let completedSummaries = 0;
let cachedSummaries = 0;
await job.emit("summarize_sections", {
  status: "running",
  completed: completedSummaries,
  total: allSections.length,
  cached: cachedSummaries,
  message: "Starting section summaries",
});

for (const section of allSections) {
  const cached = cachedSummaryFor(section);
  if (cached) {
    console.error(`Using cached ${section.docRole} section ${section.sectionId} summary`);
    output.sectionSummaries.push(cached);
    completedSummaries += 1;
    cachedSummaries += 1;
    await job.cacheHit("summarize_sections");
    await job.emit("summarize_sections", {
      status: "running",
      completed: completedSummaries,
      total: allSections.length,
      cached: cachedSummaries,
      message: `Loaded cached ${section.docRole} section ${section.sectionId}`,
    });
    continue;
  }

  console.error(`Summarizing ${section.docRole} section ${section.sectionId} in ${section.language}`);
  const summary = await summarizeSection(section);
  await job.apiCall("summarize_sections");
  output.sectionSummaries.push({
    ...summary,
    sectionContentHash: section.sectionContentHash,
    model,
    promptVersion,
  });
  completedSummaries += 1;
  await job.emit("summarize_sections", {
    status: "running",
    completed: completedSummaries,
    total: allSections.length,
    cached: cachedSummaries,
    message: `Summarized ${section.docRole} section ${section.sectionId}`,
  });
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
}

await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
await job.emit("summarize_sections", {
  status: "complete",
  completed: allSections.length,
  total: allSections.length,
  cached: cachedSummaries,
  message: `Completed ${allSections.length} section summaries`,
});
console.log(`Wrote ${outputPath}`);
console.log(`Job manifest: ${job.manifestPath}`);
