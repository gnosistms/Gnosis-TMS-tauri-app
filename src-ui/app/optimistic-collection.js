export function applyPendingMutations(snapshot, pendingMutations, applyMutation) {
  return pendingMutations.reduce(
    (current, mutation) => applyMutation(current, mutation),
    {
      items: [...snapshot.items],
      deletedItems: [...snapshot.deletedItems],
    },
  );
}

export function removePendingMutation(pendingMutations, mutationId) {
  return pendingMutations.filter((mutation) => mutation.id !== mutationId);
}

export function upsertPendingMutation(pendingMutations, nextMutation) {
  return [...removePendingMutation(pendingMutations, nextMutation.id), nextMutation];
}

export function replaceItem(items, nextItem) {
  let found = false;
  const nextItems = items.map((item) => {
    if (item.id === nextItem.id) {
      found = true;
      return nextItem;
    }

    return item;
  });

  return found ? nextItems : [nextItem, ...items];
}

export function removeItem(items, itemId) {
  return items.filter((item) => item.id !== itemId);
}
