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
  // After a cancel nothing is happening in the step, whatever requests were cut short.
  if (section.items.some((item) => item.kind === "line" && /^Cancelled\b/.test(item.entry.text ?? ""))) return "";
  const request = runningRequest(section);
  if (request) return liveStatusHtml(request, requestState(request), usualFor?.(request.stage) ?? null);
  // A progress line is what happens now until a finding, or an AI request, comes after it.
  const index = section.items.findLastIndex((item) => item.kind === "line" && item.entry.type === "info");
  if (index < 0) return "";
  const line = section.items[index];
  const after = section.items.slice(index + 1).some((item) => item.kind === "line" && item.entry.type !== "info");
  const requestAfter = section.requests.some((request) => (request.startedAt ?? 0) > (line.entry.at ?? 0));
  return after || requestAfter ? "" : `<span class="research-live__doing">${esc(line.entry.text)}</span>`;
}

/** The current step's head status, for the clock and the stream updates. */
export function currentStepStatus(sections, usualFor) {
  const titled = sections.filter((section) => section.heading);
  const section = titled.at(-1);
  return section ? stepStatus(section, usualFor) : "";
}

// Step names as the person reads them (the log keeps the engine's names, so
// saved runs read the same).
const STEP_TITLES = {
  "Sampling": "Sample passages",
  "Parts and frequency": "Meanings",
  "Candidate checks": "Checking the candidates",
  "Discovery": "Free translation",
  "Rare translations": "Notes for rare translations",
};

export function stepTitle(heading) {
  return STEP_TITLES[heading] ?? heading;
}

/**
 * What a step does, in one short line, for someone who knows the app but not
 * the research. `context`: { term, texts, author, source, target }.
 */
export function stepExplanation(heading, context = {}) {
  const term = context.term ? `“${context.term}”` : "the term";
  const texts = context.texts ?? "the texts";
  const source = context.source ?? "source-language";
  const target = context.target ?? "target-language";
  const lines = {
    "Dictionary": `The standard meanings of ${term}, from a ${source} dictionary.`,
    "Word forms": `Every spelling of ${term} to search for in ${texts}.`,
    "Word family": "Related words from the same root, which may need their own research.",
    "Sampling": `Passages from ${texts} that use ${term}, picked at random to test translations on.`,
    "Where the term comes from": `Did ${context.author ?? "the author"} take ${term} from another book? If so, its original word.`,
    "Parts and frequency": `The meanings of ${term}, and how common each is in everyday ${source}.`,
    "Candidate translations": `Possible ${target} translations for each meaning.`,
    "Candidate checks": `Is each candidate common enough in everyday ${target}, in the meaning needed?`,
    "Discovery": "An AI translates sample passages freely, with no suggestions: what comes naturally?",
    "Proposal": "The proposed glossary entry: its translations, and when to use each.",
    "Shared translations": "Is a proposed translation already used for a word with a different meaning?",
    "Existing glossary entry": "The proposal compared with the glossary's current entry.",
    "Review": "Your turn: check the proposed translations, then press Count to test them on the sample passages.",
    "Counting": "An AI translates each sample passage with the proposed entry; we count which translation it uses.",
    "Counting (second judge)": "A second AI does the same, to check the first.",
    "Rare translations": "Do translations that are rare in everyday use need a note?",
    "Summary": "A short written summary for the report.",
  };
  return lines[heading] ?? "";
}
