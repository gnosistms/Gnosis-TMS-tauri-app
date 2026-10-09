// The steps of the research log as the run window shows them: which of a step's
// AI requests are drawn together (a batch at once), the readable view of each
// group, and what the step running now is doing. Shared by the log renderer and
// the stream updates.

import { isRequestRunning, requestState } from "./glossary-research-log-view.js";
import { liveAnswerHtml } from "./glossary-research-live-views.js";
import { liveStatusHtml } from "./glossary-research-live-progress.js";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Steps whose findings say more than their AI answer: the answer's view is left out.
export const VIEW_LEFT_OUT = new Set(["convergence"]);

/** A step's requests as shown: one group per batch, one per request on its own. */
export function requestGroups(requests) {
  const groups = [];
  const byKey = new Map();
  for (const request of requests) {
    const key = request.batch && request.batch.total > 1 ? `batch:${request.batch.key}` : `request:${request.requestId}`;
    let group = byKey.get(key);
    if (!group) {
      group = { key, requests: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.requests.push(request);
  }
  return groups;
}

/** The request a group's view is drawn from: the one being written, else the last with an answer. */
export function viewRequest(group) {
  const writing = group.requests.filter((request) => requestState(request) === "writing");
  if (writing.length) return writing.reduce((a, b) => (b.updatedAt >= a.updatedAt ? b : a));
  return [...group.requests].reverse().find((request) => request.answer) ?? null;
}

/** The readable view of one group of requests (a whole batch at once), or "". */
export function groupViewHtml(group) {
  const request = viewRequest(group);
  if (!request || VIEW_LEFT_OUT.has(request.stage)) return "";
  const final = !group.requests.some(isRequestRunning);
  const batch = group.requests.length > 1 ? group.requests : null;
  return liveAnswerHtml(request, { batch, final }) ?? "";
}

/** The step's latest running request, whose status the step's head shows. */
export function runningRequest(section) {
  const running = section.requests.filter(isRequestRunning);
  return running.length ? running.reduce((a, b) => (b.updatedAt >= a.updatedAt ? b : a)) : null;
}

/** What the step running now is doing: its AI request's status, else its latest progress line. */
export function stepStatus(section, usualFor) {
  const request = runningRequest(section);
  if (request) return liveStatusHtml(request, requestState(request), usualFor?.(request.stage) ?? null);
  const line = [...section.items].reverse().find((item) => item.kind === "line" && item.entry.type === "info");
  return line ? `<span class="research-live__doing">${esc(line.entry.text)}</span>` : "";
}

/** The current step's head status, for the clock and the stream updates. */
export function currentStepStatus(sections, usualFor) {
  const titled = sections.filter((section) => section.heading);
  const section = titled.at(-1);
  return section ? stepStatus(section, usualFor) : "";
}
