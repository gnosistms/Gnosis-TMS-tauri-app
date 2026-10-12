// The steps of the research log as the run window shows them: which of a step's
// AI requests are drawn together (a batch at once), the readable view of each
// group, and what the step running now is doing. Shared by the log renderer and
// the stream updates.

import { isRequestRunning, requestState } from "./glossary-research-log-view.js";
import { liveAnswerHtml } from "./glossary-research-live-views.js";
import { elapsedText, liveStatusHtml, writingProgress } from "./glossary-research-live-progress.js";

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
  const answered = group.requests.filter((request) => request.answer);
  return answered.length ? answered.reduce((a, b) => (b.updatedAt >= a.updatedAt ? b : a)) : null;
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
  if (request?.batch?.total > 1) {
    const members = section.requests.filter((other) => other.batch?.key === request.batch.key);
    // All the uses of the batch, also those of batches not sent yet.
    const total = request.progress?.all ?? members.reduce((n, other) => n + (other.progress?.total ?? 0), 0);
    if (total) {
      const done = members.reduce((n, other) => n + (other.usage ? (other.progress?.total ?? 0) : (writingProgress(other.answer, other.progress)?.current ?? 0)), 0);
      const started = Math.min(...members.map((other) => other.startedAt || Infinity));
      const pct = Math.round((100 * done) / total);
      const atWork = members.filter((other) => !other.usage && !other.problem).length;
      return `<span class="research-live__doing">${done} of ${total} uses of the word translated${atWork ? ` · ${atWork} ${atWork === 1 ? "batch" : "batches"} at work` : ""}</span>`
        + `<span class="research-live__bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><span style="width:${pct}%"></span></span>`
        + (Number.isFinite(started) ? `<span class="research-live__clock">${elapsedText(Date.now() - started)}</span>` : "");
    }
  }
  if (request) return liveStatusHtml(request, requestState(request), usualFor?.(request.stage) ?? null);
  // A progress line is what happens now until a finding, or an AI request, comes after it.
  const last = [...section.items].reverse().find((item) => item.kind === "line" && item.entry.type !== "problem");
  const waiting = last && /^Waiting for you\b/.test(last.entry.text ?? "") ? last : null;
  if (waiting && !runningRequest(section)) return `<span class="research-live__doing">${esc(waiting.entry.text)}</span>`;
  const working = '<span class="research-live__doing">Working…</span>';
  const index = section.items.findLastIndex((item) => item.kind === "line" && item.entry.type === "info");
  if (index < 0) return working;
  const line = section.items[index];
  const after = section.items.slice(index + 1).some((item) => item.kind === "line" && item.entry.type !== "info");
  const requestAfter = section.requests.some((request) => (request.startedAt ?? 0) > (line.entry.at ?? 0));
  return after || requestAfter ? working : `<span class="research-live__doing">${esc(line.entry.text)}</span>`;
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
  "Sampling": "Sample paragraphs",
  "Parts and frequency": "Meanings",
  "Candidate checks": "Checking the candidates",
  "Candidate frequency": "How common the candidates are",
  "Counting": "Choosing a translation for each use",
  "Discovery": "Free translation",
  "Rare translations": "Notes for rare translations",
  "Counting (second judge)": "Choosing again, by a second AI",
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
    "Word family": "Related words from the same root; you can choose to research some of them next.",
    "Sampling": `Paragraphs from ${texts} that use ${term}, picked at random; the proposed translations are tried on them later.`,
    "Where the term comes from": `Did ${context.author ?? "the author"} take ${term} from another book? If so, its original word.`,
    "Parts and frequency": `The meanings of ${term}, and how common each is in everyday ${source}.`,
    "Candidate translations": `Possible ${target} translations for each meaning.`,
    "Candidate checks": "What each candidate is made of, the meaning each of its words must have, and which might be false friends.",
    "Candidate frequency": `How often each candidate is used in everyday ${target} (news sentences), in the meaning needed; too rare fails.`,
    "Discovery": "An AI translates some of the sample paragraphs freely, with no suggestions: what comes naturally?",
    "Proposal": "The proposed glossary entry: its translations, and when to use each.",
    "Shared translations": "Is a proposed translation already used for a word with a different meaning?",
    "Existing glossary entry": "The proposal compared with the glossary's current entry.",
    "Review": "Your turn: check the proposed translations (you can remove or add some), then press Count to try them on the sample paragraphs.",
    "Counting": `An AI translates each sample paragraph from ${texts} with the proposed entry and chooses a translation for each use; we count the choices.`,
    "Counting (second judge)": "A second AI does the same on its own, to check the first.",
    "Rare translations": "Do translations that are rare in everyday use need a note?",
    "Summary": "A short written summary for the report.",
  };
  return lines[heading] ?? "";
}
