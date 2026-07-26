function choiceGroup(target) {
  return target instanceof Element ? target.closest("[data-roving-choice-group]") : null;
}

function choiceOption(target) {
  return target instanceof Element ? target.closest("[data-roving-choice-option]") : null;
}

function enabledOptions(group) {
  return Array.from(group?.querySelectorAll?.("[data-roving-choice-option]") ?? [])
    .filter((option) => (
      option instanceof HTMLElement
      && !option.matches(":disabled")
      && option.getAttribute("aria-disabled") !== "true"
      && !option.hidden
    ));
}

function selectedOption(options) {
  return options.find((option) => (
    option.getAttribute("aria-checked") === "true"
    || option.getAttribute("aria-selected") === "true"
  )) ?? null;
}

export function normalizeRovingChoiceGroups(root = document) {
  const groups = Array.from(root?.querySelectorAll?.("[data-roving-choice-group]") ?? []);
  groups.forEach((group) => {
    const allOptions = Array.from(
      group.querySelectorAll("[data-roving-choice-option]"),
    ).filter((option) => option instanceof HTMLElement);
    const options = enabledOptions(group);
    const tabStop = options.find((option) => option.tabIndex === 0)
      ?? selectedOption(options)
      ?? options[0]
      ?? null;

    allOptions.forEach((option) => {
      option.tabIndex = option === tabStop ? 0 : -1;
    });
  });
}

function directionForKey(group, key) {
  const axis = group?.dataset?.rovingChoiceAxis ?? "both";
  if (axis !== "vertical" && key === "ArrowLeft") {
    return -1;
  }
  if (axis !== "vertical" && key === "ArrowRight") {
    return 1;
  }
  if (axis !== "horizontal" && key === "ArrowUp") {
    return -1;
  }
  if (axis !== "horizontal" && key === "ArrowDown") {
    return 1;
  }
  return 0;
}

function focusOption(group, current, destination) {
  const options = enabledOptions(group);
  if (options.length === 0) {
    return;
  }

  const currentIndex = Math.max(0, options.indexOf(current));
  const nextIndex = destination === "first"
    ? 0
    : destination === "last"
      ? options.length - 1
      : (currentIndex + destination + options.length) % options.length;
  const next = options[nextIndex];
  options.forEach((option) => {
    option.tabIndex = option === next ? 0 : -1;
  });
  next.focus({ preventScroll: true });
  if (group.dataset.rovingChoiceSelectionFollowsFocus === "true") {
    next.click();
  }
}

export function registerRovingChoiceEvents(doc = document) {
  normalizeRovingChoiceGroups(doc);
  doc.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.repeat || event.isComposing) {
      return;
    }

    const option = choiceOption(event.target);
    const group = choiceGroup(option);
    if (!(option instanceof HTMLElement) || !(group instanceof HTMLElement)) {
      return;
    }

    const direction = directionForKey(group, event.key);
    if (direction !== 0) {
      event.preventDefault();
      focusOption(group, option, direction);
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusOption(group, option, event.key === "Home" ? "first" : "last");
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      option.click();
    }
  });
}
