import test from "node:test";
import assert from "node:assert/strict";

const languageList = { scrollTop: 0 };
let pickerList = languageList;

globalThis.document = {
  querySelector(selector) {
    return selector === "[data-target-language-manager-picker-list]" ? pickerList : null;
  },
  querySelectorAll() {
    return [];
  },
};

globalThis.window = {
  __TAURI__: null,
  __TAURI_INTERNALS__: null,
  open() {},
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame(callback) {
    callback();
  },
};

globalThis.requestAnimationFrame = (callback) => callback();

const { state, createTargetLanguageManagerState } = await import("./state.js");
const {
  addTargetLanguageManagerLanguage,
  captureTargetLanguageManagerPickerScrollTop,
  removeTargetLanguageManagerLanguage,
  restoreTargetLanguageManagerPickerScrollTop,
  selectTargetLanguageManagerPickerLanguage,
} = await import("./translate-flow.js");

test("target language picker selection preserves scroll and waits for add language", () => {
  languageList.scrollTop = 237;
  state.targetLanguageManager = {
    ...createTargetLanguageManagerState(),
    isOpen: true,
    isPickerOpen: true,
    chapterId: "chapter-1",
    languages: [
      { code: "en", name: "English", role: "source" },
    ],
  };

  selectTargetLanguageManagerPickerLanguage("vi");

  assert.equal(state.targetLanguageManager.isPickerOpen, true);
  assert.equal(state.targetLanguageManager.pickerSelectedLanguageCode, "vi");
  assert.equal(state.targetLanguageManager.pickerScrollTop, 237);
  assert.equal(languageList.scrollTop, 237);
  assert.deepEqual(
    state.targetLanguageManager.languages.map((language) => language.code),
    ["en"],
  );

  addTargetLanguageManagerLanguage();

  assert.equal(state.targetLanguageManager.isPickerOpen, false);
  assert.equal(state.targetLanguageManager.pickerSelectedLanguageCode, "");
  assert.deepEqual(
    state.targetLanguageManager.languages.map((language) => language.code),
    ["en", "vi"],
  );
});

test("target language picker scroll survives full rerenders", () => {
  pickerList = languageList;
  languageList.scrollTop = 344;
  state.targetLanguageManager = {
    ...createTargetLanguageManagerState(),
    isOpen: true,
    isPickerOpen: true,
    chapterId: "chapter-1",
    languages: [
      { code: "en", name: "English", role: "source" },
    ],
    pickerScrollTop: 0,
  };

  const scrollTop = captureTargetLanguageManagerPickerScrollTop();
  languageList.scrollTop = 0;
  restoreTargetLanguageManagerPickerScrollTop(scrollTop);

  assert.equal(scrollTop, 344);
  assert.equal(state.targetLanguageManager.pickerScrollTop, 344);
  assert.equal(languageList.scrollTop, 344);
});

test("target language picker does not capture scroll before the list is mounted", () => {
  pickerList = null;
  state.targetLanguageManager = {
    ...createTargetLanguageManagerState(),
    isOpen: true,
    isPickerOpen: true,
    chapterId: "chapter-1",
    languages: [
      { code: "en", name: "English", role: "source" },
    ],
    pickerScrollTop: 0,
  };

  assert.equal(captureTargetLanguageManagerPickerScrollTop(), null);
  assert.equal(state.targetLanguageManager.pickerScrollTop, 0);
  pickerList = languageList;
});

test("target language picker deferred scroll restore does not override user scroll", () => {
  pickerList = languageList;
  const frames = [];
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => {
    frames.push(callback);
  };
  languageList.scrollTop = 0;
  state.targetLanguageManager = {
    ...createTargetLanguageManagerState(),
    isOpen: true,
    isPickerOpen: true,
    chapterId: "chapter-1",
    languages: [
      { code: "en", name: "English", role: "source" },
    ],
  };

  try {
    restoreTargetLanguageManagerPickerScrollTop(200);
    assert.equal(languageList.scrollTop, 200);
    languageList.scrollTop = 512;
    frames.forEach((callback) => callback());
    assert.equal(languageList.scrollTop, 512);
  } finally {
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
  }
});

test("target language picker canonicalizes Chinese script codes", () => {
  pickerList = languageList;
  languageList.scrollTop = 0;
  state.targetLanguageManager = {
    ...createTargetLanguageManagerState(),
    isOpen: true,
    isPickerOpen: true,
    chapterId: "chapter-1",
    languages: [
      { code: "en", name: "English", role: "source" },
    ],
  };

  selectTargetLanguageManagerPickerLanguage("zh-hans");

  assert.equal(state.targetLanguageManager.pickerSelectedLanguageCode, "zh-Hans");

  addTargetLanguageManagerLanguage();

  assert.deepEqual(state.targetLanguageManager.languages.at(-1), {
    code: "zh-Hans",
    name: "Chinese (Simplified)",
    role: "target",
  });
});

test("target language manager can add another column for an existing base language", () => {
  state.targetLanguageManager = {
    ...createTargetLanguageManagerState(),
    isOpen: true,
    isPickerOpen: true,
    chapterId: "chapter-1",
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "zh-Hans", name: "Chinese (Simplified)", role: "target" },
    ],
  };

  selectTargetLanguageManagerPickerLanguage("zh-Hans");
  addTargetLanguageManagerLanguage();

  assert.deepEqual(state.targetLanguageManager.languages, [
    { code: "es", name: "Spanish", role: "source" },
    { code: "zh-Hans", name: "Chinese (Simplified) 1", role: "target", baseCode: "zh-Hans" },
    { code: "zh-Hans-x-2", name: "Chinese (Simplified) 2", role: "target", baseCode: "zh-Hans" },
  ]);
});

test("target language manager removal collapses singleton duplicate labels immediately", () => {
  state.targetLanguageManager = {
    ...createTargetLanguageManagerState(),
    isOpen: true,
    chapterId: "chapter-1",
    languages: [
      { code: "en", name: "English 1", role: "source", baseCode: "en" },
      { code: "en-x-2", name: "English 2", role: "target", baseCode: "en" },
    ],
  };

  removeTargetLanguageManagerLanguage(0);

  assert.deepEqual(state.targetLanguageManager.languages, [
    { code: "en-x-2", name: "English", role: "target", baseCode: "en" },
  ]);
});
