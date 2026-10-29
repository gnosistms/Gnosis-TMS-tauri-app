import test from "node:test";
import assert from "node:assert/strict";

let keydownHandler = null;
let activeSearchInput = null;

class FakeElement {}
class FakeHtmlElement extends FakeElement {}
class FakeButtonElement extends FakeHtmlElement {
  clickCount = 0;
  click() { this.clickCount += 1; }
}
class FakeInputElement extends FakeHtmlElement {
  constructor() {
    super();
    this.focusCalls = [];
    this.selectCount = 0;
  }

  focus(options) {
    this.focusCalls.push(options);
  }

  select() {
    this.selectCount += 1;
  }
}

globalThis.Element = FakeElement;
globalThis.HTMLElement = FakeHtmlElement;
globalThis.HTMLInputElement = FakeInputElement;
globalThis.HTMLButtonElement = FakeButtonElement;
globalThis.HTMLTextAreaElement = class extends FakeHtmlElement {};
globalThis.HTMLSelectElement = class extends FakeHtmlElement {};

Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    platform: "MacIntel",
    userAgentData: null,
  },
});

globalThis.document = {
  querySelector(selector) {
    if (selector === "#app") {
      return null;
    }

    if (
      String(selector).includes("[data-project-search-input]")
      || String(selector).includes("[data-glossary-term-search-input]")
      || String(selector).includes("[data-editor-search-input]")
      || String(selector).includes("[data-preview-search-input]")
    ) {
      return activeSearchInput;
    }

    return null;
  },
  addEventListener(type, handler) {
    if (type === "keydown") {
      keydownHandler = handler;
    }
  },
};

globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async () => null,
    },
    event: {
      listen: async () => () => {},
    },
  },
};

const {
  registerKeyboardShortcutEvents,
  shouldInsertHoveredGlossaryFootnote,
} = await import("./events/keyboard-shortcuts.js");
const { state } = await import("./state.js");

function keyboardEvent(overrides = {}) {
  return {
    defaultPrevented: false,
    repeat: false,
    isComposing: false,
    key: "f",
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    ...overrides,
  };
}

test("keyboard shortcuts focus the page search input on macOS Command+F", () => {
  activeSearchInput = new FakeInputElement();
  registerKeyboardShortcutEvents(async () => {});

  keydownHandler(keyboardEvent());

  assert.deepEqual(activeSearchInput.focusCalls, [{ preventScroll: true }]);
  assert.equal(activeSearchInput.selectCount, 1);
});

test("keyboard shortcuts focus the page search input on Windows Ctrl+F", () => {
  navigator.platform = "Win32";
  activeSearchInput = new FakeInputElement();
  registerKeyboardShortcutEvents(async () => {});
  const event = keyboardEvent({ metaKey: false, ctrlKey: true });

  keydownHandler(event);

  assert.equal(event.prevented, true);
  assert.deepEqual(activeSearchInput.focusCalls, [{ preventScroll: true }]);
  assert.equal(activeSearchInput.selectCount, 1);
});

test("keyboard shortcuts leave browser find alone when no page search input exists", () => {
  navigator.platform = "MacIntel";
  activeSearchInput = null;
  registerKeyboardShortcutEvents(async () => {});
  const event = keyboardEvent();

  keydownHandler(event);

  assert.equal(event.prevented, false);
});

for (const { platform, modifiers } of [
  { platform: "MacIntel", modifiers: { metaKey: true, ctrlKey: false } },
  { platform: "Win32", modifiers: { metaKey: false, ctrlKey: true } },
  { platform: "Linux x86_64", modifiers: { metaKey: false, ctrlKey: true } },
]) {
  test(`hovered glossary footnote insertion uses the primary modifier on ${platform}`, () => {
    navigator.platform = platform;
    assert.equal(shouldInsertHoveredGlossaryFootnote(keyboardEvent(modifiers), true), true);
    assert.equal(shouldInsertHoveredGlossaryFootnote(keyboardEvent({ ...modifiers, key: "F" }), true), true);
    assert.equal(shouldInsertHoveredGlossaryFootnote(keyboardEvent(modifiers), false), false);
    for (const excluded of [
      { metaKey: !modifiers.metaKey, ctrlKey: !modifiers.ctrlKey },
      { metaKey: true, ctrlKey: true },
      { altKey: true }, { shiftKey: true }, { repeat: true },
      { isComposing: true }, { defaultPrevented: true }, { key: "g" },
    ]) {
      assert.equal(shouldInsertHoveredGlossaryFootnote(keyboardEvent({ ...modifiers, ...excluded }), true), false);
    }
  });
}

function inlineStyleShortcutFixture({ buttonAvailable = true, disabled = false, readOnly = false, editorField = true, modalOpen = false, srt = false, key = "i", style = "italic" } = {}) {
  const originalChapter = state.editorChapter;
  state.editorChapter = { ...originalChapter, sourceFormats: srt ? ["srt"] : [] };
  const buttons = Object.fromEntries(["bold", "italic", "underline"].map((name) => [name, new FakeButtonElement()]));
  const target = new HTMLTextAreaElement();
  target.disabled = disabled;
  target.readOnly = readOnly;
  target.matches = () => editorField;
  target.closest = (selector) => selector === "[data-editor-language-cluster]"
    ? { querySelector: (selector) => buttonAvailable ? buttons[selector.match(/data-inline-style="([^\"]+)"/)?.[1]] : null }
    : null;
  const originalQuery = document.querySelector;
  document.querySelector = (selector) => selector === "[data-modal-dialog]"
    ? (modalOpen ? {} : null)
    : originalQuery(selector);
  registerKeyboardShortcutEvents(async () => assert.fail("Formatting should activate the existing button"));
  const run = (overrides = {}) => {
    const event = keyboardEvent({ key, target, ...overrides });
    keydownHandler(event);
    return event;
  };
  return { button: buttons[style], buttons, run, restore: () => {
    document.querySelector = originalQuery;
    state.editorChapter = originalChapter;
  } };
}

for (const { platform, modifiers } of [
  { platform: "MacIntel", modifiers: { metaKey: true, ctrlKey: false } },
  { platform: "Win32", modifiers: { metaKey: false, ctrlKey: true } },
  { platform: "Linux x86_64", modifiers: { metaKey: false, ctrlKey: true } },
]) {
  for (const [key, style] of [["b", "bold"], ["i", "italic"], ["u", "underline"]]) {
    test(`${style} shortcut activates the matching editor button on ${platform}`, (t) => {
      navigator.platform = platform;
      const fixture = inlineStyleShortcutFixture({ key, style });
      t.after(fixture.restore);
      const event = fixture.run(modifiers);
      assert.equal(event.prevented, true);
      assert.equal(fixture.button.clickCount, 1);
      fixture.run({ ...modifiers, key: key.toUpperCase() });
      assert.equal(fixture.button.clickCount, 2);
      for (const excluded of [
        { metaKey: !modifiers.metaKey, ctrlKey: !modifiers.ctrlKey },
        { metaKey: true, ctrlKey: true },
        { altKey: true }, { shiftKey: true }, { repeat: true },
        { isComposing: true }, { defaultPrevented: true }, { key: "x" },
      ]) {
        assert.equal(fixture.run({ ...modifiers, ...excluded }).prevented, false);
        assert.equal(fixture.button.clickCount, 2);
      }
      for (const [name, button] of Object.entries(fixture.buttons)) {
        assert.equal(button.clickCount, name === style ? 2 : 0);
      }
    });
  }
}

test("formatting shortcuts leave unavailable and non-editor fields alone", (t) => {
  navigator.platform = "MacIntel";
  for (const options of [
    { buttonAvailable: false }, { disabled: true }, { readOnly: true },
    { editorField: false }, { modalOpen: true }, { srt: true },
  ]) {
    const fixture = inlineStyleShortcutFixture(options);
    try {
      assert.equal(fixture.run().prevented, false);
      assert.equal(fixture.button.clickCount, 0);
    } finally { fixture.restore(); }
  }
  const fixture = inlineStyleShortcutFixture();
  t.after(fixture.restore);
  fixture.button.disabled = true;
  assert.equal(fixture.run().prevented, false);
  assert.equal(fixture.button.clickCount, 0);
});

function rowFieldFixture({ contentKind, paragraphs = false, list = false, value = "", caret = value.length } = {}) {
  const originalExecCommand = document.execCommand;
  const target = new HTMLTextAreaElement();
  target.dataset = contentKind ? { contentKind } : {};
  target.matches = (selector) => selector === "[data-editor-row-field]"
    || (paragraphs && selector === "[data-editor-row-field][data-text-has-paragraphs]")
    || (list && selector === "[data-editor-row-field][data-text-is-list]");
  target.closest = () => null;
  target.value = value;
  target.selectionStart = caret;
  target.selectionEnd = caret;
  target.selections = [];
  target.setSelectionRange = (start, end) => { target.selections.push([start, end]); };
  target.blurCount = 0;
  target.blur = () => { target.blurCount += 1; };
  const commands = [];
  document.execCommand = (...args) => { commands.push(args); return true; };
  registerKeyboardShortcutEvents(async () => {});
  return {
    target,
    commands,
    run: (overrides) => {
      const event = keyboardEvent({ target, metaKey: false, ...overrides });
      keydownHandler(event);
      return event;
    },
    restore: () => {
      document.execCommand = originalExecCommand;
    },
  };
}

test("Return starts a paragraph with a blank line in row text", (t) => {
  navigator.platform = "MacIntel";
  for (const [value, caret, inserted] of [
    ["Line", 4, "\n\n"],
    ["Ab", 1, "\n\n"],
    ["Line\n", 5, "\n"],
    ["", 0, "\n"],
  ]) {
    const fixture = rowFieldFixture({ paragraphs: true, value, caret });
    t.after(fixture.restore);
    const event = fixture.run({ key: "Enter" });
    assert.equal(event.prevented, true);
    assert.deepEqual(fixture.commands, [["insertText", false, inserted]]);
    assert.equal(fixture.target.blurCount, 0);
  }

  // Shift+Return is the native newline, a line break; other modifiers are not Return.
  const fixture = rowFieldFixture({ paragraphs: true, value: "Line" });
  t.after(fixture.restore);
  for (const modifiers of [{ shiftKey: true }, { altKey: true }, { metaKey: true }, { ctrlKey: true }, { isComposing: true }]) {
    assert.equal(fixture.run({ key: "Enter", ...modifiers }).prevented, false);
  }
  assert.deepEqual(fixture.commands, []);
  assert.equal(fixture.target.blurCount, 0);
});

test("Return keeps the native newline in footnotes, captions, attributions, subtitles and custom HTML", (t) => {
  navigator.platform = "MacIntel";
  for (const contentKind of [undefined, "footnote", "image-caption", "attribution"]) {
    const fixture = rowFieldFixture({ contentKind, value: "Line" });
    t.after(fixture.restore);
    assert.equal(fixture.run({ key: "Enter" }).prevented, false);
    assert.equal(fixture.run({ key: "Enter", shiftKey: true }).prevented, false);
    assert.deepEqual(fixture.commands, []);
    assert.equal(fixture.target.blurCount, 0);
  }
});

test("Return and Shift+Return start a list item at the current level", (t) => {
  navigator.platform = "MacIntel";
  for (const modifiers of [{}, { shiftKey: true }]) {
    const fixture = rowFieldFixture({ list: true, value: "One\n\tTwo" });
    t.after(fixture.restore);
    assert.equal(fixture.run({ key: "Enter", ...modifiers }).prevented, true);
    assert.deepEqual(fixture.commands, [["insertText", false, "\n\t"]]);
    assert.deepEqual(fixture.target.selections, [[8, 8], [10, 10]]);
  }

  // An empty indented item outdents; with nothing left to insert it deletes.
  const fixture = rowFieldFixture({ list: true, value: "One\n\t" });
  t.after(fixture.restore);
  fixture.run({ key: "Enter" });
  assert.deepEqual(fixture.commands, [["delete"]]);
  assert.deepEqual(fixture.target.selections, [[4, 5], [4, 4]]);
});

test("Tab and Shift+Tab move list items and stay in the field", (t) => {
  navigator.platform = "MacIntel";
  const fixture = rowFieldFixture({ list: true, value: "One\nTwo" });
  t.after(fixture.restore);
  assert.equal(fixture.run({ key: "Tab" }).prevented, true);
  assert.deepEqual(fixture.commands, [["insertText", false, "\tTwo"]]);
  assert.deepEqual(fixture.target.selections, [[4, 7], [8, 8]]);

  // The first item cannot move, but Tab still does not leave the field.
  const top = rowFieldFixture({ list: true, value: "One", caret: 0 });
  t.after(top.restore);
  assert.equal(top.run({ key: "Tab" }).prevented, true);
  assert.equal(top.run({ key: "Tab", shiftKey: true }).prevented, true);
  assert.deepEqual(top.commands, []);

  // Tab in other row fields and with modifiers is not a list key.
  const paragraph = rowFieldFixture({ paragraphs: true, value: "One\nTwo" });
  t.after(paragraph.restore);
  assert.equal(paragraph.run({ key: "Tab" }).prevented, false);
  for (const modifiers of [{ altKey: true }, { metaKey: true }, { ctrlKey: true }, { isComposing: true }]) {
    assert.equal(fixture.run({ key: "Tab", ...modifiers }).prevented, false);
  }
});

for (const { platform, modifiers } of [
  { platform: "MacIntel", modifiers: { metaKey: true, ctrlKey: false } },
  { platform: "Win32", modifiers: { metaKey: false, ctrlKey: true } },
]) {
  test(`the primary modifier with S saves and leaves any row field on ${platform}`, (t) => {
    navigator.platform = platform;
    for (const contentKind of [undefined, "footnote", "image-caption", "attribution"]) {
      const fixture = rowFieldFixture({ contentKind });
      t.after(fixture.restore);
      const event = fixture.run({ key: "s", ...modifiers });
      assert.equal(event.prevented, true);
      assert.equal(fixture.target.blurCount, 1);
      for (const excluded of [
        { metaKey: !modifiers.metaKey, ctrlKey: !modifiers.ctrlKey }, { shiftKey: true }, { altKey: true },
      ]) {
        assert.equal(fixture.run({ key: "s", ...modifiers, ...excluded }).prevented, false);
      }
      assert.equal(fixture.target.blurCount, 1);
    }
  });
}
