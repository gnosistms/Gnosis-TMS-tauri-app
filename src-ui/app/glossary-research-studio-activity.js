import { meaningTrialSignature, studyAssignments, entryBatchSignature, buildStudioDraft, stableSignature } from "./glossary-research-studio-workflow.js";

// Presentation-only receipts. Never included in AI evidence or cache signatures.
const clip = (text, limit = 1800) => String(text).length > limit ? `${String(text).slice(0, limit)}…` : String(text);
export function summarizeStudioActivity(value) {
  if (!value || typeof value !== "object") return "Completed.";
  const lines = [];
  for (const key of ["summary", "report", "reason"]) if (typeof value[key] === "string" && value[key].trim()) lines.push(value[key]);
  const lists = [["meanings", "meanings", "definition"], ["forms", "forms", "text"],
    ["parts", "word parts", "text"], ["candidates", "candidates", "text"], ["books", "source books", "title"]];
  for (const [key, label, field] of lists) if (Array.isArray(value[key])) {
    const names = value[key].slice(0, 6).map((item) => typeof item === "string" ? item : item?.[field]).filter(Boolean);
    lines.push(`${value[key].length} ${label}${names.length ? `: ${names.join("; ")}${value[key].length > 6 ? "; …" : ""}` : "."}`);
  }
  if (Array.isArray(value.pairs)) lines.push(`${value.pairs.length} original-language term correspondences returned for the searched forms.`);
  if (Array.isArray(value.judgments)) {
    const genuine = value.judgments.filter((j) => j.genuine === true).length;
    const unresolved = value.judgments.filter((j) => typeof j.genuine !== "boolean").length;
    lines.push(`${genuine} genuine mentions; ${unresolved} unresolved; ${value.judgments.length} checked.`);
  }
  if (Array.isArray(value.assignments)) lines.push(`${value.assignments.length} occurrences assigned; ${value.assignments.filter((a) => !a.meaningId).length} need review.`);
  if (Array.isArray(value.choices)) lines.push(`${value.choices.length} occurrences reviewed; ${value.choices.filter((c) => c.problem).length} findings to review.`);
  if (Array.isArray(value.rows)) lines.push(`${value.rows.length} paragraphs translated.`);
  if (Number.isInteger(value.population_distinct)) lines.push(`${value.population_distinct.toLocaleString()} matching paragraphs.`);
  else if (Array.isArray(value.items)) lines.push(`${value.items.length.toLocaleString()} paragraphs returned.`);
  if (Array.isArray(value.candidateIds)) lines.push(`${value.candidateIds.length} spellings need investigation.`);
  if (Array.isArray(value.notes)) lines.push(`${value.notes.length} usage notes revised.`);
  if (Array.isArray(value.confirmIds)) lines.push(`${value.confirmIds.length} existing candidate forms selected for confirmation.`);
  if (Array.isArray(value.newForms)) lines.push(`${value.newForms.length} new forms proposed${value.newForms.length ? `: ${value.newForms.map((form) => form.text).join(", ")}` : "."}`);
  if (value.originTerm) lines.push(`Original term: ${value.originTerm}.`);
  if (value.edition === "en" && value.language !== "en") lines.push("Looked up in the English Wiktionary edition.");
  if (value.status) lines.push(`Source status: ${value.status}.`);
  const summary = clip(lines.join("\n") || "Completed. Results are available in the research report.");
  // The collapsed preview shows only the count; the expanded summary shows every translation in full.
  const translations = Array.isArray(value.rows) ? value.rows.map((row) => String(row?.translatedText ?? "").trim()).filter(Boolean) : [];
  return [summary, ...translations].join("\n\n");
}

export function createStudioActivity(study, changed, isCurrent) {
  const step = study.step;
  const record = structuredClone(study.activitySteps?.[step] ?? { items: [] });
  study.activitySteps = { ...study.activitySteps, [step]: record };
  const ownsRecord = () => study.activitySteps[step] === record;
  const find = (path, create = true) => {
    let children = record.items; let node;
    for (const id of path) {
      node = children.find((item) => item.id === id);
      if (!node && create) { node = { id, label: id, status: "waiting", children: [] }; children.push(node); }
      if (!node) return null;
      children = node.children ??= [];
    }
    return node;
  };
  const update = (path, fields) => {
    if (!isCurrent() || !ownsRecord()) return;
    Object.assign(find(path), fields); changed();
  };
  function plan(items, path = [], announce = true) {
    if (!isCurrent() || !ownsRecord()) return;
    for (const { id, label, children } of items) {
      const node = find([...path, id]); node.label = label;
      if (children) plan(children, [...path, id], false);
    }
    if (announce) changed();
  }
  function pause(nodes = record.items) {
    if (study.activitySteps[step] !== record) return;
    for (const node of nodes) { if (node.status === "running") node.status = "paused"; pause(node.children); }
  }
  return { plan, update,
    start(path, label) {
      if (!isCurrent() || !ownsRecord()) return;
      for (let n = 1; n < path.length; n++) Object.assign(find(path.slice(0, n)), { status: "running", result: "", error: "" });
      update(path, { label, status: "running", result: "", error: "" });
    },
    done(path, result, reused = false) { update(path, { status: "complete", result: summarizeStudioActivity(result), reused, error: "" }); },
    finish(path, result) { update(path, { status: "complete", result: clip(result), error: "" }); },
    fail(path, error) { update(path, { status: error?.message === "Research paused." ? "paused" : "failed", error: error?.message === "Research paused." ? "" : clip(error?.message ?? error, 400) }); },
    pause() { pause(); changed(); },
  };
}

export function studioStageActivities(s) {
  const nodes = (rows) => rows.map(([id, label]) => ({ id, label }));
  const plans = {
    "2a": [["discover", "Find additional forms and spellings"], ["forms", "Check forms against the corpus"], ["origin", "Verify original spelling"], ["identity", "Verify which forms are the same word"], ["accepted", "Verify accepted alternatives"]],
    "3": [["population", "Find matching corpus paragraphs"], ["sample", "Select research examples"]],
    "4.1": [["dictionary", "Look up the source word"], ["origin", "Check its original-language form"], ["analysis", "Review dictionary meanings"]],
    "4.2": [["examples", "Read usage examples for each form"], ["analysis", "Identify meanings in the corpus"]],
    "4.3": [["parts", "Identify word components"], ["components", "Research any identified components"], ["analysis", "Summarize component evidence"]],
    "4.4.1": [["metadata", "Read source authors and books"], ["sources", "Find matching passages in source books"], ["originals", "Check original-language terms"], ["authors", "Read saved author and book references"], ["comparisons", "Compare source meanings and possible origins"], ["consolidate", "Consolidate bibliographical findings"]],
    "4.4.2": [["search", "Search for possible sources"], ["analysis", "Review source evidence and publication history"]],
    "4.6": [["assign", "Assign meanings to sampled occurrences"], ["recovery", "Look for examples of missing meanings"], ["translations", "Prepare preliminary bilingual examples"]],
    "7": [["identify", "Identify uncertain target spellings"], ["spellings", "Investigate spellings that need review"]],
  };
  if (s.step === "8") return (s.meanings ?? []).filter((m) => m.enabled !== false && !m.unused).map((m) => ({
    id: m.id, label: `Meaning ${(s.meanings ?? []).indexOf(m) + 1} · ${clip(m.definition ?? "", 110)}`,
  }));
  if (s.step === "9") {
    const assignments = (s.assignments ?? []).filter((a) => !a.entryId || a.entryId === "original");
    const count = (s.passages ?? []).filter((p) => assignments.some((a) => a.paragraphId === p.id)).length;
    return Array.from({ length: Math.ceil(count / 15) }, (_, i) => ({ id: `batch-${i * 15}`, label: `Batch ${i + 1} · paragraphs ${i * 15 + 1}–${Math.min(count, (i + 1) * 15)} of ${count}` }));
  }
  return nodes(plans[s.step] ?? []);
}

// Older studies can display their saved bibliography without rerunning research.
export function studioActivityItems(study) {
  const saved = study.activitySteps?.[study.step]?.items;
  if (study.step === "2a" && saved?.length) {
    // Saved checklists may predate the original-spelling item or append it last.
    // Merge for display so opening an old study does not change its evidence.
    const planned = studioStageActivities(study);
    const ids = new Set(planned.map((item) => item.id));
    return [...planned.map((item) => {
      const recorded = saved.find((node) => node.id === item.id);
      if (item.id === "identity" && recorded?.status === "complete" && /^\d+ forms accepted as the same word\.$/u.test(recorded.result)) {
        const accepted = saved.find((node) => node.id === "accepted")?.children ?? [];
        if (accepted.length > 0 && accepted.length === Number.parseInt(recorded.result, 10) && accepted.every((node) => typeof node.label === "string" && node.label.trim())) {
          return { ...recorded, result: `${accepted.length} ${accepted.length === 1 ? "form" : "forms"} accepted as the same word: ${accepted.map((node) => node.label).join(", ")}.` };
        }
      }
      if (recorded) return recorded;
      if (item.id === "origin" && study.origin?.proposal) {
        if (!study.origin.proposal.originLanguage) return { ...item, status: "complete",
          result: "No borrowed origin identified; no original-spelling search needed." };
        if (study.origin.evidence) return { ...item, status: "complete", result: "Saved original-spelling findings are available." };
      }
      return { ...item, status: "waiting" };
    }), ...saved.filter((item) => !ids.has(item.id))];
  }
  if (saved?.length) return saved;
  const items = studioStageActivities(study);
  const report = study.steps?.[study.step]?.approved ?? study.steps?.[study.step]?.value;
  if (["8", "9"].includes(study.step)) {
    for (const item of items) {
      const index = Number(item.id.replace("batch-", ""));
      const key = study.step === "8" ? `8:${item.id}` : `9:${index}`;
      const trial = study.tests?.[key];
      if (!trial) continue;
      const assignments = studyAssignments(study, study.step === "8" ? item.id : null);
      const paragraphs = (study.passages ?? []).filter((p) => assignments.some((a) => a.paragraphId === p.id));
      const batch = study.step === "8" ? paragraphs : paragraphs.slice(index, index + 15);
      const current = study.step === "8" ? trial.signature === meaningTrialSignature(study, item.id, assignments) && trial.rounds === (study.rounds[key] ?? 0)
        : trial.signature === stableSignature(buildStudioDraft(study))
          && trial.batchSignature === entryBatchSignature(study, batch, assignments.filter((a) => batch.some((p) => p.id === a.paragraphId)));
      item.status = current && trial.passed ? "complete" : "waiting";
      item.result = `${trial.choices?.filter((choice) => choice.passed).length ?? 0} of ${trial.choices?.length ?? 0} occurrences passed in the saved test. ${current ? trial.passed ? "" : "Findings need review." : "The entry or source evidence changed; this result needs rechecking."}`;
    }
    return items;
  }
  if (!report || report.pending || report.skipped) return items;
  if (study.step !== "4.4.1") {
    for (const item of items) item.status = "complete";
    if (items.length) items.at(-1).result = summarizeStudioActivity(report);
    return items;
  }
  const authors = report.evidence?.authors;
  if (!Array.isArray(authors)) return items;
  for (const item of items) { item.status = "complete"; item.children = []; }
  items.find((n) => n.id === "authors").children = authors.map((author) => ({
    id: author.author, label: author.author, status: "complete", children: [],
    result: `${author.verifiedMentions == null ? "Unresolved mention count" : `${author.verifiedMentions} genuine mentions`}; ${author.passages?.length ?? 0} sampled source paragraphs.`,
  }));
  items.find((n) => n.id === "comparisons").children = (report.evidence?.findings ?? []).map((finding, i) => ({
    id: `batch-${i}`, label: `Comparison ${i + 1}`, status: "complete", children: [], result: summarizeStudioActivity(finding),
  }));
  items.find((n) => n.id === "originals").result = summarizeStudioActivity(report.evidence?.original);
  items.find((n) => n.id === "consolidate").result = summarizeStudioActivity(report);
  return items;
}
