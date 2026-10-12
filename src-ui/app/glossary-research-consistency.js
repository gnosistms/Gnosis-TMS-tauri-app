// The consistency test (Hans, 2026-10-12). After the votes, a few sentences per
// meaning are translated five times each with the finished entry, as a translator
// will see it. A translator that takes turns between translations for the same
// sentence ("flips") has no clear choice:
//   - when the translations it flips between mean the same there, the one chosen
//     most often becomes the standard for that meaning and the others are dropped
//     from it (a tie: the same sentences again, five more times, until one wins);
//   - when they change what the reader understands, the person decides before
//     saving: keep one, or write notes that tell them apart (then test again).
// This replaces grouping candidates as "interchangeable" before any test.

/** Translations of each sentence per round. */
export const CONSISTENCY_ROUNDS = 5;
/** A safety stop against runaway cost for a true coin-flip: translations of one set's sentences. */
export const MAX_CONSISTENCY_TRANSLATIONS = 50;

/** The meaning a counted use has: the first meaning label of the translation chosen for it. */
function meaningOf(variant) {
  return (variant?.senses ?? [])[0] ?? "";
}

/**
 * The sentences to test: per entry with two or more translations, up to
 * `perMeaning` counted uses per meaning (the meaning of the translation the first
 * count chose), uses the two counts disagreed on first; at most `perEntry` per
 * entry, the meanings with most uses first. Returns [{ entryId, meaning, occId }].
 */
export function pickSentences({ frozen, proposal, counting, counting2 = null, perMeaning = 3, perEntry = 15 }) {
  const variants = new Map((proposal?.entries ?? []).flatMap((entry) => entry.variants.map((variant) => [variant.id, variant])));
  const picks = [];
  for (const entry of frozen?.entries ?? []) {
    if ((entry.variants ?? []).length < 2) continue;
    const byMeaning = new Map();
    for (const occurrence of counting?.occurrences ?? []) {
      if (occurrence.entryId !== entry.id) continue;
      const judgment = counting.judgments?.[occurrence.occId];
      if (judgment?.status !== "selected" || !judgment.variantId) continue;
      const meaning = meaningOf(variants.get(judgment.variantId)) || judgment.variantId;
      const second = counting2?.judgments?.[occurrence.occId];
      const disagreed = second?.status === "selected" && second.variantId && second.variantId !== judgment.variantId;
      byMeaning.set(meaning, [...(byMeaning.get(meaning) ?? []), { occId: occurrence.occId, disagreed }]);
    }
    const meanings = [...byMeaning.entries()].sort((a, b) => b[1].length - a[1].length);
    let taken = 0;
    for (const [meaning, uses] of meanings) {
      const ordered = [...uses.filter((use) => use.disagreed), ...uses.filter((use) => !use.disagreed)];
      for (const use of ordered.slice(0, perMeaning)) {
        if (taken >= perEntry) break;
        picks.push({ entryId: entry.id, meaning, occId: use.occId });
        taken += 1;
      }
    }
  }
  return picks;
}

/**
 * Adds one round of answers to the tally: per occId, how often each translation
 * was chosen and one translated sentence for each. `rows`: the answer items.
 */
export function addRound(tally, rows) {
  for (const row of rows ?? []) {
    if (!row?.occId) continue;
    const entry = tally.get(row.occId) ?? { choices: {}, translations: {}, other: 0, rounds: 0 };
    entry.rounds += 1;
    if (row.status === "selected" && row.variantId) {
      entry.choices[row.variantId] = (entry.choices[row.variantId] ?? 0) + 1;
      entry.translations[row.variantId] ??= row.sentenceTranslation ?? "";
    } else {
      entry.other += 1;
    }
    tally.set(row.occId, entry);
  }
  return tally;
}

/** The sentences where the translator chose more than one translation: [{ occId, variantIds, choices, translations }]. */
export function flipsOf(tally) {
  const flips = [];
  for (const [occId, entry] of tally) {
    const variantIds = Object.keys(entry.choices).sort((a, b) => entry.choices[b] - entry.choices[a]);
    if (variantIds.length > 1) flips.push({ occId, variantIds, choices: entry.choices, translations: entry.translations });
  }
  return flips;
}

/**
 * Joins flips into sets of translations that flip with one another (within one
 * entry), separately for flips that keep and that change the meaning. `entryOf`
 * maps an occId to its entry id; `sameMeaning` maps an occId to true or false.
 * Returns [{ entryId, same, variantIds, occIds }].
 */
export function flipSets(flips, entryOf, sameMeaning) {
  const sets = [];
  for (const flip of flips) {
    const same = sameMeaning.get(flip.occId) !== false;
    const entryId = entryOf(flip.occId);
    const joined = sets.filter((set) => set.entryId === entryId && set.same === same && set.variantIds.some((id) => flip.variantIds.includes(id)));
    const merged = {
      entryId, same,
      variantIds: [...new Set([...flip.variantIds, ...joined.flatMap((set) => set.variantIds)])],
      occIds: [...new Set([flip.occId, ...joined.flatMap((set) => set.occIds)])],
    };
    for (const set of joined) sets.splice(sets.indexOf(set), 1);
    sets.push(merged);
  }
  return sets;
}

/** How often each translation of a set was chosen in its sentences: { variantId: n }. */
export function setVotes(set, tally) {
  const votes = Object.fromEntries(set.variantIds.map((id) => [id, 0]));
  for (const occId of set.occIds) {
    for (const [id, n] of Object.entries(tally.get(occId)?.choices ?? {})) if (id in votes) votes[id] += n;
  }
  return votes;
}

/** The translation chosen most often, or null when two or more are tied at the top. */
export function winnerOf(votes) {
  const ordered = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  if (!ordered.length || (ordered[1] && ordered[1][1] === ordered[0][1])) return null;
  return ordered[0][0];
}

/**
 * The meanings each translation serves, as an explicit list (Hans, 2026-10-12):
 * the meanings the entry gives it, and the meaning of every tested sentence the
 * translator chose it for. `senses`: variantId → its meaning labels; `meaningOf`:
 * occId → the meaning of a tested sentence. Returns Map variantId → Set(meanings).
 */
export function meaningsOfVariants({ senses = new Map(), tally = new Map(), meaningOf = new Map() } = {}) {
  const meanings = new Map();
  const add = (id, meaning) => {
    if (!meaning) return;
    if (!meanings.has(id)) meanings.set(id, new Set());
    meanings.get(id).add(meaning);
  };
  for (const [id, labels] of senses) for (const label of labels ?? []) add(id, label);
  for (const [occId, entry] of tally) {
    for (const [id, n] of Object.entries(entry.choices ?? {})) if (n > 0) add(id, meaningOf.get(occId));
  }
  return meanings;
}

/**
 * Settles every standardised meaning at once (Hans, 2026-10-12: a word is removed
 * only when no meaning uses it; deciding meaning by meaning, two meanings sharing a
 * word could each keep it for the other). Each set takes its meanings off the
 * translations that lost there; only then is a translation with no meaning left
 * dropped. `standardised`: [{ keep, variantIds, meanings }]. Returns
 * { dropped: [ids], narrowed: [{ variantId, removed: [meanings], kept: [meanings] }] }.
 */
export function settleMeanings(standardised, meanings) {
  const left = new Map([...meanings].map(([id, set]) => [id, new Set(set)]));
  const removed = new Map();
  for (const set of standardised) {
    for (const id of set.variantIds) {
      if (id === set.keep) continue;
      for (const meaning of set.meanings ?? []) {
        left.get(id)?.delete(meaning);
        removed.set(id, new Set([...(removed.get(id) ?? []), meaning]));
      }
    }
  }
  const dropped = [];
  const narrowed = [];
  for (const [id, gone] of removed) {
    if (!(left.get(id)?.size)) dropped.push(id);
    else narrowed.push({ variantId: id, removed: [...gone], kept: [...left.get(id)] });
  }
  return { dropped, narrowed };
}
