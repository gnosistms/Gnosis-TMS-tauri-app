import test from "node:test";
import assert from "node:assert/strict";

import {
  listItemsFromHtml,
  listItemsFromPlainText,
  listItemsWithMarkers,
  listLevelFormat,
  listMarkerText,
  renderNestedListHtml,
} from "./editor-list.js";

test("each list style sets its levels and repeats them deeper down", () => {
  const formats = (style, count) => Array.from({ length: count }, (_, level) => listLevelFormat(style, level));
  assert.deepEqual(formats("list_bullet", 4), ["disc", "circle", "square", "disc"]);
  assert.deepEqual(formats("list_number", 4), ["decimal", "lower-alpha", "lower-roman", "decimal"]);
  assert.deepEqual(formats("list_letter", 4), ["lower-alpha", "lower-roman", "decimal", "lower-alpha"]);
  assert.deepEqual(
    formats("list_roman", 6),
    ["upper-roman", "upper-alpha", "decimal", "lower-alpha", "lower-roman", "upper-roman"],
  );
});

test("markers count past z and into large roman numerals", () => {
  assert.equal(listMarkerText("disc", 3), "•");
  assert.equal(listMarkerText("circle", 1), "◦");
  assert.equal(listMarkerText("square", 1), "▪");
  assert.equal(listMarkerText("decimal", 12), "12.");
  assert.equal(listMarkerText("lower-alpha", 1), "a.");
  assert.equal(listMarkerText("lower-alpha", 26), "z.");
  assert.equal(listMarkerText("lower-alpha", 27), "aa.");
  assert.equal(listMarkerText("upper-alpha", 28), "AB.");
  assert.equal(listMarkerText("lower-roman", 4), "iv.");
  assert.equal(listMarkerText("upper-roman", 1994), "MCMXCIV.");
});

test("tabs set levels, blank lines drop, and levels deepen one step at a time", () => {
  const items = listItemsFromPlainText("\t\tFirst\n\n\t\t\tSecond\n  \nThird\r\n\tFourth\n\t\t\t\t\tFifth");
  assert.deepEqual(
    items.map(({ level, number, text }) => [level, number, text]),
    [
      [0, 1, "First"],
      [1, 1, "Second"],
      [0, 2, "Third"],
      [1, 1, "Fourth"],
      [2, 1, "Fifth"],
    ],
  );
});

test("levels stop at nine", () => {
  const text = Array.from({ length: 12 }, (_, level) => `${"\t".repeat(level)}Item ${level}`).join("\n");
  assert.deepEqual(listItemsFromPlainText(text).map((item) => item.level), [0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8, 8]);
});

test("numbering restarts below each item and continues in its own level", () => {
  const items = listItemsWithMarkers(
    listItemsFromPlainText("One\n\tA\n\tB\nTwo\n\tA again\nThree"),
    "list_number",
  );
  assert.deepEqual(items.map((item) => item.marker), ["1.", "a.", "b.", "2.", "a.", "3."]);
});

test("html items reopen formatting that spans lines and keep tabs inside tags", () => {
  const items = listItemsFromHtml("<strong>One\n\tTwo</strong>\n<em>\t\tThree</em>\n<mark> </mark>");
  assert.deepEqual(items, [
    { level: 0, number: 1, html: "<strong>One</strong>" },
    { level: 1, number: 1, html: "<strong>Two</strong>" },
    { level: 2, number: 1, html: "<em>Three</em>" },
  ]);
});

test("nested lists put each sublist inside its parent item", () => {
  const html = renderNestedListHtml(listItemsFromHtml("One\n\tA\n\t\ti\nTwo"), "list_number");
  assert.equal(
    html,
    '<ol style="list-style-type:decimal"><li>One<ol style="list-style-type:lower-alpha"><li>A'
      + '<ol style="list-style-type:lower-roman"><li>i</li></ol></li></ol></li><li>Two</li></ol>',
  );
  assert.equal(
    renderNestedListHtml(listItemsFromHtml("One\n\tTwo"), "list_bullet"),
    '<ul style="list-style-type:disc"><li>One<ul style="list-style-type:circle"><li>Two</li></ul></li></ul>',
  );
  assert.equal(renderNestedListHtml([], "list_bullet"), "");
});
