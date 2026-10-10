// The research log as the run window shows it: results by section on top
// (what each step found, laid out with the app's own type and colours), and
// a live panel below that follows one AI request as it streams in.

import { formatUsd } from "../app/glossary-research-budget.js";
import { tooltipAttributes } from "../lib/ui.js";
import {
  isRequestRunning,
  requestBatch,
  requestState,
  requestStatusText,
  requestTitle,
  sectionSummary,
  stageName,
} from "../app/glossary-research-log-view.js";
import { formatJsonStream, formatThinkingLive, formatThinkingSteps, thinkingSteps } from "../app/glossary-research-stream-format.js";
import { groupViewHtml, requestGroups, stepExplanation, stepStatus, stepTitle, viewRequest, VIEW_LEFT_OUT } from "../app/glossary-research-step-view.js";
import { stepDisplay } from "../app/glossary-research-live-views.js";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Progress lines that replace each other: data downloads and corpus counts.
const DOWNLOAD_LINE = /^(Downloading|Downloaded) |^Counting \d+ words? in the general /;

// --- results ---------------------------------------------------------------------

function sectionMetaText(section) {
  const { count, seconds, costUsd, running, failed } = section.meta;
  if (!count) return "";
  const parts = [];
  if (count > 1) parts.push(`${count} requests`);
  if (running) parts.push(running === count ? "running…" : `${running} running`);
  if (seconds) parts.push(`${Math.round(seconds)} s`);
  if (costUsd) parts.push(formatUsd(costUsd));
  if (failed) parts.push(`<span class="research-section__failed">${failed} failed</span>`);
  return parts.join(" · ");
}

function renderLine(entry) {
  const text = esc(entry.text);
  switch (entry.type) {
    case "fact":
      return `<p class="research-line">${text}</p>`;
    case "problem":
      return `<p class="research-line research-line--problem" role="alert">${text}</p>`;
    default:
      return `<p class="research-line research-line--muted">${text}</p>`;
  }
}

function chips(members, recommended) {
  return members.map((member, index) => `<span class="research-chip${recommended ? " research-chip--recommended" : ""}">${recommended && index === 0 ? "★ " : ""}${esc(member)}</span>`).join("");
}

const RESULT_RENDERERS = {
  candidates(data) {
    return data.map((sense) => `
      <div class="research-result__group">
        <div class="research-result__sub">${esc(sense.sense)}</div>
        ${(sense.groups ?? []).map((group) => `<div class="research-chip-row">${chips(group.members ?? [], group.recommended)}</div>`).join("")}
      </div>`).join("");
  },
  checks(data) {
    const verdictText = { pass: "passes", fail: "fails", unclear: "unclear", unchecked: "not checked" };
    return `<div class="research-checks">${data.map((check) => {
      const details = [...(check.reasons ?? []), ...(check.notes ?? []), ...(check.clashes ?? [])];
      return `<div class="research-checks__target">${esc(check.target)}</div>
        <div class="research-checks__verdict research-checks__verdict--${esc(check.verdict)}">${esc(verdictText[check.verdict] ?? check.verdict)}</div>
        ${details.length ? `<div class="research-checks__details">${details.map(esc).join("<br>")}</div>` : ""}`;
    }).join("")}</div>`;
  },
};

function stats(figures) {
  return `<div class="research-stats">${figures.filter(Boolean).map(([value, label]) => `<span class="research-stat"><strong>${esc(value)}</strong> ${esc(label)}</span>`).join("")}</div>`;
}

const zipfText = (value) => (value == null ? "—" : Number(value).toFixed(2));

Object.assign(RESULT_RENDERERS, {
  // item.light: runs saved while a light study for rare related words existed.
  sampling([item]) {
    return stats([
      [item.distinct.toLocaleString("en-US"), `${item.distinct === 1 ? "paragraph uses" : "paragraphs use"} the word (each counted once)`],
      item.light ? ["all", "read by both AIs"] : [item.measuring, "picked at random to test translations on"],
      !item.light && item.discovery ? [item.discovery, "of them also translated with no suggestions (see Free translation)"] : null,
    ]);
  },
  discovery([item]) {
    return `${stats([[`${item.read} of ${item.total}`, "read"], [item.renderings, "different renderings"]])}
      <div class="research-chip-row">${(item.top ?? []).map(([rendering, count]) => `<span class="research-chip">${esc(rendering)} <span class="research-chip__count">${esc(count)}</span></span>`).join("")}</div>`;
  },
  proposal(data) {
    return data.map((entry) => `
      <div class="research-result__group">
        <div class="research-result__sub">${esc((entry.sourceTerms ?? []).join(" / "))}</div>
        <div class="research-chip-row">${chips(entry.variants ?? [], false)}</div>
      </div>`).join("");
  },
  dictionary([item]) {
    return `<div class="research-dictionary">${item.url ? `<a class="research-result__sub" href="${esc(item.url)}" target="_blank" rel="noreferrer">${esc(item.sourceName)}</a>` : `<span class="research-result__sub">${esc(item.sourceName)}</span>`}<pre class="research-dictionary__text">${esc(item.text)}</pre></div>`;
  },
  agreement([item]) {
    return stats([[`${item.agreed} of ${item.compared}`, "uses where the two AIs chose the same translation"]]);
  },
  senses(data) {
    return data.map((sense) => `
      <div class="research-result__group">
        <div class="research-result__lead">${sense.label ? `<strong>${esc(sense.label)}</strong>${sense.partOfSpeech || sense.wordClass ? ` <span class="research-result__sub">(${esc(sense.partOfSpeech || sense.wordClass)})</span>` : ""} — ` : ""}${esc(sense.sense)}</div>
        ${sense.sourceBook || sense.originalTerm ? `<div class="research-result__sub">${[
          sense.sourceBook ? `from ${esc(sense.sourceBook)}` : "",
          sense.originalTerm ? `original ${esc(sense.originalLanguage ?? "")} term “${esc(sense.originalTerm)}”${sense.verified === false ? " (unverified)" : ""}` : "",
        ].filter(Boolean).join(" · ")}</div>` : sense.inDictionary ? `<div class="research-result__sub">ordinary meaning (in the dictionary)</div>` : ""}
      </div>`).join("");
  },
  shared(data) {
    const verdict = { same: ["same meaning here: sharing is fine", "pass"], different: ["different meanings", "fail"] };
    return `<div class="research-checks">${data.map((pair) => {
      const [text, tone] = verdict[pair.relation] ?? ["not judged", "unchecked"];
      return `<div class="research-checks__target">“${esc(pair.target)}” for ${esc(pair.sourceTerms?.[0])} and ${esc(pair.otherSourceTerms?.[0])}</div>
        <div class="research-checks__verdict research-checks__verdict--${tone}">${esc(text)}</div>
        <div class="research-checks__details">${esc(pair.passages)} sampled passages with both${pair.sameSentence ? `, ${esc(pair.sameSentence)} in one sentence` : ""}${pair.reason ? `. ${esc(pair.reason)}` : ""}</div>`;
    }).join("")}</div>`;
  },
  frequency(data) {
    const parts = data.filter((item) => item.kind === "parts");
    const rows = data.filter((item) => item.kind === "measure" || item.kind === "term");
    return `${parts.map((item) => `<div class="research-chip-row research-parts">${item.parts.map((part, index) => `${index ? '<span class="research-parts__plus">+</span>' : ""}<span class="research-chip">${esc(part.part)}</span><span class="research-parts__meaning">${esc(part.meaning)}</span>`).join("")}</div>`).join("")}
      ${rows.length ? `<table class="research-measures"><thead><tr><th>Word</th><th>How common (0 never – 7 most common)</th><th>In the meaning needed (how common; sentences)</th></tr></thead><tbody>${rows.map((row) => row.kind === "term"
        ? `<tr><td>${esc(row.word)} <span class="research-result__sub">${esc(row.language)}</span></td><td>${zipfText(row.zipf)}</td><td>${row.invented ? "the author's own word: not in the dictionary, practically absent from general use" : ""}${(row.senses ?? []).map((sense) => `<div>${esc(sense.gloss)}: ${esc(sense.senseText)}</div>`).join("")}</td></tr>`
        : `<tr><td>${esc(row.word)} <span class="research-result__sub">${esc(row.language)}</span></td><td>${zipfText(row.zipf)}</td><td>${esc(row.neededSense)}: ${esc(row.senseText)}</td></tr>`).join("")}</tbody></table>` : ""}`;
  },
});

function renderResult(item) {
  const renderer = RESULT_RENDERERS[item.resultKind];
  if (renderer && item.data) {
    try {
      return `<div class="research-result research-result--${esc(item.resultKind)}">${renderer(item.data)}</div>`;
    } catch {
      // Fall back to the text the finding was logged with.
    }
  }
  return item.texts.map((text) => renderLine({ type: "fact", text })).join("");
}

/** Download progress lines in a row collapse into the latest one. */
function collapseDownloads(items) {
  const out = [];
  for (const item of items) {
    const isDownload = item.kind === "line" && DOWNLOAD_LINE.test(item.entry.text ?? "");
    if (isDownload && out.at(-1)?.download) out[out.length - 1] = { ...item, download: true };
    else out.push(isDownload ? { ...item, download: true } : item);
  }
  return out;
}


// --- steps -------------------------------------------------------------------------

// A step's AI answers are shown as their readable views; these finished-step
// findings say the same as a view, so they are left out when the view is there.
const COVERED_BY_VIEW = { candidates: "candidates", proposal: "proposal", sources: "senses", discovery: "discovery" };
/**
 * A request whose answer has no readable view yet: the exchange itself (the
 * answer as indented JSON, the thinking and what was sent folded), so nothing
 * is hidden until a view exists for it.
 */
function exchangeHtml(request) {
  const running = isRequestRunning(request);
  return `<div class="research-exchange-plain">
      ${request.thinking && !running ? howItWorked(request) : ""}
      ${request.answer ? `<pre class="research-live__answer" data-live-answer>${formatJsonStream(request.answer)}</pre>` : ""}
      ${request.text || request.instructions ? `<details class="research-step__fold"><summary>What was sent</summary>${request.instructions ? `<div class="research-live__label">Instructions</div><div class="research-live__text">${esc(request.instructions)}</div>` : ""}${request.text ? `<div class="research-live__label">Texts and question</div><div class="research-live__text">${esc(request.text)}</div>` : ""}</details>` : ""}
    </div>`;
}

/** The thinking of a request still thinking: the only thing that arrives in real time until its answer starts. */
function thinkingHtml(request) {
  return `<div class="research-step__thinking" data-live-thinking="${esc(request.requestId)}">${formatThinkingLive(request.thinking)}</div>`;
}

/** A finished request's thinking, folded to one line: how the AI got to its answer, step by step. */
function howItWorked(request) {
  const steps = thinkingSteps(request.thinking).filter((step) => step.title).length;
  if (!steps) return "";
  return `<details class="research-step__fold"><summary>How the AI got there (${steps} ${steps === 1 ? "step" : "steps"})</summary><div class="research-thought">${formatThinkingSteps(request.thinking)}</div></details>`;
}

/** One group of requests as the step shows it: its view, else the exchange; and the thinking while it thinks. */
function groupBlock(group, current) {
  const parts = [];
  const view = groupViewHtml(group);
  const request = viewRequest(group);
  // No "The AI's answer" label: nearly everything in the steps is the AI's, and the
  // program's findings say where they come from in their own words (Hans, 2026-10-10).
  if (view) {
    parts.push(`<div class="research-step__view" data-view-key="${esc(group.key)}">${view}</div>`);
  }
  else if (request && !VIEW_LEFT_OUT.has(request.stage)) parts.push(`<div class="research-step__view research-step__view--plain" data-view-key="${esc(group.key)}">${exchangeHtml(request)}</div>`);
  return parts.join("");
}


/**
 * Everything a step shows, the same while it runs and afterwards: the readable
 * views of its AI answers (the exchange itself where an answer has no view yet,
 * and the thinking while it thinks), the findings the views do not cover, and
 * its notes and problems. Progress lines are left out.
 */
function stepBody(section, current, context = {}) {
  // A step with one display that fills in (words with their counts, meanings
  // with their bars, candidates with their measurements) draws it first; what it
  // drew is not drawn again.
  const display = stepDisplay(section, { ...context, sections: context.sections ?? [] });
  const drawn = display?.requests ?? new Set();
  const groups = requestGroups(section.requests.filter((request) => !drawn.has(request.requestId)));
  const covered = new Set(display?.results ?? []);
  // Findings and answers keep their order of arrival: a fact found before a
  // request stays above its answer (Hans, 2026-10-09).
  const views = groups.map((group) => {
    const stage = group.requests[0]?.stage;
    if (COVERED_BY_VIEW[stage] && groupViewHtml(group)) covered.add(COVERED_BY_VIEW[stage]);
    return { at: Math.max(0, section.requests.indexOf(group.requests[0])), html: groupBlock(group, current) };
  });
  const cancelled = section.items.some((item) => item.kind === "line" && /^Cancelled\b/.test(item.entry.text ?? ""));
  const findings = collapseDownloads(section.items)
    .filter((item) => (item.kind === "result" ? !covered.has(item.resultKind) : item.entry.type === "fact" || item.entry.type === "problem"))
    .filter((item) => !(item.kind === "line" && (display?.facts ?? []).some((pattern) => pattern.test(item.entry.text ?? ""))))
    // "Research was cancelled." repeats the "Cancelled…" line.
    .filter((item) => !(cancelled && item.kind === "line" && /^Research was cancelled/.test(item.entry.text ?? "")))
    .map((item) => ({ at: item.at ?? Number.MAX_SAFE_INTEGER, html: item.kind === "result" ? renderResult(item) : renderLine(item.entry) }));
  const failed = section.requests.filter((request) => requestState(request) === "failed" && !cancelled)
    .map((request) => renderLine({ type: "problem", text: `${stageName(request.stage)}: ${request.problem || "the AI request failed"}` })).join("");
  // The AI's thinking is not shown (Hans, 2026-10-09): the now line says it is thinking.
  // A finding logged when k requests had started comes before request k.
  const blocks = [...findings.map((block) => ({ ...block, order: 0 })), ...views.map((block) => ({ ...block, order: 1 }))];
  if (display?.after) blocks.push({ at: views.length ? views.at(-1).at : -1, order: 2, html: display.html });
  const body = blocks.sort((a, b) => a.at - b.at || a.order - b.order).map((block) => block.html).join("");
  return display?.after ? `${body}${failed}` : `${display?.html ?? ""}${body}${failed}`;
}

function stepMetaText(section) {
  const { seconds, costUsd } = section.meta;
  return [seconds ? `${Math.round(seconds)} s` : "", costUsd ? formatUsd(costUsd) : ""].filter(Boolean).join(" · ");
}

/**
 * One step. The step running now is open and fills in as it goes; a finished
 * step folds to one line of what it found and opens to its final state.
 */
function renderSection(section, { current, open, usualFor, context, later }) {
  if (!section.heading) {
    const body = stepBody(section, current);
    return body ? `<section class="research-section research-section--untitled">${body}</section>` : "";
  }
  const summary = current ? "" : section.heading === "Review" && later ? "You reviewed the proposal and started the count." : sectionSummary(section);
  // A step whose content only repeats the line it folds to has nothing more to open.
  const full = current ? "" : stepBody(section, false, context);
  const plain = !current && (later && section.heading === "Review"
    || full.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim() === summary.replace(/[&<>"']/g, " ").replace(/\s+/g, " ").trim()
    || !full.trim());
  // The step running now is open unless the person folded it.
  const expanded = current ? open !== false : open === true && !plain;
  const body = current ? (expanded ? stepBody(section, true, context) : "") : expanded ? full : "";
  const meta = current ? "" : stepMetaText(section);
  const status = current ? stepStatus(section, usualFor) : "";
  const title = esc(stepTitle(section.heading));
  const explanation = expanded ? stepExplanation(section.heading, context) : "";
  const head = current
    ? `<button type="button" class="research-section__head research-section__toggle" data-action="toggle-research-current:${esc(section.id)}" aria-expanded="${expanded}">
        <svg class="research-disclosure__chevron" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1.5 6.5 5 3 8.5" /></svg>
        <h4 class="research-section__title"><span class="navigation-loading-modal__spinner research-section__spinner" aria-hidden="true"></span>${title}</h4>
        ${expanded ? "" : `<span class="research-section__status" data-step-status>${status}</span>`}
      </button>`
    : plain
      // Nothing more to open: the line is the step, and what it does shows on hover.
      ? `<div class="research-section__head research-section__head--plain"${tooltipAttributes(stepExplanation(section.heading, context))}>
          <h4 class="research-section__title">${title}</h4>
          ${summary ? `<span class="research-section__summary">${esc(summary)}</span>` : ""}
          ${meta ? `<span class="research-section__meta">${meta}</span>` : ""}
        </div>`
      : `<button type="button" class="research-section__head research-section__toggle" data-action="toggle-research-section:${esc(section.id)}" aria-expanded="${expanded}">
        <svg class="research-disclosure__chevron" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1.5 6.5 5 3 8.5" /></svg>
        <h4 class="research-section__title">${title}</h4>
        ${summary ? `<span class="research-section__summary">${esc(summary)}</span>` : ""}
        ${meta ? `<span class="research-section__meta">${meta}</span>` : ""}
      </button>`;
  return `<section class="research-section${current ? " is-current" : ""}${expanded ? " is-open" : ""}" data-section-id="${esc(section.id)}"${current ? " data-step-current" : ""}>
      ${head}
      ${explanation ? `<p class="research-section__explain">${esc(explanation)}</p>` : ""}
      ${body || (current && expanded) ? `<div class="research-section__body">${body}${current && expanded ? `<div class="research-step__now research-section__status" data-step-status>${status}</div>` : ""}</div>` : ""}
    </section>`;
}

/**
 * The steps, oldest first: while research runs the last one is the step in
 * progress. `usualFor(stage)` gives a step's usual duration for the clock.
 */
export function renderResults(sections, { running = false, openSections = {}, usualFor = null, context: given = {} } = {}) {
  const context = { ...given, sections };
  const titled = sections.filter((section) => section.heading);
  const currentId = running ? titled.at(-1)?.id : null;
  const lastId = titled.at(-1)?.id;
  return sections.map((section) => renderSection(section, {
    current: section.id === currentId,
    open: openSections[section.id],
    usualFor,
    context,
    later: section.id !== lastId,
  })).join("");
}

// --- progress line -----------------------------------------------------------------

/** The stages on the progress line, each standing for the steps logged under it. */
export const RESEARCH_STAGES = [
  { label: "Dictionary", steps: ["Dictionary", "Word forms", "Word family"] },
  { label: "Texts", steps: ["Sampling", "Where the term comes from"] },
  { label: "Candidates", steps: ["Parts and frequency", "Candidate translations", "Candidate checks"] },
  { label: "Proposal", steps: ["Discovery", "Proposal", "Existing glossary entry", "Shared translations"] },
  { label: "Review", steps: ["Review"] },
  { label: "Counting", steps: ["Counting", "Counting (second judge)"] },
  { label: "Report", steps: ["Rare translations", "Summary", "Done"] },
];

export function stageIndex(stepLabel, runStatus) {
  if (runStatus === "done") return RESEARCH_STAGES.length;
  if (runStatus === "review") return RESEARCH_STAGES.findIndex((stage) => stage.label === "Review");
  if (runStatus === "family") return 0;
  const index = RESEARCH_STAGES.findIndex((stage) => stage.steps.includes(stepLabel));
  return index < 0 ? 0 : index;
}

/** A line with a labelled dot per stage: done, the one in progress, and those to come. */
export function renderStageLine({ stepLabel, runStatus }) {
  const current = stageIndex(stepLabel, runStatus);
  const stopped = runStatus === "failed" || runStatus === "stopped";
  return `<ol class="research-steps" aria-label="Research progress">${RESEARCH_STAGES.map((stage, index) => {
    const state = index < current ? "done" : index === current ? (stopped ? "stopped" : "current") : "todo";
    return `<li class="research-steps__item research-steps__item--${state}"${state === "current" ? ' aria-current="step"' : ""}>
        <span class="research-steps__dot" aria-hidden="true"></span>
        <span class="research-steps__label">${esc(stage.label)}</span>
      </li>`;
  }).join("")}</ol>`;
}

