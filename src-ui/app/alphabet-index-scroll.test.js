import test from "node:test";
import assert from "node:assert/strict";

import {
  collectIndexSections,
  normalizeIndexKey,
  selectIndexKeys,
} from "../lib/alphabet-index-scroll.js";
import {
  ensureLanguagePickerListFrame,
  languagePickerOptionLabel,
} from "./language-picker-alphabet-index.js";

test("alphabet index key normalization strips diacritics and falls back consistently", () => {
  assert.equal(normalizeIndexKey("Árabe"), "A");
  assert.equal(normalizeIndexKey(" Vietnamese"), "V");
  assert.equal(normalizeIndexKey("123 Notes"), "#");
  assert.equal(normalizeIndexKey(""), "#");
  assert.equal(normalizeIndexKey("東京"), "#");
});

test("alphabet index sections group by first normalized key", () => {
  const firstA = { label: "Árabe" };
  const secondA = { label: "Afrikaans" };
  const vietnamese = { label: "Vietnamese" };
  const sections = collectIndexSections([vietnamese, firstA, secondA], {
    getLabel: (item) => item.label,
    getTarget: (item) => item,
  });

  assert.deepEqual(sections.map((section) => section.key), ["A", "V"]);
  assert.equal(sections[0].target, firstA);
  assert.deepEqual(sections[0].items, [firstA, secondA]);
});

test("alphabet index can include disabled missing alphabet entries", () => {
  const sections = collectIndexSections([{ label: "Spanish" }], {
    alphabet: ["A", "S", "Z"],
    includeMissing: true,
  });

  assert.deepEqual(
    sections.map((section) => [section.key, section.disabled]),
    [
      ["A", true],
      ["S", false],
      ["Z", true],
    ],
  );
});

test("alphabet index samples long indexes while keeping endpoints", () => {
  const sections = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((key) => ({ key }));
  assert.deepEqual(selectIndexKeys(sections, { maxItems: 5 }), ["A", "G", "N", "T", "Z"]);
});

test("language picker option labels ignore the displayed language code", () => {
  const option = {
    textContent: "Spanish ES",
    querySelector(selector) {
      assert.equal(selector, "span:not(.language-picker-modal__code)");
      return { textContent: "Spanish" };
    },
  };

  assert.equal(languagePickerOptionLabel(option), "Spanish");
});

test("language picker alphabet host wraps only the scrolling list", () => {
  const created = [];
  const parent = {
    insertedBefore: null,
    insertBefore(element, reference) {
      this.insertedBefore = { element, reference };
      element.parentElement = this;
    },
  };
  const list = {
    ownerDocument: {
      createElement(tagName) {
        assert.equal(tagName, "div");
        const frame = {
          className: "",
          children: [],
          classList: {
            contains() {
              return false;
            },
          },
          append(child) {
            this.children.push(child);
            child.parentElement = this;
          },
        };
        created.push(frame);
        return frame;
      },
    },
    parentElement: parent,
    before(element) {
      this.parentElement.insertBefore(element, this);
    },
    closest() {
      return null;
    },
  };

  const frame = ensureLanguagePickerListFrame(list);
  assert.equal(frame, created[0]);
  assert.equal(frame.className, "language-picker-modal__list-frame");
  assert.deepEqual(frame.children, [list]);
  assert.equal(parent.insertedBefore.reference, list);
});
