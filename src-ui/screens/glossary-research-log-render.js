// The research log as the run window shows it: results by section on top
// (what each step found, laid out with the app's own type and colours), and
// a live panel below that follows one AI request as it streams in.

import { formatUsd } from "../app/glossary-research-budget.js";
import {
  isRequestRunning,
  requestBatch,
  requestState,
  requestStatusText,
  requestTitle,
  stageName,
} from "../app/glossary-research-log-view.js";
import { formatJsonStream, formatThinking } from "../app/glossary-research-stream-format.js";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const DOWNLOAD_LINE = /^(Downloading|Downloaded) /;

// --- results ---------------------------------------------------------------------

function sectionMetaHtml(section) {
  const { count, seconds, costUsd, running, failed } = section.meta;
  if (!count) return "";
  const parts = [];
  if (count > 1) parts.push(`${count} requests`);
  if (running) parts.push(running === count ? "running…" : `${running} running`);
  if (seconds) parts.push(`${Math.round(seconds)} s`);
  if (costUsd) parts.push(formatUsd(costUsd));
  if (failed) parts.push(`<span class="research-section__failed">${failed} failed</span>`);
  const shown = section.requests.find(isRequestRunning) ?? section.requests.at(-1);
  return `<span class="research-section__meta">${parts.join(" · ")}${parts.length ? " · " : ""}`
    + `<button type="button" class="research-section__details" data-action="show-research-request:${esc(shown.requestId)}">details ›</button></span>`;
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

function renderSection(section) {
  const body = collapseDownloads(section.items)
    .map((item) => (item.kind === "result" ? renderResult(item) : renderLine(item.entry)))
    .join("");
  if (!section.heading) return body ? `<section class="research-section research-section--untitled">${body}</section>` : "";
  return `<section class="research-section">
      <div class="research-section__head">
        <h4 class="research-section__title">${esc(section.heading)}</h4>
        ${sectionMetaHtml(section)}
      </div>
      ${body ? `<div class="research-section__body">${body}</div>` : ""}
    </section>`;
}

export function renderResults(sections) {
  return sections.map(renderSection).join("");
}

// --- live panel ------------------------------------------------------------------

function usageLine(usage) {
  if (usage.line) return usage.line;
  return `${(usage.inputTokens ?? 0).toLocaleString("en-US")} tokens in (${(usage.cachedTokens ?? 0).toLocaleString("en-US")} cached), `
    + `${(usage.outputTokens ?? 0).toLocaleString("en-US")} out (${(usage.reasoningTokens ?? 0).toLocaleString("en-US")} thinking) · `
    + `${formatUsd(usage.costUsd)}${usage.costIsEstimate ? " (reserved; outcome unknown)" : ""} · ${Number(usage.seconds ?? 0).toFixed(1)} s`;
}

/** The thinking and answer blocks, also used to update the panel while text streams in. */
export function liveBlockHtml(type, text) {
  return type === "thinking" ? formatThinking(text) : formatJsonStream(text);
}

function liveTitle(request) {
  return request.batch && request.batch.total > 1 ? `${stageName(request.stage)} · ${requestTitle(request)}` : requestTitle(request);
}

function batchSwitcher(batch, shown) {
  return `<span class="research-live__batch">
      <span data-live-batch-progress>${batch.done} of ${batch.total} done${batch.running ? `, ${batch.running} running` : ""}</span>
      <span class="research-live__switcher">${batch.requests.map((request) => `<button type="button"
          class="research-live__pick research-live__pick--${requestState(request)}${request.requestId === shown.requestId ? " is-current" : ""}"
          data-action="show-research-request:${esc(request.requestId)}" aria-label="Show batch ${request.batch.number}">${request.batch.number}</button>`).join("")}</span>
    </span>`;
}

/**
 * The panel under the results. `request` is the one shown; while research
 * runs with nothing streaming it stays as one line; `open` folds the body.
 */
export function renderLivePanel({ sections, request, running, open, picked }) {
  if (!request) {
    return running
      ? `<div class="research-live research-live--idle"><div class="research-live__head"><span class="research-live__title">Waiting for the next AI request…</span></div></div>`
      : "";
  }
  const state = requestState(request);
  const batch = requestBatch(sections, request);
  const id = esc(request.requestId);
  const body = !open ? "" : `<div class="research-live__body" data-live-body>
      ${request.text || request.instructions ? `<details class="research-live__sent"><summary>What was sent</summary>`
        + `${request.instructions ? `<div class="research-live__label">Instructions</div><div class="research-live__text">${esc(request.instructions)}</div>` : ""}`
        + `${request.text ? `<div class="research-live__label">Texts and question</div><div class="research-live__text">${esc(request.text)}</div>` : ""}</details>` : ""}
      ${request.thinking ? `<div class="research-live__label">Thinking</div><div class="research-live__thinking" data-live-type="thinking">${liveBlockHtml("thinking", request.thinking)}</div>` : ""}
      ${request.answer ? `<div class="research-live__label">Answer</div><pre class="research-live__answer" data-live-type="answer-delta">${liveBlockHtml("answer-delta", request.answer)}</pre>` : ""}
      ${request.problem ? `<p class="research-line research-line--problem">${esc(request.problem)}</p>` : ""}
      ${request.usage ? `<div class="research-live__usage">${esc(usageLine(request.usage))}</div>` : ""}
    </div>`;
  return `<div class="research-live research-live--${state}${open ? " is-open" : ""}" data-research-live data-live-request="${id}" data-live-state="${state}" data-live-open="${open}">
      <div class="research-live__head">
        <button type="button" class="research-live__toggle" data-action="toggle-research-live" aria-expanded="${open}">
          <svg class="research-disclosure__chevron" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1.5 6.5 5 3 8.5" /></svg>
          <span class="research-live__title">${esc(liveTitle(request))}</span>
        </button>
        <span class="research-live__status" data-live-status>${esc(requestStatusText(request, formatUsd))}</span>
        ${isRequestRunning(request) ? '<span class="navigation-loading-modal__spinner research-live__spinner" aria-hidden="true"></span>' : ""}
        ${batch ? batchSwitcher(batch, request) : ""}
        ${picked ? `<button type="button" class="research-live__close" data-action="close-research-live" aria-label="${running ? "Follow the running request" : "Close"}" title="${running ? "Follow the running request" : "Close"}">×</button>` : ""}
      </div>
      ${body}
    </div>`;
}
