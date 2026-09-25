// Counting in code. Every sampled occurrence ends as exactly one outcome:
// a selected variant, other, unresolved (with reason), failed, or not run.
// Passage (paragraph) counts and occurrence counts are kept separately.

export function aggregateCounts(counting, frozen, sample) {
  const { occurrences, judgments } = counting;
  const entries = {};
  for (const entry of frozen.entries) {
    entries[entry.id] = {
      occurrences: 0,
      passages: new Set(),
      variants: Object.fromEntries(entry.variants.map((variant) => [variant.id, {
        occurrences: 0, passages: new Set(), fit: {}, translatedExamples: 0,
      }])),
      other: 0, unresolved: {}, failed: 0, notRun: 0,
    };
  }
  entries.unassigned = {
    occurrences: 0, passages: new Set(), variants: {}, other: 0, unresolved: {}, failed: 0, notRun: 0,
  };
  const otherRenderings = new Map();
  const unresolvedNotes = [];
  const outcomes = {};
  for (const occurrence of occurrences) {
    const bucket = entries[occurrence.entryId] ?? entries.unassigned;
    bucket.occurrences += 1;
    bucket.passages.add(occurrence.itemId);
    const judgment = judgments[occurrence.occId];
    const status = judgment?.status ?? "not_run";
    outcomes[status] = (outcomes[status] ?? 0) + 1;
    if (!judgment) {
      bucket.notRun += 1;
    } else if (status === "selected") {
      const variant = bucket.variants[judgment.variantId];
      variant.occurrences += 1;
      variant.passages.add(occurrence.itemId);
      if (judgment.fit) variant.fit[judgment.fit] = (variant.fit[judgment.fit] ?? 0) + 1;
      if (judgment.sentenceTranslation) variant.translatedExamples += 1;
    } else if (status === "other") {
      bucket.other += 1;
      const key = `${occurrence.entryId}\u0000${judgment.otherRendering}`;
      otherRenderings.set(key, (otherRenderings.get(key) ?? 0) + 1);
    } else if (status === "unresolved") {
      const reason = judgment.unresolvedReason ?? "unknown";
      bucket.unresolved[reason] = (bucket.unresolved[reason] ?? 0) + 1;
      unresolvedNotes.push({ occId: occurrence.occId, reason, note: judgment.note ?? "" });
    } else {
      bucket.failed += 1;
      unresolvedNotes.push({ occId: occurrence.occId, reason: "failed", note: judgment.note ?? "" });
    }
  }
  const out = {};
  for (const [id, bucket] of Object.entries(entries)) {
    if (id === "unassigned" && !bucket.occurrences) continue;
    const variants = Object.fromEntries(Object.entries(bucket.variants).map(([variantId, v]) => [variantId, {
      occurrences: v.occurrences, passages: v.passages.size, fit: v.fit, translatedExamples: v.translatedExamples,
    }]));
    const unresolved = Object.values(bucket.unresolved).reduce((a, b) => a + b, 0);
    const reconciled = Object.values(variants).reduce((sum, v) => sum + v.occurrences, 0)
      + bucket.other + unresolved + bucket.failed + bucket.notRun;
    if (reconciled !== bucket.occurrences) {
      throw new Error(`counts do not reconcile for entry ${id}: ${reconciled} ≠ ${bucket.occurrences}`);
    }
    out[id] = {
      occurrences: bucket.occurrences, passages: bucket.passages.size, variants,
      other: bucket.other, unresolved: bucket.unresolved, failed: bucket.failed, notRun: bucket.notRun,
    };
  }
  return {
    frozenVersion: frozen.version,
    entries: out,
    totals: {
      sampleRequested: sample.nRequested,
      passagesSampled: sample.nActual,
      occurrencesSampled: occurrences.length,
      populationDistinct: sample.meta.populationDistinct,
      populationRows: sample.meta.populationRows,
      duplicateGroups: sample.meta.duplicateGroups,
      outcomes,
    },
    otherRenderings: [...otherRenderings.entries()]
      .map(([key, n]) => {
        const [entryId, rendering] = key.split("\u0000");
        return { entryId, rendering, n };
      })
      .sort((a, b) => b.n - a.n),
    unresolvedNotes,
  };
}
