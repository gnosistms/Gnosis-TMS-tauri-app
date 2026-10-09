// What the live panel can say about a request while it runs. The provider sends
// no progress while the model thinks, so the panel shows a clock against how
// long the same step took before, and the latest thinking title; once the answer
// streams in, finished items are counted against the number expected.

import { readPersistentValue, writePersistentValue } from "./persistent-store.js";

const TIMINGS_KEY = "glossary-research-step-timings";
const KEEP = 20;
// Fewer earlier timings than this give no usual range.
const MIN_SAMPLES = 3;
// A request this many times its usual middle duration is called out.
const SLOW_FACTOR = 3;

const timingKey = (modelId, stage) => `${modelId ?? ""}|${stage ?? ""}`;

/** Earlier durations in seconds of one step with one model, oldest first. */
export function stepTimings(modelId, stage, read = readPersistentValue) {
  const all = read(TIMINGS_KEY, {}) ?? {};
  return Array.isArray(all[timingKey(modelId, stage)]) ? all[timingKey(modelId, stage)] : [];
}

/** Remember how long a finished request took (only successful ones say anything about the step). */
export function recordStepTiming(modelId, stage, seconds, { read = readPersistentValue, write = writePersistentValue } = {}) {
  if (!modelId || !stage || !(seconds > 0)) return;
  const all = { ...(read(TIMINGS_KEY, {}) ?? {}) };
  const key = timingKey(modelId, stage);
  all[key] = [...(Array.isArray(all[key]) ? all[key] : []), Math.round(seconds * 10) / 10].slice(-KEEP);
  write(TIMINGS_KEY, all);
}

/** True once the timings of saved runs have been added. */
export function timingsSeeded(read = readPersistentValue) {
  return Boolean((read(TIMINGS_KEY, {}) ?? {}).__seeded);
}

/** Add the timings of saved runs once, so the first run after an update already has a usual range. */
export function seedStepTimings(runs, { read = readPersistentValue, write = writePersistentValue } = {}) {
  const all = { ...(read(TIMINGS_KEY, {}) ?? {}) };
  if (all.__seeded) return false;
  for (const run of runs) {
    for (const record of run.usage ?? []) {
      if (record.status !== "ok" || !(record.seconds > 0) || !run.modelId) continue;
      const key = timingKey(run.modelId, record.stage);
      all[key] = [...(all[key] ?? []), Math.round(record.seconds * 10) / 10].slice(-KEEP);
    }
  }
  all.__seeded = true;
  write(TIMINGS_KEY, all);
  return true;
}

function quantile(sorted, q) {
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

/** The usual stretch of a step: its middle half of earlier durations, or null with too few. */
export function usualRange(seconds) {
  const known = seconds.filter((s) => s > 0).sort((a, b) => a - b);
  if (known.length < MIN_SAMPLES) return null;
  return { low: quantile(known, 0.25), high: quantile(known, 0.75), middle: quantile(known, 0.5) };
}

/** "usually 2–4 min" or "usually 30–50 s". */
export function usualText(range) {
  if (!range) return "";
  if (range.high >= 90) {
    const low = Math.max(1, Math.round(range.low / 60));
    const high = Math.max(low, Math.round(range.high / 60));
    return low === high ? `usually about ${low} min` : `usually ${low}–${high} min`;
  }
  const round = (s) => Math.max(5, Math.round(s / 5) * 5);
  const low = round(range.low);
  const high = Math.max(low, round(range.high));
  return low === high ? `usually about ${low} s` : `usually ${low}–${high} s`;
}

/** "0:42", "3:05", "1:02:10". */
export function elapsedText(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** True when a running request has gone well past its usual time. */
export function isSlow(range, elapsedMs) {
  return Boolean(range) && elapsedMs / 1000 > Math.max(range.high, range.middle * SLOW_FACTOR);
}

/** The last thinking title (a line that is exactly **Title**), or "". */
export function latestThinkingTitle(thinking) {
  const titles = [...String(thinking ?? "").matchAll(/^\s*\*\*(.+?)\*\*\s*$/gm)];
  return titles.length ? titles[titles.length - 1][1].trim() : "";
}

/**
 * How far the answer has got: each item of the answer opens with the same field
 * (the request's key), so its count in the streamed text is the item being written.
 * Null when the request does not say what to count.
 */
export function writingProgress(answer, progress) {
  if (!progress?.key) return null;
  const pattern = new RegExp(`"${progress.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:`, "g");
  const started = (String(answer ?? "").match(pattern) ?? []).length;
  if (!started) return null;
  const total = progress.total > 0 ? progress.total : null;
  return { current: total ? Math.min(started, total) : started, total, unit: progress.unit ?? "item" };
}

/** "translation 12 of 31", "meaning 3". */
export function writingText(p) {
  if (!p) return "";
  const units = p.unit === "use" ? "uses of the word" : `${p.unit}s`;
  return p.total ? `${p.current} of ${p.total} ${units}` : `${p.current} ${p.current === 1 ? p.unit : units}`;
}

const escapeHtml = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * The live panel's status for a running request: what it is doing (waiting,
 * the latest thinking title, or the item being written with a bar), a clock,
 * and how long the step usually takes. `phase` is requestState(request).
 */
export function liveStatusHtml(request, phase, usual, now = Date.now()) {
  const elapsed = request.startedAt ? now - request.startedAt : 0;
  let doing = request.purpose ? `Asking the AI to ${request.purpose}` : "Waiting for the AI";
  let bar = "";
  if (phase === "thinking") {
    // What it was asked stays in view; its thinking shows below the status.
    doing = request.purpose ? `Asking the AI to ${request.purpose} (thinking)` : "The AI is thinking";
  } else if (phase === "writing") {
    const progress = writingProgress(request.answer, request.progress);
    // The answer itself is on screen above; only how far it has got is added.
    // "Writing: 8 spellings", "3 of 8 spellings checked": how far the answer on screen has got.
    doing = progress ? (request.progress?.verb ? `${writingText(progress)} ${request.progress.verb}` : `The AI is writing: ${writingText(progress)}`) : "The AI is writing…";
    if (progress?.total) {
      const pct = Math.round((100 * Math.max(0, progress.current - 0.5)) / progress.total);
      bar = `<span class="research-live__bar" role="progressbar" aria-valuemin="0" aria-valuemax="${progress.total}" aria-valuenow="${progress.current}"><span style="width:${pct}%"></span></span>`;
    }
  }
  const clock = request.startedAt ? elapsedText(elapsed) : "";
  const usualPart = usual ? ` · ${usualText(usual)}` : "";
  const slow = isSlow(usual, elapsed) ? ` · <span class="research-live__slow">taking much longer than usual</span>` : "";
  return `<span class="research-live__doing">${escapeHtml(doing)}</span>${bar}`
    + `${clock ? `<span class="research-live__clock">${clock}${escapeHtml(usualPart)}${slow}</span>` : ""}`;
}
