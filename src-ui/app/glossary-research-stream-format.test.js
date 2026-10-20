import test from "node:test";
import assert from "node:assert/strict";

import { formatJsonStream, formatThinking } from "./glossary-research-stream-format.js";

const plain = (html) => html.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

test("a complete answer is indented by depth, keys and values marked apart", () => {
  const html = formatJsonStream('{"senses":[{"id":"s1","n":3}],"ok":true}');
  assert.equal(plain(html), '{\n  "senses": [\n    {\n      "id": "s1",\n      "n": 3\n    }\n  ],\n  "ok": true\n}');
  assert.match(html, /research-stream__key">&quot;senses&quot;<\/span>/);
  assert.match(html, /research-stream__string">&quot;s1&quot;<\/span>/);
});

test("a truncated answer is laid out as far as it goes, without trailing indentation", () => {
  assert.equal(plain(formatJsonStream('{"items":[{"n":1,"sense":"nee')), '{\n  "items": [\n    {\n      "n": 1,\n      "sense": "nee');
  assert.equal(plain(formatJsonStream('{"a":[')), '{\n  "a": [\n');
});

test("quotes, commas and brackets inside strings do not change the layout", () => {
  const html = formatJsonStream('{"note":"say \\"x\\", then [y] {z}","k":1}');
  assert.equal(plain(html), '{\n  "note": "say \\"x\\", then [y] {z}",\n  "k": 1\n}');
});

test("text that is not JSON is shown escaped as it is", () => {
  assert.equal(formatJsonStream("Plain <b>answer</b>"), '<span class="research-stream__text">Plain &lt;b&gt;answer&lt;/b&gt;</span>');
  assert.equal(formatJsonStream("   "), "");
});

test("thinking titles become headings; other lines stay paragraphs", () => {
  assert.equal(
    formatThinking("**Weighing the senses**\nFirst line\nsecond <line>\n\nNext paragraph"),
    '<h4 class="research-stream__title">Weighing the senses</h4><p>First line<br>second &lt;line&gt;</p><p>Next paragraph</p>',
  );
});
