// Readable live views of AI answers while they stream in, one per kind of
// answer. Each takes the request (its stage and the progress hint the engine
// attached) and the answer read so far (parsePartialJson), and returns HTML, or
// null to fall back to the plain indented JSON.

import { parsePartialJson } from "./glossary-research-partial-json.js";

const escapeHtml = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * Sorting general-corpus sentences by meaning: one bar per meaning, in the order
 * the meanings were given, growing as sentences are sorted. The scale is the
 * number of sentences sent, so bars only ever grow.
 */
function sensesView(request, value) {
  const hint = request.progress ?? {};
  const senses = Array.isArray(hint.senses) ? hint.senses : [];
  if (!senses.length) return null;
  const items = Array.isArray(value?.items) ? value.items : [];
  const counts = new Map();
  let sorted = 0;
  for (const item of items) {
    if (typeof item?.sense !== "string") continue;
    sorted += 1;
    counts.set(item.sense, (counts.get(item.sense) ?? 0) + 1);
  }
  const total = hint.total > 0 ? hint.total : Math.max(sorted, 1);
  const rows = [
    ...senses.map((sense) => ({ id: sense.id, label: sense.gloss, kind: sense.id === "needed" ? "needed" : "sense" })),
    { id: "other", label: "another meaning", kind: "rest" },
    { id: "not_this_word", label: "not this word (a name, another word)", kind: "rest" },
  ];
  const done = Boolean(request.usage);
  const heading = `${done ? "Sorted" : "Sorting"} ${done ? sorted : `${sorted} of ${total}`} general ${escapeHtml(hint.language ?? "")} sentences with “${escapeHtml(hint.word ?? "")}” by meaning`;
  return `
    <div class="research-view research-view--senses">
      <p class="research-view__heading">${heading}</p>
      <p class="research-view__explain">Each sentence is put under the meaning it uses. A meaning's share of the sentences becomes its share of the word's frequency score.</p>
      <div class="research-chart" role="table" aria-label="Sentences per meaning">
        ${rows.map((row) => {
          const n = counts.get(row.id) ?? 0;
          if (row.kind === "rest" && !n) return "";
          const pct = (100 * n) / total;
          const share = sorted ? Math.round((100 * n) / sorted) : 0;
          return `<div class="research-chart__row research-chart__row--${row.kind}" role="row" title="${n} of ${sorted} sorted sentences (${share}%)">
            <span class="research-chart__label" role="cell" title="${escapeHtml(row.label)}">${row.kind === "needed" ? '<span class="research-chart__tag">needed</span> ' : ""}${escapeHtml(row.label)}</span>
            <span class="research-chart__track" role="cell"><span class="research-chart__bar" style="width:${pct}%"></span><span class="research-chart__value">${n}</span></span>
          </div>`;
        }).join("")}
      </div>
    </div>`;
}

const VIEWS = {
  senses: sensesView,
};

/** HTML for the answer of a request so far, or null when there is no view for it. */
export function liveAnswerHtml(request) {
  const view = VIEWS[request?.progress?.view];
  if (!view || !request.answer) return null;
  const value = parsePartialJson(request.answer);
  if (!value) return null;
  try {
    return view(request, value);
  } catch {
    return null;
  }
}
