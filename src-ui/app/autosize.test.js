import test from "node:test";
import assert from "node:assert/strict";

const previousHtmlTextAreaElement = globalThis.HTMLTextAreaElement;

class FakeTextarea {
  constructor(options = {}) {
    this._height = "";
    this._focused = options.focused === true;
    this._scrollHeight = options.scrollHeight ?? 88;
    this._scrollContainer = options.scrollContainer ?? null;
    this.style = {
      overflowY: "",
    };
    Object.defineProperty(this.style, "height", {
      get: () => this._height,
      set: (value) => {
        this._height = value;
        if (value === "auto" && this._scrollContainer) {
          this._scrollContainer.scrollTop = 17;
        }
      },
    });
    this.classList = {
      toggles: new Map(),
      toggle: (name, enabled) => {
        this.classList.toggles.set(name, enabled);
      },
    };
  }

  get scrollHeight() {
    return this._scrollHeight;
  }

  closest(selector) {
    return selector === ".translate-main-scroll" ? this._scrollContainer : null;
  }

  matches(selector) {
    return selector === ":focus" ? this._focused : false;
  }
}

globalThis.HTMLTextAreaElement = FakeTextarea;

const {
  syncAutoSizeTextarea,
  syncEditorRowTextareaHeight,
} = await import("./autosize.js");

test.after(() => {
  if (previousHtmlTextAreaElement === undefined) {
    delete globalThis.HTMLTextAreaElement;
  } else {
    globalThis.HTMLTextAreaElement = previousHtmlTextAreaElement;
  }
});

test("active editor textarea autosize preserves translate scroll position", () => {
  const scrollContainer = { scrollTop: 240 };
  const textarea = new FakeTextarea({
    focused: true,
    scrollContainer,
    scrollHeight: 96,
  });

  syncEditorRowTextareaHeight(textarea);

  assert.equal(scrollContainer.scrollTop, 240);
  assert.equal(textarea.style.height, "96px");
  assert.equal(textarea.style.overflowY, "hidden");
});

test("generic autosize only preserves scroll when requested", () => {
  const scrollContainer = { scrollTop: 240 };
  const textarea = new FakeTextarea({
    scrollContainer,
    scrollHeight: 72,
  });

  syncAutoSizeTextarea(textarea, { minHeight: 44, maxHeight: null });

  assert.equal(scrollContainer.scrollTop, 17);
  assert.equal(textarea.style.height, "72px");
});
