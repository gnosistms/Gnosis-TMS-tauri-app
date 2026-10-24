// Spending limits when related words are researched one after another:
//   main limit  — the first word's run (and any work after the related words);
//   word limit  — each related word's run;
//   total limit — everything together.
// A related word that reaches its own limit stops (resumable) and the batch
// goes on; reaching the total limit ends the batch.

export const DEFAULT_WORD_LIMIT_USD = 2;

/** A cap in case the list of related words is long; not main + words × word limit. */
export const DEFAULT_TOTAL_LIMIT_USD = 20;

/** Below this, a related word's run could not finish one request. */
export const MIN_RUN_LIMIT_USD = 0.05;

const cents = (value) => Math.floor(value * 100 + 1e-6) / 100;

export function batchSpent(queue) {
  return Object.values(queue?.spentByRun ?? {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

/** Spending of one run of the batch; recorded again when the run is resumed. */
export function recordRunSpend(queue, runId, spent) {
  if (!queue || !runId) return;
  queue.spentByRun = { ...(queue.spentByRun ?? {}), [runId]: Number(spent) || 0 };
}

/** The limit for the next related word, or null when the total is used up. */
export function nextWordLimit(queue) {
  const spent = batchSpent(queue);
  const remaining = cents(queue.totalLimit - spent);
  if (remaining < MIN_RUN_LIMIT_USD) return { limit: null, spent, remaining };
  return { limit: cents(Math.min(queue.wordLimit, remaining)), spent, remaining };
}
