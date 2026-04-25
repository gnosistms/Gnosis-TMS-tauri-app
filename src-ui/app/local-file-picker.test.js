import test from "node:test";
import assert from "node:assert/strict";

let createdInput = null;

globalThis.document = {
  createElement(tagName) {
    assert.equal(tagName, "input");
    const listeners = {};
    createdInput = {
      type: "",
      accept: "",
      multiple: false,
      style: {},
      files: [],
      parentNode: null,
      addEventListener(type, handler) {
        listeners[type] = handler;
      },
      removeEventListener(type) {
        delete listeners[type];
      },
      click() {},
      dispatch(type) {
        listeners[type]?.();
      },
    };
    return createdInput;
  },
  body: {
    appendChild(input) {
      input.parentNode = this;
    },
    removeChild(input) {
      input.parentNode = null;
    },
  },
};

const { openLocalFilePicker } = await import("./local-file-picker.js");

test("openLocalFilePicker returns a single file by default", async () => {
  const firstFile = { name: "one.xlsx" };
  const secondFile = { name: "two.xlsx" };
  const promise = openLocalFilePicker({ accept: ".xlsx" });

  assert.equal(createdInput.accept, ".xlsx");
  assert.equal(createdInput.multiple, false);
  createdInput.files = [firstFile, secondFile];
  createdInput.dispatch("change");

  assert.equal(await promise, firstFile);
});

test("openLocalFilePicker returns every file when multiple is true", async () => {
  const firstFile = { name: "one.xlsx" };
  const secondFile = { name: "two.xlsx" };
  const promise = openLocalFilePicker({ accept: ".xlsx", multiple: true });

  assert.equal(createdInput.accept, ".xlsx");
  assert.equal(createdInput.multiple, true);
  createdInput.files = [firstFile, secondFile];
  createdInput.dispatch("change");

  assert.deepEqual(await promise, [firstFile, secondFile]);
});
