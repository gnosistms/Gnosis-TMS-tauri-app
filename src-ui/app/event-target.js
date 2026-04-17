export function eventTargetElement(target) {
  if (target instanceof Element) {
    return target;
  }

  const parentElement =
    target && typeof target === "object" && "parentElement" in target
      ? target.parentElement
      : null;
  return parentElement instanceof Element ? parentElement : null;
}

export function closestEventTarget(target, selector) {
  return eventTargetElement(target)?.closest?.(selector) ?? null;
}
