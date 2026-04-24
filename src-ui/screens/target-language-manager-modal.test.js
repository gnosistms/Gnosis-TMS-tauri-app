import test from "node:test";
import assert from "node:assert/strict";

import { renderTargetLanguageManagerModal } from "./target-language-manager-modal.js";

test("target language manager modal renders ordered disabled language rows with add and save controls", () => {
  const html = renderTargetLanguageManagerModal({
    targetLanguageManager: {
      isOpen: true,
      status: "idle",
      error: "",
      chapterId: "chapter-1",
      isPickerOpen: false,
      languages: [
        { code: "es", name: "Spanish", role: "source" },
        { code: "en", name: "English", role: "target" },
      ],
    },
  });

  assert.match(html, /Spanish \(es\)/);
  assert.match(html, /English \(en\)/);
  assert.match(html, /data-target-language-manager-row/);
  assert.match(html, /data-target-language-manager-handle/);
  assert.match(html, /data-action="open-target-language-manager-picker"/);
  assert.match(html, /data-action="submit-target-language-manager"/);
});

test("target language manager modal renders a nested picker with only languages not already present", () => {
  const html = renderTargetLanguageManagerModal({
    targetLanguageManager: {
      isOpen: true,
      status: "idle",
      error: "",
      chapterId: "chapter-1",
      isPickerOpen: true,
      languages: [
        { code: "es", name: "Spanish", role: "source" },
        { code: "en", name: "English", role: "target" },
      ],
    },
  });

  assert.match(html, /<h2 class="modal__title">Add Language<\/h2>/);
  assert.doesNotMatch(html, /data-action="select-target-language-manager-picker-language:es"/);
  assert.match(html, /data-action="select-target-language-manager-picker-language:vi"/);
  assert.match(html, /data-action="add-target-language-manager-language"[^>]*disabled/);
  assert.match(html, /data-action="close-target-language-manager-picker"/);
});

test("target language manager picker enables add language after a language is selected", () => {
  const html = renderTargetLanguageManagerModal({
    targetLanguageManager: {
      isOpen: true,
      status: "idle",
      error: "",
      chapterId: "chapter-1",
      isPickerOpen: true,
      pickerSelectedLanguageCode: "vi",
      languages: [
        { code: "es", name: "Spanish", role: "source" },
        { code: "en", name: "English", role: "target" },
      ],
    },
  });

  assert.match(html, /language-picker-modal__option is-selected/);
  assert.match(html, /data-action="add-target-language-manager-language"/);
  assert.doesNotMatch(html, /data-action="add-target-language-manager-language"[^>]*disabled/);
});
