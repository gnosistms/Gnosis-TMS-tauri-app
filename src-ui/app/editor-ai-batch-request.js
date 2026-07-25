// Batch assembly shared by AI Translate All and AI Review: splitting the flat
// per-row work list into model batches, and deduping glossary hints once per
// batch instead of per row.

import {
  buildEditorAiTranslationGlossaryHints,
  normalizeGlossaryToken,
} from "./editor-glossary-highlighting.js";
import { estimateSourceTokens } from "./editor-ai-context-window.js";

// Batch-size defaults. AI_BATCH_MAX_ROWS is calibrated from the OpenAI experiment
// (no quality cliff through 100 rows; 15 keeps per-batch latency responsive and
// the failure blast radius small). AI_BATCH_TOKEN_TARGET is a guard against a run
// of unusually long rows blowing up a single prompt, not a measured quality point.
export const AI_BATCH_MAX_ROWS = 15;
export const AI_BATCH_TOKEN_TARGET = 4000;
// Pool size for concurrent AI calls in a Translate All / Review All run
// (see plans/ai-batch-parallelization-plan.md). 3 keeps three ~4k-token
// requests in flight — under typical per-minute token limits for
// team-provided keys. The slot semaphore in editor-ai-batch-pool.js makes
// this the cap on ALL in-flight AI calls for a run, batch requests and
// per-row fallbacks alike.
export const AI_BATCH_CONCURRENCY = 3;

function pairKey(item) {
  return `${item?.sourceLanguageCode ?? ""}::${item?.targetLanguageCode ?? ""}`;
}

// Reorders a row-major work list into contiguous language-pair groups, keeping
// row order within each group and group order by first appearance. Translate All
// builds work rows-outer/languages-inner, so with 2+ target languages selected
// consecutive items alternate pairs and would chunk into nothing but singleton
// batches without this grouping.
export function groupWorkByLanguagePair(work) {
  const groups = new Map();
  for (const item of Array.isArray(work) ? work : []) {
    const key = pairKey(item);
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return [...groups.values()].flat();
}

// Splits a row-ordered work list into batches of consecutive items that share a
// language pair and glossary kind, bounded by row count and a source-token
// budget. Derived-glossary rows batch together like any other kind; the batch
// runner derives their pivot glossary once for the whole batch. Each batch is
// { items, glossaryKind }.
export function chunkTranslateAllWork(work, options = {}) {
  const maxRows = Number.isFinite(options.maxRows) && options.maxRows > 0
    ? options.maxRows
    : AI_BATCH_MAX_ROWS;
  const tokenTarget = Number.isFinite(options.tokenTarget) && options.tokenTarget > 0
    ? options.tokenTarget
    : AI_BATCH_TOKEN_TARGET;
  const glossaryKindForItem = typeof options.glossaryKindForItem === "function"
    ? options.glossaryKindForItem
    : () => "none";
  const sourceTokensForItem = typeof options.sourceTokensForItem === "function"
    ? options.sourceTokensForItem
    : () => 0;

  const batches = [];
  let current = null;
  let currentTokens = 0;

  const flush = () => {
    if (current) {
      batches.push(current);
      current = null;
      currentTokens = 0;
    }
  };

  for (const item of Array.isArray(work) ? work : []) {
    const glossaryKind = glossaryKindForItem(item);
    const tokens = Math.max(0, Number(sourceTokensForItem(item)) || 0);
    const joinsCurrent =
      current
      && current.glossaryKind === glossaryKind
      && pairKey(current.items[0]) === pairKey(item)
      && current.items.length < maxRows
      && currentTokens + tokens <= tokenTarget;

    if (joinsCurrent) {
      current.items.push(item);
      currentTokens += tokens;
    } else {
      flush();
      current = { items: [item], glossaryKind };
      currentTokens = tokens;
    }
  }

  flush();
  return batches;
}

// Runs the glossary matcher over each row's source text and unions the resulting
// hints, deduped by normalized source term, so the batch prompt carries one
// glossary block. Per-row match + union (rather than matching one concatenated
// blob) avoids spurious matches that would span row boundaries.
export function buildBatchGlossaryHints(
  sourceTexts,
  sourceLanguageCode,
  targetLanguageCode,
  glossaryModel,
) {
  const perRowHints = (Array.isArray(sourceTexts) ? sourceTexts : []).map((sourceText) =>
    buildEditorAiTranslationGlossaryHints(
      sourceText,
      sourceLanguageCode,
      targetLanguageCode,
      glossaryModel,
    ),
  );
  return mergeGlossaryHintLists(perRowHints, sourceLanguageCode);
}

// Unions already-built per-row hint lists into one list deduped by normalized
// source term (first occurrence wins), matching the single-row builder's key.
export function mergeGlossaryHintLists(hintLists, sourceLanguageCode) {
  const seen = new Set();
  const hints = [];
  for (const rowHints of Array.isArray(hintLists) ? hintLists : []) {
    for (const hint of Array.isArray(rowHints) ? rowHints : []) {
      const key = normalizeGlossaryToken(hint?.sourceTerm ?? "", sourceLanguageCode);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      hints.push(hint);
    }
  }
  return hints;
}

// Runs `task` over `items` with at most `limit` in flight at once, preserving
// input order in the returned results. Used to load per-row history for a review
// batch without firing every git-log invoke at once.
export async function mapWithConcurrency(items, limit, task) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  const workerCount = Math.min(Math.max(1, limit), list.length || 1);
  let cursor = 0;

  const runWorker = async () => {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(list[index], index);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

export { estimateSourceTokens };
