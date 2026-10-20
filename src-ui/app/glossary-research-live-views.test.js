import test from "node:test";
import assert from "node:assert/strict";

import { liveAnswerHtml, sourceSnippets, stepDisplay } from "./glossary-research-live-views.js";

const progress = {
  key: "n", total: 10, unit: "sentence", view: "senses", word: "mortal", language: "English",
  senses: [{ id: "needed", gloss: "Causing death." }, { id: "o1", gloss: "Subject to death." }],
};

test("sorting by meaning is charted per meaning with its name, while it streams", () => {
  const html = liveAnswerHtml({ stage: "frequency", progress, answer: '{"items":[{"n":1,"sense":"o1"},{"n":2,"sense":"needed"},{"n":3,"sense":"o1"},{"n":4,"se' });
  assert.match(html, /“mortal” in everyday English: which meaning it has in each sentence \(3 of 10\)/);
  assert.match(html, /needed<\/span> Causing death\./);
  assert.match(html, /Subject to death\.[\s\S]*?width:20%[\s\S]*?>2</);
  assert.doesNotMatch(html, /not this word/, "an empty leftover row is not shown");
});

test("a finished sorting says so; unknown steps fall back to the plain answer", () => {
  assert.match(liveAnswerHtml({ stage: "frequency", progress, usage: {}, answer: '{"items":[{"n":1,"sense":"not_this_word"}]}' }), /which meaning it has in each sentence \(1\)/);
  assert.equal(liveAnswerHtml({ progress: { key: "n" }, answer: '{"items":[]}' }), null);
  assert.equal(liveAnswerHtml({ stage: "frequency", progress, answer: "not json" }), null);
});

test("batch steps tally the whole batch by translation name", () => {
  const request = { stage: "counting", progress: { variants: { e1v1: "inner", e2v1: "inner", e1v2: "Innermost" } },
    answer: '{"items":[{"occId":"o1","status":"selected","variantId":"e1v2","sentenceTranslation":"the Innermost","chosenWording":"Innermost"}' };
  const other = { answer: '{"items":[{"occId":"o2","status":"selected","variantId":"e1v1"},{"occId":"o3","status":"selected","variantId":"e2v1"}]}' };
  const html = liveAnswerHtml(request, { batch: [request, other] });
  assert.match(html, /\(3 uses of the word\)/);
  const bar = (name, n) => new RegExp(`research-chart__label" role="cell">${name}</span>\\s*<span class="research-chart__track" role="cell"><span class="research-chart__bar" style="width:[^"]*"></span><span class="research-chart__value">${n}<`, "g");
  assert.equal((html.match(bar("inner", 2)) ?? []).length, 1, "one bar for “inner” across entries");
  assert.match(html, bar("Innermost", 1));
  assert.match(html, /<mark>Innermost<\/mark>/);
});

test("every step has a view that survives any cut of its answer", () => {
  const answers = {
    forms: '{"forms":[{"form":"íntimo","kind":"inflection","confidence":"high"},{"form":"intimo","kind":"spelling","confidence":"low"}]}',
    candidates: '{"senses":[{"senseId":"s1","sense":"inner","groups":[{"members":["inner","inward"],"recommended":true,"note":"default","rationale":"r"}]}]}',
    checks: '{"candidates":[{"n":1,"target":"inner","words":[{"word":"inner","partOf":null,"forms":[],"neededSense":"inside","lookalike":false,"resembles":null,"otherSenses":[]}],"establishedUsage":false,"establishedBasis":""}]}',
    proposal: '{"partOfSpeech":"adjective","entries":[{"id":"e1","kind":"word","sourceTerms":["íntimo"],"generalNote":"","variants":[{"id":"e1v1","target":"inner","note":"default"}]}],"leftOutRenderings":[{"rendering":"inward","count":2,"reason":"rare"}]}',
    sources: '{"summary":"From M.","senses":[{"sense":"divine Being","label":"as a noun","inDictionary":false,"sourceBook":"Dioses Atómicos","originalLanguage":"English","originalTerm":"Innermost"}]}',
    summary: '{"summary":"Done.","recommendations":["Use inner."],"unresolvedExplanation":""}',
  };
  for (const [stage, answer] of Object.entries(answers)) {
    for (let n = 1; n <= answer.length; n += 1) {
      const html = liveAnswerHtml({ stage, answer: answer.slice(0, n) });
      assert.ok(html === null || typeof html === "string", `${stage} at ${n}`);
    }
    assert.ok(liveAnswerHtml({ stage, answer }), `${stage}: a view of the whole answer`);
  }
});

test("a finished batch step tallies every use and folds the uses behind one line", () => {
  const request = { stage: "counting", usage: {}, progress: { variants: { e1v1: "inner" } }, answer: '{"items":[{"occId":"o1","status":"selected","variantId":"e1v1","sentenceTranslation":"inner life","chosenWording":"inner"}]}' };
  const other = { usage: {}, answer: '{"items":[{"occId":"o2","status":"selected","variantId":"e1v1","sentenceTranslation":"the inner man","chosenWording":"inner"}]}' };
  const html = liveAnswerHtml(request, { batch: [request, other], final: true });
  assert.match(html, /Translation chosen for each use of the word \(2 uses of the word\)/);
  assert.match(html, /research-chart__label" role="cell">inner<\/span>[\s\S]*?research-chart__value">2</);
  assert.match(html, /<details class="research-view__more"><summary>Show the 2 uses<\/summary>/);
  assert.doesNotMatch(html, /o1|o2/, "no internal ids");
});

test("each counted use shows its source sentence, the word marked", () => {
  const text = "### Passage o001\no001.1: use entry [e1]\n(previous passage) …otra cosa. Más ⟦íntimo⟧ texto.\nPrimera frase. Aquellos que llegan a la Auto-Realización ⟦Intima⟧ [o001.1] mediante la evolución, son mentirosos.\n(next passage) La Auto-Realización Intima es…";
  const snippet = sourceSnippets(text).get("o001.1");
  assert.deepEqual(snippet, { before: "Aquellos que llegan a la Auto-Realización ", word: "Intima", after: " mediante la evolución, son mentirosos." });
  const request = { stage: "counting", text, usage: {}, progress: { variants: { e1v1: "inner" } }, answer: '{"items":[{"occId":"o001.1","status":"selected","variantId":"e1v1","sentenceTranslation":"inner Self-realization","chosenWording":"inner"}]}' };
  assert.match(liveAnswerHtml(request, { final: true }), /research-view__source" lang="es">Aquellos que llegan a la Auto-Realización <mark>Intima<\/mark>/);
});

test("after the second count, the uses where the two AIs differ are listed with the source and both translations", () => {
  const text = "o1.1 x\nUno ⟦íntimo⟧ [o1.1] aquí.\nDos ⟦íntima⟧ [o2.1] allí.";
  const req = (answer) => ({ stage: "counting", text, usage: {}, progress: { variants: { a: "Innermost", b: "within" } }, answer });
  const first = { heading: "Counting", items: [], requests: [req('{"items":[{"occId":"o1.1","status":"selected","variantId":"a","sentenceTranslation":"the Innermost","chosenWording":"Innermost"},{"occId":"o2.1","status":"selected","variantId":"a","sentenceTranslation":"x Innermost","chosenWording":"Innermost"}]}')] };
  const second = { heading: "Counting (second judge)", items: [], requests: [req('{"items":[{"occId":"o1.1","status":"selected","variantId":"a","sentenceTranslation":"the Innermost","chosenWording":"Innermost"},{"occId":"o2.1","status":"selected","variantId":"b","sentenceTranslation":"Christ within","chosenWording":"within"}]}')] };
  const shown = stepDisplay(second, { sections: [first, second], source: "Spanish" });
  assert.match(shown.html, /The two AIs chose differently for 1 of 2 uses/);
  assert.match(shown.html, /Dos <mark>íntima<\/mark> allí\./);
  assert.match(shown.html, /First AI<strong>Innermost<\/strong>[\s\S]*x <mark>Innermost<\/mark>[\s\S]*Second AI<strong>within<\/strong>[\s\S]*Christ <mark>within<\/mark>/);
  assert.match(shown.html, /Each card: the Spanish sentence/);
  assert.ok(shown.after && shown.results.has("agreement"));
});

test("a word that only begins like the term shows among the spellings once the check keeps it", () => {
  const result = (form, rows, kind) => ({ kind: "result", resultKind: "formCount", data: [{ form, rows, added: kind !== "user", kind }] });
  const propose = { requestId: "r1", stage: "forms", usage: {}, answer: '{"forms":[{"form":"cohabitar","kind":"user","confidence":"high"}]}' };
  const confirm = (answer, usage) => ({ requestId: "r2", stage: "forms", ...(usage ? { usage } : {}), answer });
  const section = (check) => ({ heading: "Word forms", items: [result("cohabitar", 20, "user"), result("cohabitaremos", 1, "extension"), result("cohabitación", 4, "extension")], requests: [propose, check] });
  const running = stepDisplay(section(confirm('{"forms":[{"form":"cohabitar","keep":true,"reason":"ok"}')));
  assert.doesNotMatch(running.html, /cohabitaremos|cohabitación/, "not shown before the check");
  const done = stepDisplay(section(confirm('{"forms":[{"form":"cohabitar","keep":true,"reason":"ok"},{"form":"cohabitaremos","keep":true,"reason":"future tense"},{"form":"cohabitación","keep":false,"reason":"a noun made from it"}]}', {})));
  assert.match(done.html, /✓ cohabitaremos \(1\)/);
  assert.doesNotMatch(done.html, /cohabitación/, "a word made from the term belongs to the word family, not the spellings");
  assert.doesNotMatch(done.html, /Crossed out/);
});

test("a form of a related word that the check rejects is not shown with it", () => {
  const family = { requestId: "f1", stage: "family", usage: {}, answer: '{"words":[{"form":"intimidad","kind":"suffixed","reason":"noun"}]}' };
  const check = { requestId: "f2", stage: "family", usage: {}, answer: '{"forms":[{"form":"intimidades","keep":true,"reason":"plural"},{"form":"intimidado","keep":false,"reason":"from intimidar"}]}' };
  const count = (form, rows, of) => ({ kind: "result", resultKind: "familyCount", data: [{ form, rows, ...(of ? { of } : {}) }] });
  const shown = stepDisplay({
    heading: "Word family",
    items: [count("intimidad", 13), count("intimidades", 4, "intimidad"), count("intimidado", 1, "intimidad"),
      { kind: "line", entry: { type: "fact", text: "Related words in the texts (paragraphs): intimidad (13), intimidades (4)" } }],
    requests: [family, check],
  });
  assert.ok(shown.requests.has("f2"), "the check has no conversation of its own");
  assert.match(shown.html, /intimidades \(4\) \(a form\)/);
  assert.doesNotMatch(shown.html, /intimidado/);
});

test("where the term comes from: a table of meanings first, then what the search found, then the details", () => {
  const study = { requestId: "s1", stage: "sources", purpose: "trace where “íntimo” comes from", usage: {}, answer: JSON.stringify({
    summary: "The divine noun comes from M.'s book.",
    senses: [
      { sense: "An individual's divine spirit.", label: "the inner God", partOfSpeech: "noun", inDictionary: false, sourceBook: "Dioses Atómicos — M.", originalLanguage: "English", originalTerm: "Innermost",
        meaningInSource: "The higher ruler within.", authorUsage: "He follows it.", equivalences: [{ term: "Atman", relation: "identity", evidence: "“¡Atman! El Íntimo”" }, { term: "Cristo Íntimo", relation: "related", evidence: "e" }] },
      { sense: "Inner, deep.", label: "inner, deep", partOfSpeech: "adjective", inDictionary: true, sourceBook: null },
    ] }) };
  const result = (kind, data) => ({ kind: "result", resultKind: kind, data });
  const fact = (text) => ({ kind: "line", entry: { type: "fact", text } });
  const section = {
    heading: "Where the term comes from",
    requests: [study],
    items: [
      result("bookCounts", [{ term: "íntimo", held: 43, using: 34, books: [{ title: "Dioses Atómicos — M.", occurrences: 186, passages: 150 }, { title: "Isis sin velo — H. P. Blavatsky", occurrences: 68, passages: 64 }], citations: [{ title: "Dioses Atómicos — M.", passages: 3 }, { title: "Isis sin velo — H. P. Blavatsky", passages: 0 }] }]),
      fact("The Samael Aun Weor search site lists Dioses Atómicos among the books Samael Aun Weor read: the Spanish translation of The Dayspring of Youth."),
      fact("“Innermost” is the original English word of The Dayspring of Youth (signed “M.”) for “An individual's divine spirit.” (checked): it will be the translation for that meaning, whatever its frequency."),
      fact("Samael Aun Weor read “íntimo” in this sense in Dioses Atómicos: the sense is not the ordinary one; the book uses it."),
      result("senses", [{ sense: "An individual's divine spirit.", label: "the inner God", partOfSpeech: "noun", inDictionary: false, sourceBook: "Dioses Atómicos — M.", originalTerm: "Innermost", originalLanguage: "English", verified: true, originalTitle: "The Dayspring of Youth", originalAuthor: "M.", translationTitle: "Dioses Atómicos", why: "The sense is not the ordinary one; the book uses it.", strength: "strong" },
        { sense: "Inner, deep.", label: "inner, deep", partOfSpeech: "adjective", inDictionary: true, sourceBook: null }]),
    ],
  };
  const shown = stepDisplay(section, { author: "Samael Aun Weor", source: "Spanish", target: "English", term: "Íntimo" });
  const html = shown.html;
  const at = (text) => html.indexOf(text);
  assert.ok(at("Meaning") < at("What this is based on") && at("What this is based on") < at("in detail"), "answer, then findings, then details");
  assert.match(html, /<strong>the inner God<\/strong>[\s\S]*<em>The Dayspring of Youth<\/em>, signed only “M\.”[\s\S]*Spanish: Dioses Atómicos[\s\S]*English <strong>“Innermost”<\/strong>[\s\S]*✓ checked in the original/);
  assert.match(html, /<strong>inner, deep<\/strong>[\s\S]*ordinary Spanish/);
  assert.match(html, /For “the inner God”, “Innermost” will be the English translation, however rare it is in everyday English/);
  assert.match(html, /“íntimo” appears in 34 books of the 43 Samael Aun Weor read; most in Dioses Atómicos \(186\), Isis sin velo \(68\)\./);
  assert.match(html, /He names Dioses Atómicos next to the word in 3 passages\./);
  assert.match(html, /He never names Isis sin velo next to the word\./);
  assert.match(html, /<dt>Why we say he took it from this book<\/dt><dd>The sense is not the ordinary one; the book uses it\.<\/dd>/);
  assert.match(html, /<dt>The same as<\/dt>[\s\S]*Atman[\s\S]*<dt>Related, not the same<\/dt>[\s\S]*Cristo Íntimo/);
  assert.doesNotMatch(html, /The divine noun comes from M\.'s book|in this sense in Dioses/, "no AI summary; the borrowing sentence is in the details");
  assert.ok(shown.requests.has("s1") && shown.results.has("senses") && shown.results.has("bookCounts"));
  assert.ok(section.items.filter((item) => item.kind === "line").every((item) => shown.facts.some((pattern) => pattern.test(item.entry.text))), "every finding is drawn once, by the display");
});

test("the related words: forms go with their word, suggestions join, words the check rejects are not shown", () => {
  const family = { requestId: "f1", stage: "family", usage: {}, answer: JSON.stringify({
    words: [
      { form: "submundo", kind: "prefixed", of: null, verdict: "related", reason: "under-world" },
      { form: "submundos", kind: "prefixed", of: "submundo", verdict: "related", reason: "plural" },
      { form: "mundillo", kind: "suffixed", of: null, verdict: "unsure", reason: "small world?" },
    ],
    suggested: [{ form: "supermundo", kind: "prefixed", reason: "above" }],
  }) };
  const check = { requestId: "f2", stage: "family", usage: {}, answer: '{"forms":[{"form":"mundillo","keep":false,"reason":"another word"}]}' };
  const count = (form, rows, of) => ({ kind: "result", resultKind: "familyCount", data: [{ form, rows, ...(of ? { of } : {}) }] });
  const shown = stepDisplay({
    heading: "Word family",
    items: [count("submundo", 24), count("submundos", 1, "submundo"), count("supermundo", 1),
      { kind: "line", entry: { type: "fact", text: "Related words in the texts (paragraphs): submundo (24), submundos (1), supermundo (1)" } }],
    requests: [family, check],
  });
  assert.match(shown.html, /submundo \(24\) \+1/);
  assert.match(shown.html, /supermundo \(1\)/);
  assert.doesNotMatch(shown.html, /mundillo/);
  assert.ok(shown.requests.has("f2"));
});

test("checking the candidates and measuring how common they are are two steps", () => {
  const checks = { requestId: "c1", stage: "checks", usage: {}, progress: { total: 1 }, answer: JSON.stringify({ candidates: [{ n: 1, target: "inward", words: [{ word: "inward", neededSense: "Inside.", lookalike: false }] }] }) };
  const sorting = { requestId: "q1", stage: "frequency", usage: {}, progress: { word: "inward", senses: [{ id: "needed", gloss: "Inside." }] }, answer: '{"items":[{"n":1,"sense":"needed"},{"n":2,"sense":"other"}]}' };
  const first = { heading: "Candidate checks", items: [], requests: [checks] };
  const second = { heading: "Candidate frequency", items: [{ kind: "result", resultKind: "checks", data: [{ target: "inward", verdict: "pass", reasons: [], notes: [], words: [{ word: "inward", zipf: 3.4 }] }] }], requests: [sorting] };
  const sections = [first, second];
  const analysis = stepDisplay(first, { sections, target: "English" });
  assert.match(analysis.html, /Each candidate's words, and the meaning each must have \(1 of 1\)/);
  assert.match(analysis.html, /The next step measures how common each word is/);
  assert.doesNotMatch(analysis.html, /everyday sentences|passes/);
  const measured = stepDisplay(second, { sections, target: "English" });
  assert.match(measured.html, /Usage frequency in general language, and which candidates pass/);
  assert.match(measured.html, /inward[\s\S]*Inside\.[\s\S]*1 of 2/, "one row per word measured: the word, the meaning needed, the count");
  assert.match(measured.html, /Result: 1 candidate passes, 0 fail/);
  assert.doesNotMatch(measured.html, /research-view__trow/, "the list of candidates stays in the step before");
  assert.ok(measured.requests.has("q1"));
});

test("while the AI looks for translations, the meanings it works on are listed and fill in as the answer arrives", () => {
  const parts = { requestId: "p1", stage: "parts", usage: {}, answer: JSON.stringify({ senses: [
    { id: "s1", gloss: "Everything that exists.", partOfSpeech: "noun", usedByAuthor: true },
    { id: "s2", gloss: "Earth or another planet.", partOfSpeech: "noun", usedByAuthor: true },
  ] }) };
  const meanings = { heading: "Parts and frequency", items: [], requests: [parts] };
  const thinking = { requestId: "c1", stage: "candidates", thinking: "**Weighing**" };
  const waiting = stepDisplay({ heading: "Candidate translations", items: [], requests: [thinking] }, { sections: [meanings], target: "English" });
  assert.match(waiting.html, /The 2 meanings the AI is finding English translations for/);
  assert.match(waiting.html, /1\. Everything that exists\.[\s\S]*used by the author[\s\S]*…[\s\S]*2\. Earth or another planet\./);
  const partial = { ...thinking, answer: '{"senses":[{"senseId":"s2","sense":"Earth or another planet.","groups":[{"members":["world"],"recommended":true,"note":"Default."},{"members":["planet"],"recommended":false,"note":"A physical planet."}]}' };
  const filling = stepDisplay({ heading: "Candidate translations", items: [], requests: [partial] }, { sections: [meanings], target: "English" });
  assert.match(filling.html, /2 possible English translations for 2 meanings/);
  assert.match(filling.html, /1\. Everything that exists\.[\s\S]*…[\s\S]*2\. Earth or another planet\.[\s\S]*★[\s\S]*world[\s\S]*planet/);
  assert.ok(filling.requests.has("c1"));
});

test("while the AI studies where the term comes from, the step says what it is reading", () => {
  const study = { requestId: "s1", stage: "sources", purpose: "study how the author uses “regenerar”", thinking: "**Comparing**",
    progress: { reading: ["the dictionary entry (5 meanings)", "30 passages from the 3 books that use it most (Las moradas filosofales 12, Dogma y ritual de la alta magia 10, Isis sin velo 8)", "30 of his own uses, picked at random"] } };
  const section = { heading: "Where the term comes from", items: [], requests: [study] };
  const shown = stepDisplay(section, { author: "Samael Aun Weor", source: "Spanish" });
  assert.match(shown.html, /What the AI is reading[\s\S]*The dictionary entry \(5 meanings\)[\s\S]*30 passages from the 3 books[\s\S]*30 of his own uses/);
  const answered = stepDisplay({ ...section, requests: [{ ...study, usage: {}, answer: '{"senses":[{"sense":"To restore.","inDictionary":true}]}' }] }, { author: "Samael Aun Weor", source: "Spanish" });
  assert.doesNotMatch(answered.html, /What the AI is reading/, "the answer replaces it");
});

test("the consistency test shows each sentence with the translations chosen on its tries, and the check's verdict", () => {
  const text = "### Passage o1\no1.1: use entry [e1]\nEn otros ⟦mundos⟧ [o1.1] viven.\no2.1: use entry [e1]\nEl ⟦mundo⟧ [o2.1] entero.";
  const round = (a, b) => ({ requestId: `r${a}${b}${Math.random()}`, stage: "consistency", purpose: "translate the test sentences with the finished entry (round 1)", usage: {}, text,
    progress: { variants: { v1: "world", v2: "planet" } },
    answer: JSON.stringify({ items: [{ occId: "o1.1", status: "selected", variantId: a }, { occId: "o2.1", status: "selected", variantId: b }] }) });
  const check = { requestId: "c", stage: "consistency", purpose: "check whether the translations the translator took turns between change the meaning", usage: {},
    answer: '{"items":[{"occId":"o1.1","sameMeaning":false,"reason":"planets are physical"}]}' };
  const section = { heading: "Consistency test", items: [{ kind: "line", entry: { type: "fact", text: "The translator took turns between translations in 1 of 2 test sentences." } }],
    requests: [round("v1", "v1"), round("v2", "v1"), round("v1", "v1"), round("v2", "v1"), round("v1", "v1"), check] };
  const shown = stepDisplay(section, { target: "English" });
  assert.match(shown.html, /2 test sentences, each translated 5 times with the finished entry: 1 kept to one translation, 1 took turns/);
  assert.match(shown.html, /En otros <mark>mundos<\/mark> viven\.[\s\S]*world ×3[\s\S]*planet ×2[\s\S]*changes the meaning/);
  assert.match(shown.html, /El <mark>mundo<\/mark> entero\.[\s\S]*world ×5/);
  assert.doesNotMatch(shown.html, /"occId"/, "no raw answers");
  assert.ok(shown.facts.some((pattern) => pattern.test(section.items[0].entry.text)));
  assert.equal(shown.requests.size, 6);
});
