import test from "node:test";
import assert from "node:assert/strict";
import { studioResultPresentation, studioNarrativeText } from "./glossary-research-studio-result.js";

test("findings format headings, nested emphasis, Unicode and safe citations", () => {
  const result = studioResultPresentation("## Findings\n\n**The headword is *ἱεροφάντης*.** See [Dictionary](https://example.org/entry?q=word&lang=grc).\n\n### Uncertainty\n\nA proposed spelling remains uncertain.");
  assert.match(result.html, /<h4>Findings<\/h4>/u);
  assert.match(result.html, /<strong>The headword is <em>ἱεροφάντης<\/em>\.<\/strong>/u);
  assert.match(result.html, /href="https:\/\/example.org\/entry\?q=word&amp;lang=grc" target="_blank" rel="noopener noreferrer"/u);
  assert.equal(result.preview, "The headword is ἱεροφάντης. See Dictionary.");
});

test("paragraphs, nested lists, quotes, tables and code keep their structure", () => {
  const result = studioResultPresentation("- Spanish: **hierofante**\n  - Plural: hierofantes\n- Greek: ἱεροφάντης\n\n1. Read a dictionary.\n2. Compare the spelling.\n\n> A short source quotation.\n\n| Form | Language |\n| --- | --- |\n| hierofante | Spanish |\n\n```text\n<script>**literal**</script>\n```\n\nUse `origin_term`.");
  assert.match(result.html, /<ul><li><p>Spanish: <strong>hierofante<\/strong><\/p><ul><li><p>Plural: hierofantes<\/p><\/li><\/ul><\/li>/u);
  assert.match(result.html, /<ol><li><p>Read a dictionary\.<\/p><\/li><li><p>Compare the spelling\.<\/p><\/li><\/ol>/u);
  assert.match(result.html, /<blockquote><p>A short source quotation\.<\/p><\/blockquote>/u);
  assert.match(result.html, /<th scope="col">Form<\/th>/u);
  assert.match(result.html, /<td>hierofante<\/td><td>Spanish<\/td>/u);
  assert.match(result.html, /<pre><code>&lt;script&gt;\*\*literal\*\*&lt;\/script&gt;<\/code><\/pre>/u);
  assert.match(result.html, /<code>origin_term<\/code>/u);
});

test("untrusted HTML, images and non-web links cannot create executable markup", () => {
  const result = studioResultPresentation('<img src=x onerror="alert(1)"> <script>alert(1)</script> [bad](javascript:alert) [bad](data:text/html,evil) [local](/app) [escaped](https://example.org/"onclick="evil)');
  assert.doesNotMatch(result.html, /<img|<script|href="(?:javascript:|data:|\/app)/u);
  assert.match(result.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/u);
  assert.match(result.html, /href="https:\/\/example.org\/&quot;onclick=&quot;evil"/u);
});

test("long previews omit Markdown and headings without clipping the expanded report", () => {
  const narrative = "**Verified** spelling with *supporting evidence*. ".repeat(12);
  const result = studioResultPresentation(`## Findings\n\n${narrative}\n\n## Caveats\n\nFinal finding after the preview.`);
  assert.equal(result.long, true);
  assert(result.preview.length <= 301);
  assert.doesNotMatch(result.preview, /\*|##|Findings/u);
  assert.match(result.preview, /…$/u);
  assert.match(result.html, /<h4>Caveats<\/h4><p>Final finding after the preview\.<\/p>/u);
});

test("short plain receipts and empty results remain readable", () => {
  assert.deepEqual(studioResultPresentation("113 matching paragraphs."), {
    html: "<p>113 matching paragraphs.</p>", preview: "113 matching paragraphs.", long: false,
  });
  assert.deepEqual(studioResultPresentation(""), { html: "", preview: "", long: false });
});

test("internal corpus locators disappear from prose while quotations and public sources remain", () => {
  const original = 'Plural, as in «los grandes Hierofantes» (/doc/book-34?line=21924), and singular (/doc/lecture-287?line=87357).';
  assert.equal(studioNarrativeText(original), 'Plural, as in «los grandes Hierofantes», and singular.');
  assert.equal(studioNarrativeText('See [Source book](/doc/book-34?line=21924) and `/doc/lecture-287?line=87357`.'), 'See Source book and .');
  assert.equal(studioNarrativeText('A form [/doc/book-34?line=21924]. Another /doc/lecture-287?line=87357 example.'), 'A form. Another example.');
  const publicSource = 'See [Dictionary](https://dle.rae.es/hierofante) and https://example.org/doc/book-34?line=21924.';
  assert.equal(studioNarrativeText(publicSource), publicSource);
  assert(original.includes('/doc/book-34?line=21924'), 'source text is not rewritten');
});

test("collapsed previews and expanded findings hide internal locators without dropping source labels", () => {
  const original = '## Findings\n\nA verified plural (/doc/book-34?line=21924).\n\n' + 'Supporting evidence. '.repeat(20)
    + '\n\nSee [Source book](/doc/book-34?line=21924) and [Dictionary](https://dle.rae.es/hierofante).';
  const result = studioResultPresentation(original);
  assert.equal(result.long, true);
  assert.equal(result.preview, 'A verified plural.');
  assert.doesNotMatch(result.html, /\/doc\/book|line=21924/u);
  assert.match(result.html, /See Source book and <a href="https:\/\/dle.rae.es\/hierofante"/u);
});
