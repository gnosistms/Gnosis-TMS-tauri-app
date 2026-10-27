// Decisions are occurrence-scoped. Defaults follow current book order, while an
// explicit checked or unchecked value survives reordering and reopening.
export function imageReviewChoices(group) {
  const items = new Map();
  for (const occurrence of group.occurrences) {
    if (!items.has(occurrence.itemId)) items.set(occurrence.itemId, { ...occurrence, occurrences: [], choiceId: `image:${group.id}:${occurrence.itemId}` });
    items.get(occurrence.itemId).occurrences.push(occurrence);
  }
  return [...items.values()];
}
export function reviewChoiceIncluded(choices, id, index) {
  return Object.hasOwn(choices || {}, id) ? choices[id] === true : index === 0;
}
export function bookRedundancyExclusions(modal, itemId) {
  const review = modal.book?.redundancy;
  if (!review?.result) return [];
  const excluded = [];
  for (const group of review.result.images || []) {
    imageReviewChoices(group).forEach((entry, index) => {
      const included = reviewChoiceIncluded(review.choices, entry.choiceId, index);
      entry.occurrences.forEach((occurrence, offset) => {
        if (occurrence.itemId === itemId && (!included || offset > 0)) excluded.push(occurrence);
      });
    });
  }
  for (const group of review.result.footnotes || []) group.occurrences.forEach((occurrence, index) => {
    if (occurrence.itemId === itemId && !reviewChoiceIncluded(review.choices, occurrence.id, index)) excluded.push(occurrence);
  });
  return excluded.map(({ rowId, kind, marker, signature }) => ({ rowId, kind, marker, signature }));
}
