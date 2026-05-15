import { createAlphabetIndexScroll } from "../lib/alphabet-index-scroll.js";

export const LANGUAGE_PICKER_LIST_SELECTOR = ".language-picker-modal__list";
const LANGUAGE_PICKER_OPTION_SELECTOR = ".language-picker-modal__option";
const LANGUAGE_PICKER_LIST_FRAME_CLASS = "language-picker-modal__list-frame";
const INITIALIZED_ATTRIBUTE = "data-language-picker-alphabet-index";

export function languagePickerOptionLabel(option) {
  const label = option?.querySelector?.("span:not(.language-picker-modal__code)")?.textContent;
  return String(label ?? option?.textContent ?? "").trim();
}

export function ensureLanguagePickerListFrame(list) {
  if (!list || typeof list.closest !== "function") {
    return null;
  }

  if (list.parentElement?.classList?.contains(LANGUAGE_PICKER_LIST_FRAME_CLASS)) {
    return list.parentElement;
  }

  const documentRef = list.ownerDocument ?? globalThis.document;
  const frame = documentRef?.createElement?.("div");
  if (!frame) {
    return null;
  }

  frame.className = LANGUAGE_PICKER_LIST_FRAME_CLASS;
  list.before(frame);
  frame.append(list);
  return frame;
}

export function syncLanguagePickerAlphabetIndexes(root = globalThis.document) {
  if (!root || typeof root.querySelectorAll !== "function") {
    return [];
  }

  const instances = [];
  const lists = [...root.querySelectorAll(LANGUAGE_PICKER_LIST_SELECTOR)];
  for (const list of lists) {
    if (list.getAttribute?.(INITIALIZED_ATTRIBUTE) === "true") {
      continue;
    }

    const host = ensureLanguagePickerListFrame(list);
    if (!host) {
      continue;
    }

    const instance = createAlphabetIndexScroll({
      scrollContainer: list,
      indexHost: host,
      itemSelector: LANGUAGE_PICKER_OPTION_SELECTOR,
      getLabel: languagePickerOptionLabel,
      includeMissing: true,
      offset: 4,
    });

    list.setAttribute?.(INITIALIZED_ATTRIBUTE, "true");
    instances.push(instance);
  }

  return instances;
}
