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
 * What standardising a set does to the translations that lost (Hans, 2026-10-12:
 * "we can't drop a word if it's in use by another meaning"). A loser is DROPPED
 * from the entry only when no other meaning uses it; otherwise it stays and is
 * only taken off the set's meanings ("narrowed"). A translation is in use by
 * another meaning when the entry gives it a meaning the set's sentences do not
 * have, or when the translator chose it, even once, for a tested sentence with
 * another meaning.
 * `senses`: variantId → its meaning labels; `meaningOf`: occId → the meaning of
 * a tested sentence. Returns { dropped: [ids], narrowed: [{ variantId, meanings }] }.
 */
export function standardise(set, winner, tally, { senses = new Map(), meaningOf = new Map() } = {}) {
  const setMeanings = new Set(set.occIds.map((occId) => meaningOf.get(occId)).filter(Boolean));
  const dropped = [];
  const narrowed = [];
  for (const id of set.variantIds) {
    if (id === winner) continue;
    const listed = (senses.get(id) ?? []).filter((meaning) => !setMeanings.has(meaning));
    const chosenElsewhere = [...tally].some(([occId, entry]) => (
      !set.occIds.includes(occId) && (entry.choices[id] ?? 0) > 0 && !setMeanings.has(meaningOf.get(occId))
    ));
    if (listed.length || chosenElsewhere) narrowed.push({ variantId: id, meanings: [...setMeanings] });
    else dropped.push(id);
  }
  return { dropped, narrowed };
}
