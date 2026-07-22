function listboxRoot(target) {
  return target instanceof Element ? target.closest("[data-listbox-control]") : null;
}

function optionsFor(root) {
  return Array.from(root.querySelectorAll("[data-listbox-option]"));
}

function setOpen(root, open, { focusSelected = false } = {}) {
  const trigger = root.querySelector("[data-listbox-trigger]");
  const popover = root.querySelector(".listbox-control__popover");
  if (!(trigger instanceof HTMLButtonElement) || !(popover instanceof HTMLElement)) {
    return;
  }

  trigger.setAttribute("aria-expanded", open ? "true" : "false");
  popover.hidden = !open;
  if (open && focusSelected) {
    const selected = root.querySelector('[data-listbox-option][aria-selected="true"]');
    (selected instanceof HTMLButtonElement ? selected : optionsFor(root)[0])?.focus();
  }
}

function closeOtherListboxes(activeRoot = null) {
  document.querySelectorAll("[data-listbox-control]").forEach((root) => {
    if (root !== activeRoot) {
      setOpen(root, false);
    }
  });
}

function selectOption(root, option) {
  const nativeSelect = root.querySelector(".listbox-control__native");
  const valueDisplay = root.querySelector("[data-listbox-value]");
  const trigger = root.querySelector("[data-listbox-trigger]");
  if (!(nativeSelect instanceof HTMLSelectElement)) {
    return;
  }

  nativeSelect.value = option.dataset.value ?? "";
  if (valueDisplay) {
    valueDisplay.textContent = option.textContent?.trim() ?? "";
  }
  optionsFor(root).forEach((entry) => {
    const selected = entry === option;
    entry.classList.toggle("is-selected", selected);
    entry.setAttribute("aria-selected", selected ? "true" : "false");
  });
  setOpen(root, false);
  trigger?.focus();
  nativeSelect.dispatchEvent(new Event("change", { bubbles: true }));
}

function moveOptionFocus(option, direction) {
  const root = listboxRoot(option);
  if (!root) {
    return;
  }
  const options = optionsFor(root);
  const currentIndex = options.indexOf(option);
  const nextIndex = direction === "first"
    ? 0
    : direction === "last"
      ? options.length - 1
      : (currentIndex + direction + options.length) % options.length;
  options[nextIndex]?.focus();
}

export function registerListboxControlEvents() {
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const root = listboxRoot(target);
    const trigger = target?.closest("[data-listbox-trigger]");
    const option = target?.closest("[data-listbox-option]");

    if (root && trigger instanceof HTMLButtonElement) {
      const open = trigger.getAttribute("aria-expanded") !== "true";
      closeOtherListboxes(root);
      setOpen(root, open, { focusSelected: open });
      return;
    }
    if (root && option instanceof HTMLButtonElement) {
      selectOption(root, option);
      return;
    }
    closeOtherListboxes();
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const root = listboxRoot(target);
    if (!root) {
      return;
    }

    const trigger = target?.closest("[data-listbox-trigger]");
    const option = target?.closest("[data-listbox-option]");
    if (trigger && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      closeOtherListboxes(root);
      setOpen(root, true, { focusSelected: true });
      return;
    }
    if (!(option instanceof HTMLButtonElement)) {
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveOptionFocus(option, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      moveOptionFocus(option, event.key === "Home" ? "first" : "last");
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectOption(root, option);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(root, false);
      root.querySelector("[data-listbox-trigger]")?.focus();
    }
  });
}
