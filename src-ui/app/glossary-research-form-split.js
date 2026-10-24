// One entry or several: forms of a word (vanidad, vanidades) stay in one glossary
// entry only when the same translations serve all of them; otherwise each gets its
// own entry, linked to the others as siblings. Decided from the count's votes,
// form by form (Hans, 2026-10-08):
//   - a translation serves a form when it gets at least 5% of that form's votes;
//   - two forms go together only when the same translations serve both
//     (shared translations / all their translations = 1);
//   - groups are joined step by step, only while EVERY pair of forms in the joined
//     group passes (so a chain a~b~c never forces a with c);
//   - a form with fewer than 10 sampled uses is not judged on its own: it joins the
//     group it shares most with on the votes it has, else the most-used form's group.

export const SERVE_SHARE = 0.05;
/** Two forms go together when their shared translations reach this share of all their translations. */
export const TOGETHER_AT = 1;
export const MIN_FORM_USES = 10;

const formKey = (text) => String(text ?? "").normalize("NFC").toLowerCase().trim();

/** Shared translations over all translations of either form (0 when neither has any). */
export function overlap(a, b) {
  const union = new Set([...a, ...b]);
  if (!union.size) return 0;
  let shared = 0;
  for (const v of a) if (b.has(v)) shared += 1;
  return shared / union.size;
}

/**
 * Groups of an entry's forms. `votes` is a list of { form, variantId } (one per
 * judge's choice; variantId null when no listed translation fitted); `uses` counts
 * the sampled occurrences per form. Returns [{ forms, thin }] largest first, where
 * `thin` lists forms placed without enough data; a single group means no split.
 */
export function groupForms(forms, votes, uses, options = {}) {
  const serveShare = options.serveShare ?? SERVE_SHARE;
  const together = options.together ?? TOGETHER_AT;
  const minUses = options.minUses ?? MIN_FORM_USES;
  const keys = [...new Set(forms.map(formKey))].filter(Boolean);
  const perForm = new Map(keys.map((k) => [k, new Map()]));
  const totals = new Map(keys.map((k) => [k, 0]));
  for (const vote of votes) {
    const k = formKey(vote.form);
    if (!perForm.has(k)) continue;
    totals.set(k, totals.get(k) + 1);
    if (vote.variantId) perForm.get(k).set(vote.variantId, (perForm.get(k).get(vote.variantId) ?? 0) + 1);
  }
  const serves = new Map(keys.map((k) => {
    const total = totals.get(k);
    return [k, new Set([...perForm.get(k)].filter(([, n]) => total && n / total >= serveShare).map(([v]) => v))];
  }));
  const usesOf = (k) => uses.get(k) ?? 0;
  const judged = keys.filter((k) => usesOf(k) >= minUses);
  const thin = keys.filter((k) => usesOf(k) < minUses);
  if (judged.length < 2) return [{ forms: keys, thin: judged.length ? thin : keys }];

  const groups = judged.map((k) => [k]);
  const worstPair = (a, b) => {
    let worst = 1;
    for (const x of a) for (const y of b) worst = Math.min(worst, overlap(serves.get(x), serves.get(y)));
    return worst;
  };
  for (;;) {
    let best = null;
    for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        const score = worstPair(groups[i], groups[j]);
        if (score >= together && (!best || score > best.score)) best = { i, j, score };
      }
    }
    if (!best) break;
    groups[best.i] = [...groups[best.i], ...groups[best.j]];
    groups.splice(best.j, 1);
  }

  const groupUses = (group) => group.reduce((n, k) => n + usesOf(k), 0);
  groups.sort((a, b) => groupUses(b) - groupUses(a));
  const placedThin = groups.map(() => []);
  for (const k of thin) {
    let target = 0;
    let bestScore = 0;
    groups.forEach((group, index) => {
      const score = Math.max(...group.map((g) => overlap(serves.get(k), serves.get(g))));
      if (score > bestScore) {
        bestScore = score;
        target = index;
      }
    });
    groups[target] = [...groups[target], k];
    placedThin[target].push(k);
  }
  // Forms keep the entry's order inside each group.
  return groups.map((group, index) => ({ forms: keys.filter((k) => group.includes(k)), thin: placedThin[index] }));
}
