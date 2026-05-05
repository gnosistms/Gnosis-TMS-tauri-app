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

test("target language manager disables language changes while offline", () => {
  const html = renderTargetLanguageManagerModal({
    offline: { isEnabled: true },
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

  assert.match(html, /Language changes are unavailable offline/);
  assert.match(html, /data-action="open-target-language-manager-picker"[\s\S]*disabled/);
  assert.match(html, /data-action="submit-target-language-manager"[^>]*disabled/);
  assert.match(html, /data-action="remove-target-language-manager-language:1"[\s\S]*disabled/);
});

test("target language manager modal renders a nested picker that can add another existing language", () => {
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
  assert.match(html, /data-action="select-target-language-manager-picker-language:es"/);
  assert.match(html, /data-action="select-target-language-manager-picker-language:en"/);
  assert.match(html, /data-action="select-target-language-manager-picker-language:vi"/);
  assert.match(html, /data-action="select-target-language-manager-picker-language:zh-Hans"/);
  assert.match(html, /data-action="select-target-language-manager-picker-language:zh-Hant"/);
  assert.doesNotMatch(html, /data-action="select-target-language-manager-picker-language:zh"/);
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

test("target language manager picker treats lowercase Chinese script code as selected", () => {
  const html = renderTargetLanguageManagerModal({
    targetLanguageManager: {
      isOpen: true,
      status: "idle",
      error: "",
      chapterId: "chapter-1",
      isPickerOpen: true,
      pickerSelectedLanguageCode: "zh-hant",
      languages: [
        { code: "es", name: "Spanish", role: "source" },
        { code: "en", name: "English", role: "target" },
      ],
    },
  });

  assert.match(html, /class="language-picker-modal__option is-selected"[\s\S]*data-action="select-target-language-manager-picker-language:zh-Hant"/);
});
