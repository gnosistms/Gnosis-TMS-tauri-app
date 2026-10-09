// Readable live views of AI answers while they stream in, one per kind of
// answer. Each takes the request (its stage, purpose and the progress hint the
// engine attached), the answer read so far (parsePartialJson) and, for batches,
// the other requests of the batch; it returns HTML, or null to fall back to the
// plain indented JSON. Every field may still be missing or half-written.

import { parsePartialJson } from "./glossary-research-partial-json.js";

const esc = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const list = (value) => (Array.isArray(value) ? value : []);
const str = (value) => (typeof value === "string" ? value : "");
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const chip = (text, kind = "") => `<span class="research-view__chip${kind ? ` research-view__chip--${kind}` : ""}">${esc(text)}</span>`;
const label = (text, tone = "") => `<span class="research-view__label${tone ? ` research-view__label--${tone}` : ""}">${esc(text)}</span>`;
const muted = (text) => (text ? `<span class="research-view__muted">${esc(text)}</span>` : "");

function view(kind, heading, body) {
  return `<div class="research-view research-view--${kind}">${heading ? `<p class="research-view__heading">${heading}</p>` : ""}${body}</div>`;
}

/** A tally as bars: rows of [label, count, kind], scaled to `scale` so bars only grow. */
function bars(rows, scale, ariaLabel) {
  const top = Math.max(scale, ...rows.map(([, n]) => n), 1);
  return `<div class="research-chart" role="table" aria-label="${esc(ariaLabel)}">${rows.map(([text, n, kind = "sense", tag = ""]) => `
    <div class="research-chart__row research-chart__row--${kind}" role="row" title="${esc(text)}: ${n}">
      <span class="research-chart__label" role="cell">${tag ? `<span class="research-chart__tag">${esc(tag)}</span> ` : ""}${esc(text)}</span>
      <span class="research-chart__track" role="cell"><span class="research-chart__bar" style="width:${(100 * n) / top}%"></span><span class="research-chart__value">${n}</span></span>
    </div>`).join("")}</div>`;
}

// --- one view per step -----------------------------------------------------------

/** Sorting general-corpus sentences by meaning: one bar per meaning, named. */
function sensesView(request, value) {
  const hint = request.progress ?? {};
  const senses = list(hint.senses);
  if (!senses.length) return null;
  const counts = new Map();
  let sorted = 0;
  for (const item of list(value?.items)) {
    if (!str(item?.sense)) continue;
    sorted += 1;
    counts.set(item.sense, (counts.get(item.sense) ?? 0) + 1);
  }
  const total = hint.total > 0 ? hint.total : Math.max(sorted, 1);
  const rows = [
    ...senses.map((sense) => [`${sense.partOfSpeech ? `(${sense.partOfSpeech}) ` : ""}${sense.gloss}`, counts.get(sense.id) ?? 0, sense.id === "needed" ? "needed" : "sense", sense.id === "needed" ? "needed" : ""]),
    ...[["other", "another meaning"], ["not_this_word", "not this word (a name, another word)"]]
      .filter(([id]) => counts.get(id)).map(([id, text]) => [text, counts.get(id), "rest"]),
  ];
  const done = Boolean(request.usage);
  return view("senses",
    `“${esc(hint.word)}” in everyday ${esc(hint.language)}: which meaning it has in each sentence (${done ? sorted : `${sorted} of ${total}`})`,
    `<p class="research-view__explain">Sentences from ${esc(hint.language)} news, sorted by meaning. This shows how common each meaning is.</p>${bars(rows, total, "Sentences per meaning")}`);
}

function formsView(request, value) {
  const forms = list(value?.forms).filter((form) => str(form?.form));
  if (!forms.length) return view("forms", "Word forms", muted("…"));
  if (forms.some((form) => "keep" in form)) {
    const dropped = forms.some((form) => form.keep === false);
    return view("forms", "Which spellings really are this word",
      `<div class="research-view__chips">${forms.map((form) => `<span title="${esc(form.reason)}">${chip(form.form, form.keep === false ? "dropped" : "")}</span>`).join("")}</div>
       <p class="research-view__explain">${dropped ? "Crossed out: dropped (hover to see why)." : "All confirmed."}</p>`);
  }
  return view("forms", "Spellings to search for",
    `<div class="research-view__chips">${forms.map((form) => `<span title="${esc([form.kind, form.confidence].filter(Boolean).join(", "))}">${chip(form.form, [form.kind === "spelling" ? "outline" : "", form.confidence === "low" ? "faint" : ""].filter(Boolean).join(" research-view__chip--"))}</span>`).join("")}</div>
     <p class="research-view__explain">${[
       forms.some((form) => form.kind !== "spelling") ? "Solid: grammatical forms." : "",
       forms.some((form) => form.kind === "spelling") ? "Outlined: other spellings." : "",
       forms.some((form) => form.confidence === "low") ? "Faded: the AI is less sure." : "",
     ].filter(Boolean).join(" ")}</p>`);
}

function dictionaryView(request, value) {
  const entries = list(value?.entries);
  if (value?.found === false && !entries.length) return view("dictionary", "Dictionary", muted("No entry found on the dictionary sites."));
  return view("dictionary", "Dictionary entries found on the web", entries.map((entry) => `
    <div class="research-view__block">
      <div class="research-view__title">${esc(entry.sourceName)}${entry.url ? ` ${muted(entry.url)}` : ""}</div>
      <ol class="research-view__definitions">${list(entry.senses).map((sense) => `<li>${sense.labels ? `${muted(sense.labels)} ` : ""}${esc(sense.definition)}</li>`).join("")}</ol>
    </div>`).join(""));
}

function familyView(request, value) {
  const words = list(value?.words).filter((word) => str(word?.form));
  return view("family", words.length ? `${plural(words.length, "possible related word")}, each then searched for in the texts` : "Looking for related words",
    `<div class="research-view__rows">${words.map((word) => `
      <div class="research-view__row"><strong>${esc(word.form)}</strong> ${muted(word.reason)}</div>`).join("")}</div>`);
}

function sourcesView(request, value) {
  if (value && "confirmed" in value) {
    return view("original-check", "Checking the original word in the original text",
      `<p>${value.confirmed === true ? label("confirmed", "good") : value.confirmed === false ? label("not confirmed", "warn") : ""} ${value.originalTerm ? `<strong>“${esc(value.originalTerm)}”</strong>` : ""}</p>
       ${value.basis ? `<p class="research-view__explain">${esc(value.basis)}</p>` : ""}
       ${value.meaningInOriginal ? `<p>${esc(value.meaningInOriginal)}</p>` : ""}`);
  }
  const senses = list(value?.senses).filter((sense) => str(sense?.sense));
  // The step is already titled "Where the term comes from".
  return view("sources", "", `
    ${value?.summary ? `<p class="research-view__summary">${esc(value.summary)}</p>` : ""}
    ${senses.map((sense) => `
      <div class="research-view__card">
        <div class="research-view__title">${sense.label ? `<strong>${esc(sense.label)}</strong> ` : ""}${sense.partOfSpeech || sense.wordClass ? muted(`(${sense.partOfSpeech || sense.wordClass})`) : ""} ${sense.inDictionary === true ? label("in the dictionary") : sense.inDictionary === false ? label("not in the dictionary", "accent") : ""}</div>
        <div class="research-view__line">${esc(sense.sense)}</div>
        ${sense.sourceBook ? `<div class="research-view__line">From <strong>${esc(sense.sourceBook)}</strong>${sense.originalTerm ? `, original ${esc(sense.originalLanguage)} <strong>“${esc(sense.originalTerm)}”</strong>` : ""}</div>` : ""}
        ${sense.meaningInSource && sense.inDictionary === false ? `<div class="research-view__line">${muted("Meaning there:")} ${esc(sense.meaningInSource)}</div>` : ""}
        ${sense.authorUsage ? `<div class="research-view__line">${muted("How the author uses it:")} ${esc(sense.authorUsage)}</div>` : ""}
        ${list(sense.equivalences).length ? `<div class="research-view__chips">${list(sense.equivalences).filter((e) => str(e?.term)).map((e) => `<span title="${esc(e.evidence)}">${chip(`${e.relation === "identity" ? "= " : e.relation === "part" ? "⊂ " : "~ "}${e.term}`)}</span>`).join("")}</div>` : ""}
      </div>`).join("")}`);
}

function partsView(request, value) {
  const parts = list(value?.parts).filter((part) => str(part?.part));
  const senses = list(value?.senses).filter((sense) => str(sense?.gloss));
  const bases = list(value?.bases).filter((base) => str(base?.word));
  return view("parts", parts.length > 1 ? "How the word is built, and its meanings" : "Meanings", `
    ${parts.length ? `<div class="research-view__equation">${parts.map((part, index) => `${index ? '<span class="research-view__plus">+</span>' : ""}<span class="research-view__part"><strong>${esc(part.part)}</strong>${muted(part.meaning)}</span>`).join("")}</div>` : ""}
    ${senses.length ? `<ol class="research-view__definitions">${senses.map((sense) => `<li>${sense.partOfSpeech ? `${muted(`(${sense.partOfSpeech})`)} ` : ""}${esc(sense.gloss)}${sense.usedByAuthor === true ? ` ${label("used by the author", "accent")}` : ""}</li>`).join("")}</ol>` : ""}
    ${bases.length ? `<div class="research-view__rows">${bases.map((base) => `<div class="research-view__row">Base word <strong>${esc(base.word)}</strong>: ${esc(base.neededSense)} ${list(base.otherSenses).length ? muted(`+${plural(list(base.otherSenses).length, "other meaning")}`) : ""}</div>`).join("")}</div>` : ""}`);
}

function candidatesView(request, value) {
  const senses = list(value?.senses).filter((sense) => str(sense?.sense));
  const groups = senses.reduce((n, sense) => n + list(sense.groups).length, 0);
  return view("candidates", senses.length ? `${plural(groups, "option")} for ${plural(senses.length, "meaning")} <span class="research-view__muted">(★ recommended; words on one row can replace each other)</span>` : "Possible translations",
    senses.map((sense) => {
      const ordered = [...list(sense.groups)].sort((a, b) => Number(b?.recommended === true) - Number(a?.recommended === true));
      return `<div class="research-view__block">
        <div class="research-view__title">${esc(sense.sense)}</div>
        ${ordered.map((group) => `<div class="research-view__group${group.recommended ? " is-recommended" : ""}">
          <div class="research-view__chips">${group.recommended ? '<span class="research-view__star" title="recommended">★</span>' : ""}${list(group.members).filter(str).map((member, index) => chip(member, index === 0 ? "lead" : "")).join("")}</div>
          ${group.note ? `<div class="research-view__note">${esc(group.note)}</div>` : ""}
        </div>`).join("")}
      </div>`;
    }).join(""));
}

function checksView(request, value) {
  const candidates = list(value?.candidates).filter((c) => str(c?.target));
  const total = request.progress?.total;
  return view("checks", `Each candidate's words, and the meaning each must have (${total ? `${candidates.length} of ${total}` : candidates.length})`,
    `<p class="research-view__explain">Next, each word is looked up in everyday use (a compound word part by part). Highlighted: looks like the word being researched, so it may be a false friend.</p>
     <div class="research-view__table">${candidates.map((c) => {
      const words = list(c.words).filter((w) => str(w?.word));
      const own = words.filter((w) => !w.partOf);
      return `<div class="research-view__trow">
        <div class="research-view__tcell"><strong>${esc(c.target)}</strong>${c.establishedUsage === true ? ` ${label("established", "good")}` : ""}</div>
        <div class="research-view__tcell">${own.map((w) => {
          const parts = words.filter((p) => p.partOf === w.word).map((p) => p.word);
          return `<div class="research-view__word">${chip(w.word, w.lookalike ? "flag" : "")}${parts.length > 1 ? ` ${muted(`= ${parts.join(" + ")}`)}` : ""}${w.lookalike ? ` ${muted(`looks like “${w.resembles || "the term"}”: measured by meaning`)}` : ""}${w.neededSense ? `<div class="research-view__note">${esc(w.neededSense)}</div>` : ""}</div>`;
        }).join("")}</div>
      </div>`;
    }).join("")}</div>`);
}

/** Batch steps: the tally covers every request of the batch that has an answer. */
function batchItems(request, batch) {
  const members = batch?.length ? batch : [request];
  return members.flatMap((member) => (member === request ? null : parsePartialJson(member.answer ?? "")))
    .filter(Boolean)
    .flatMap((value) => list(value?.items));
}

/** Counts by displayed name (the same translation in two entries is one bar), most first. */
function tallyRows(items, keyOf, nameOf) {
  const counts = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    const name = nameOf(key);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
}

/** "114 uses of the word in 100 passages": a use's id is its passage's id, a dot and its number. */
function usesIn(items) {
  const passages = new Set(items.map((item) => str(item?.occId).split(".")[0])).size;
  return `${plural(items.length, "use")} of the word${passages && passages !== items.length ? ` in ${plural(passages, "passage")}` : ""}`;
}

/**
 * The rows of a batch step: while it runs, the uses of the request being written;
 * when the step is finished, every use, folded behind one line.
 */
function useRows(items, all, final, unit, row) {
  if (!final) return `<div class="research-view__rows">${items.map(row).join("")}</div>`;
  if (!all.length) return "";
  return `<details class="research-view__more"><summary>Show the ${plural(all.length, unit)}</summary><div class="research-view__rows">${all.map(row).join("")}</div></details>`;
}

function discoveryView(request, value, batch, final) {
  const items = list(value?.items).filter((item) => str(item?.occId));
  const all = [...batchItems(request, batch), ...items].filter((item) => str(item?.occId));
  const spelled = new Map();
  for (const item of all) {
    const key = str(item?.rendering).toLowerCase();
    if (key && !spelled.has(key)) spelled.set(key, item.rendering);
  }
  const rows = tallyRows(all, (item) => str(item?.rendering).toLowerCase(), (key) => spelled.get(key) ?? key).slice(0, 8);
  const row = (item) => `<div class="research-view__row"><strong>${esc(item.rendering)}</strong> ${muted(item.phraseTranslation)}${item.expressionCandidate ? ` ${label(`expression: ${item.expressionCandidate}`, "accent")}` : ""}</div>`;
  return view("discovery", `What the AI wrote, with no suggestions (${usesIn(all)}${final ? "" : " so far"})`,
    `${rows.length ? bars(rows, 0, "Renderings used") : ""}${useRows(items, all, final, "use", row)}`);
}

function highlightIn(sentence, wording) {
  const text = str(sentence);
  const at = wording ? text.toLowerCase().indexOf(String(wording).toLowerCase()) : -1;
  return at < 0 ? esc(text) : `${esc(text.slice(0, at))}<mark>${esc(text.slice(at, at + wording.length))}</mark>${esc(text.slice(at + wording.length))}`;
}

function countingView(request, value, batch, final) {
  const names = request.progress?.variants ?? {};
  const items = list(value?.items).filter((item) => str(item?.occId));
  const all = [...batchItems(request, batch), ...items].filter((item) => str(item?.occId));
  const rows = tallyRows(all, (item) => (item.status === "selected" ? item.variantId : item.status ? `__${item.status}` : ""),
    (key) => (key === "__other" ? "something else" : key === "__unresolved" ? "could not tell" : names[key] ?? key));
  const row = (item) => `<div class="research-view__row">
        ${item.status && item.status !== "selected" ? label(item.status === "other" ? `something else${item.otherRendering ? `: ${item.otherRendering}` : ""}` : "could not tell", "warn") : ""}${item.fit === "poor" ? ` ${label("poor fit", "warn")}` : ""}
        <div class="research-view__sentence">${highlightIn(item.sentenceTranslation, item.chosenWording)}</div>
      </div>`;
  return view("counting", `Translation chosen for each use of the word (${usesIn(all)}${final ? "" : " so far"})`,
    `${rows.length ? bars(rows.map(([text, n]) => [text, n, text === "something else" || text === "could not tell" ? "rest" : "sense"]), 0, "Chosen translations") : ""}${useRows(items, all, final, "use", row)}`);
}

function proposalView(request, value) {
  const entries = list(value?.entries).filter((entry) => list(entry?.sourceTerms).length || str(entry?.generalNote));
  const leftOut = list(value?.leftOutRenderings).filter((item) => str(item?.rendering));
  const small = (title, items, render) => (items.length ? `<div class="research-view__block"><div class="research-view__title">${title}</div><ul class="research-view__list">${items.map(render).join("")}</ul></div>` : "");
  return view("proposal", `Proposed ${entries.length === 1 ? "entry" : "entries"}${list(value?.partsOfSpeech).length ? ` ${muted(`(${list(value.partsOfSpeech).join(", ")})`)}` : ""}`, `
    ${entries.map((entry) => `<div class="research-view__card">
      <div class="research-view__title"><strong>${esc(list(entry.sourceTerms).join(" · "))}</strong>${entry.kind === "expression" ? ` ${label("expression")}` : ""}</div>
      ${entry.generalNote ? `<div class="research-view__note">${esc(entry.generalNote)}</div>` : ""}
      <ul class="research-view__list">${list(entry.variants).filter((v) => str(v?.target)).map((v) => `<li><strong>${esc(v.target)}</strong>${v.partOfSpeech ? ` ${muted(`(${v.partOfSpeech})`)}` : ""}${v.note ? ` — ${esc(v.note)}` : ""}</li>`).join("")}</ul>
    </div>`).join("")}
    ${small("Translations left out", leftOut, (item) => `<li><strong>${esc(item.rendering)}</strong>${item.count ? ` ${muted(`×${item.count}`)}` : ""} ${muted(item.reason)}</li>`)}
    ${small("Fixed expressions without their own entry", list(value?.rejectedExpressions).filter((x) => str(x?.source)), (item) => `<li><strong>${esc(item.source)}</strong> ${muted(item.reason)}</li>`)}
    ${small("Related words to research separately", list(value?.derivativeStudies).filter((x) => str(x?.source)), (item) => `<li><strong>${esc(item.source)}</strong> ${muted(item.reason)}</li>`)}
    ${small("Open questions", list(value?.openQuestions).filter(str), (item) => `<li>${esc(item)}</li>`)}`);
}

function convergenceView(request, value) {
  const names = new Map(list(request.progress?.pairs).map((pair) => [pair.n, pair]));
  const pairs = list(value?.pairs).filter((pair) => Number.isFinite(pair?.n));
  return view("convergence", "Translations shared with other words", `<div class="research-view__rows">${pairs.map((pair) => {
    const name = names.get(pair.n);
    return `<div class="research-view__row">${name ? `<strong>${esc(name.target)}</strong> for ${esc(name.a)} and ${esc(name.b)}` : `pair ${pair.n}`}
      ${pair.relation === "same" ? label("same meaning", "good") : pair.relation === "different" ? label("different meanings", "warn") : ""}
      <div class="research-view__note">${esc(pair.reason)}</div></div>`;
  }).join("")}</div>`);
}

function comparisonView(request, value) {
  const items = list(value?.items).filter((item) => str(item?.existing));
  return view("comparison", "The current glossary entry, translation by translation", `<div class="research-view__rows">${items.map((item) => `
    <div class="research-view__row"><strong>${esc(item.existing)}</strong> ${item.verdict === "proposed" ? label("kept", "good") : item.verdict === "left_out" ? label("left out", "warn") : ""}
      <div class="research-view__note">${esc(item.reason)}</div></div>`).join("")}</div>`);
}

function footnotesView(request, value) {
  const items = list(value?.items).filter((item) => str(item?.target));
  return view("footnotes", "Notes for rare translations", `<div class="research-view__rows">${items.map((item) => `
    <div class="research-view__row"><strong>${esc(item.target)}</strong> ${item.understandableFromParts === true ? label("understood from its parts", "good") : ""}${item.note ? `<div class="research-view__note">${esc(item.note)}</div>` : ""}</div>`).join("")}</div>`);
}

function summaryView(request, value) {
  return view("summary", "Summary", `
    ${value?.summary ? `<p class="research-view__summary">${esc(value.summary)}</p>` : ""}
    ${list(value?.recommendations).filter(str).length ? `<ul class="research-view__list">${list(value.recommendations).filter(str).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
    ${value?.unresolvedExplanation ? `<p class="research-view__explain">${esc(value.unresolvedExplanation)}</p>` : ""}`);
}

const VIEWS = {
  frequency: sensesView,
  forms: formsView,
  dictionary: dictionaryView,
  family: familyView,
  sources: sourcesView,
  parts: partsView,
  candidates: candidatesView,
  checks: checksView,
  discovery: discoveryView,
  counting: countingView,
  proposal: proposalView,
  convergence: convergenceView,
  comparison: comparisonView,
  footnotes: footnotesView,
  summary: summaryView,
};

/**
 * HTML for the answer of a request so far, or null when there is no view for it
 * (then the plain JSON is shown). `batch` lists the requests of its batch.
 */
export function liveAnswerHtml(request, { batch = null, final = false } = {}) {
  const render = VIEWS[request?.stage];
  if (!render || !request.answer) return null;
  const value = parsePartialJson(request.answer);
  if (!value) return null;
  try {
    return render(request, value, batch, final);
  } catch {
    return null;
  }
}

// --- one display per step ----------------------------------------------------------
//
// Steps whose data arrives in several parts (an AI answer, then counts, then a
// check) show it in one display that fills in place: counts go next to the
// words they count, a check marks the words it drops, measurements land in the
// rows they measure. Each returns { html, requests, results, facts }: what it
// drew, so the step does not draw those again. Null: the step has no such display.

const answerOf = (request) => (request?.answer ? parsePartialJson(request.answer) : null);
const lower = (text) => str(text).normalize("NFC").toLowerCase().trim();
const isRunning = (request) => !request.usage && !request.problem;

function resultData(section, kind) {
  return section.items.filter((item) => item.kind === "result" && item.resultKind === kind)
    .flatMap((item) => (Array.isArray(item.data) ? item.data : []));
}

function lineTexts(section, type) {
  return section.items.filter((item) => item.kind === "line" && item.entry.type === type).map((item) => str(item.entry.text));
}

/** "word (12), other (3)" → Map(word → 12). */
function countList(text) {
  return new Map([...String(text).matchAll(/([^,():]+?) \((\d+)\)/g)].map((m) => [lower(m[1]), Number(m[2])]));
}

function formsDisplay(section, context) {
  const requests = section.requests.filter((request) => request.stage === "forms");
  const proposeRequest = requests.find((request) => !/"keep"\s*:/.test(request.answer ?? ""));
  const confirmRequest = requests.find((request) => /"keep"\s*:/.test(request.answer ?? ""));
  const proposed = list(answerOf(proposeRequest)?.forms).filter((form) => str(form?.form));
  if (!proposed.length) return null;
  const decisions = new Map(list(answerOf(confirmRequest)?.forms).filter((form) => str(form?.form)).map((form) => [lower(form.form), form]));
  // Counts: logged as data; older runs logged them as lines.
  const counts = new Map(resultData(section, "formCount").map((item) => [lower(item.form), item]));
  for (const text of lineTexts(section, "info")) {
    const m = /^“(.+?)” appears in (\d+) passages?/.exec(text) ?? /^search “(.+?)”: (\d+) passages/.exec(text);
    if (m && !counts.has(lower(m[1]))) counts.set(lower(m[1]), { form: m[1], rows: Number(m[2]), added: /added/.test(text) });
  }
  const shown = [...proposed];
  for (const item of counts.values()) {
    if (!shown.some((form) => lower(form.form) === lower(item.form))) shown.push({ form: item.form, kind: item.kind === "text" ? "text" : "spelling", added: true });
  }
  const chips = shown.map((form) => {
    const count = counts.get(lower(form.form));
    const decision = decisions.get(lower(form.form));
    const kind = [form.kind === "spelling" || form.kind === "text" ? "outline" : "", form.confidence === "low" ? "faint" : "", decision?.keep === false ? "dropped" : ""].filter(Boolean);
    const text = count ? `${form.form} (${count.rows})` : form.form;
    return `<span title="${esc([decision?.reason, form.added ? "added: found in the texts or spelled without accents" : ""].filter(Boolean).join("; "))}">${chip(text, kind.join(" research-view__chip--"))}</span>`;
  }).join("");
  const anyDropped = [...decisions.values()].some((form) => form.keep === false);
  const legend = [
    shown.some((form) => form.kind !== "spelling" && form.kind !== "text") ? "Solid: grammatical forms." : "",
    shown.some((form) => form.kind === "spelling" || form.kind === "text") ? "Outlined: other spellings." : "",
    shown.some((form) => form.confidence === "low") ? "Faded: the AI is less sure." : "",
    counts.size ? "The number is how many passages use the spelling." : "",
    anyDropped ? "Crossed out: a different word spelled the same (hover to see why)." : decisions.size ? "Checked in example passages: each is this word." : "",
  ].filter(Boolean).join(" ");
  const heading = counts.size ? `Spellings, and how many passages in ${esc(context.texts ?? "the texts")} use each` : "";
  return {
    html: view("forms", heading, `<div class="research-view__chips">${chips}</div><p class="research-view__explain">${legend}</p>`),
    requests: new Set(requests.map((request) => request.requestId)),
    results: new Set(["formCount"]),
    facts: [/spellings? found in the texts:|^Forms: /],
  };
}

function familyDisplay(section) {
  const request = section.requests.find((item) => item.stage === "family");
  const words = list(answerOf(request)?.words).filter((word) => str(word?.form) && word.kind !== "phrase");
  if (!words.length) return null;
  const fact = lineTexts(section, "fact").find((text) => /^(Related words in the texts|Word family in the texts)/.test(text));
  const counts = fact ? countList(fact.slice(fact.indexOf(":") + 1)) : null;
  const row = (form, reason, count) => `<div class="research-view__row"><strong>${esc(form)}</strong>${count != null ? ` (${count})` : ""} ${muted(reason)}</div>`;
  if (!counts) {
    return {
      html: view("family", `Possible related words${isRunning(request) ? " so far" : ""}`, `<div class="research-view__rows">${words.map((word) => row(word.form, word.reason)).join("")}</div>`),
      requests: new Set([request.requestId]), results: new Set(), facts: [],
    };
  }
  const reasons = new Map(words.map((word) => [lower(word.form), word.reason]));
  const found = [...counts].sort((a, b) => b[1] - a[1]);
  const missing = words.filter((word) => !counts.has(lower(word.form)));
  return {
    html: view("family", found.length ? "Related words in the texts, and how many passages use each" : "None of the possible related words is in the texts", `
      <div class="research-view__rows">${found.map(([form, count]) => row(words.find((word) => lower(word.form) === form)?.form ?? form, reasons.get(form) ?? "", count)).join("")}</div>
      ${missing.length ? `<details class="research-view__more"><summary>${plural(missing.length, "other possible word")} not in the texts</summary><div class="research-view__rows">${missing.map((word) => row(word.form, word.reason)).join("")}</div></details>` : ""}`),
    requests: new Set([request.requestId]), results: new Set(), facts: [/^(Related words in the texts|Word family in the texts|No other words built on the term)/],
  };
}

function meaningsDisplay(section, context) {
  const request = section.requests.find((item) => item.stage === "parts");
  const study = answerOf(request);
  const senses = list(study?.senses).filter((sense) => str(sense?.gloss));
  if (!senses.length) return null;
  const parts = list(study?.parts).filter((part) => str(part?.part));
  const ids = new Set(senses.map((sense) => sense.id));
  // The sorting of the term's own sentences uses the meanings' ids; a base word's uses "needed".
  const sorting = section.requests.find((item) => item.stage === "frequency" && list(item.progress?.senses).some((sense) => ids.has(sense.id)));
  const counts = new Map();
  let sorted = 0;
  for (const item of list(answerOf(sorting)?.items)) {
    if (!str(item?.sense)) continue;
    sorted += 1;
    counts.set(item.sense, (counts.get(item.sense) ?? 0) + 1);
  }
  const language = sorting?.progress?.language ?? context.source ?? "";
  const word = context.term ?? sorting?.progress?.word ?? "";
  const rows = [
    ...senses.map((sense) => [sense.gloss, counts.get(sense.id) ?? 0, sense.usedByAuthor ? "needed" : "sense", sense.partOfSpeech ?? ""]),
    ...[["other", "another meaning"], ["not_this_word", "not this word (a name, another word)"]].filter(([id]) => counts.get(id)).map(([id, text]) => [text, counts.get(id), "rest"]),
  ];
  const total = sorting?.progress?.total ?? sorted;
  const equation = parts.length > 1 ? `<div class="research-view__equation">${parts.map((part, index) => `${index ? '<span class="research-view__plus">+</span>' : ""}<span class="research-view__part"><strong>${esc(part.part)}</strong>${muted(part.meaning)}</span>`).join("")}</div>` : "";
  const body = sorting
    ? `${bars(rows, total, "Sentences per meaning")}<p class="research-view__explain">Bars: how many of ${total} everyday ${esc(language)} sentences (news) use each meaning${sorting && isRunning(sorting) ? ", so far" : ""}. Darker: meanings the author uses.</p>`
    : `<ol class="research-view__definitions">${senses.map((sense) => `<li>${sense.partOfSpeech ? `${muted(`(${sense.partOfSpeech})`)} ` : ""}${esc(sense.gloss)}${sense.usedByAuthor ? ` ${label("used by the author", "accent")}` : ""}</li>`).join("")}</ol>`;
  return {
    html: view("parts", sorting ? `Meanings of “${esc(word)}”, and how often each is used` : `Meanings of “${esc(word)}”`, `${equation}${body}`),
    requests: new Set([request.requestId, ...(sorting ? [sorting.requestId] : [])]),
    results: new Set(["frequency"]),
    facts: [],
  };
}

function checksDisplay(section, context) {
  const request = section.requests.find((item) => item.stage === "checks");
  const candidates = list(answerOf(request)?.candidates).filter((candidate) => str(candidate?.target));
  if (!candidates.length) return null;
  const sortings = section.requests.filter((item) => item.stage === "frequency");
  const measured = new Map();
  for (const sorting of sortings) {
    const items = list(answerOf(sorting)?.items).filter((item) => str(item?.sense));
    if (!items.length || isRunning(sorting)) continue;
    measured.set(`${lower(sorting.progress?.word)}\u0000${lower(list(sorting.progress?.senses)[0]?.gloss)}`,
      { inSense: items.filter((item) => item.sense === "needed").length, of: items.length });
  }
  const verdicts = new Map(resultData(section, "checks").map((check) => [lower(check.target), check]));
  const verdictLabel = { pass: ["passes", "good"], fail: ["fails", "warn"], unclear: ["unclear", "warn"] };
  const rows = candidates.map((candidate) => {
    const words = list(candidate.words).filter((w) => str(w?.word));
    const own = words.filter((w) => !w.partOf);
    const check = verdicts.get(lower(candidate.target));
    const [verdictText, tone] = verdictLabel[check?.verdict] ?? [];
    const reason = check ? [...list(check.reasons), ...list(check.notes)][0] : "";
    return `<div class="research-view__trow">
      <div class="research-view__tcell"><strong>${esc(candidate.target)}</strong>${verdictText ? ` ${label(verdictText, tone)}` : ""}${reason ? `<div class="research-view__note">${esc(reason)}</div>` : ""}</div>
      <div class="research-view__tcell">${own.map((w) => {
        const pieces = words.filter((p) => p.partOf === w.word).map((p) => p.word);
        const m = measured.get(`${lower(w.word)}\u0000${lower(w.neededSense)}`);
        return `<div class="research-view__word">${chip(w.word, w.lookalike ? "flag" : "")}${pieces.length > 1 ? ` ${muted(`= ${pieces.join(" + ")}`)}` : ""}
          <div class="research-view__note">${esc(w.neededSense)}${m ? ` — used this way in ${m.inSense} of ${m.of} everyday sentences` : ""}</div></div>`;
      }).join("")}</div>
    </div>`;
  }).join("");
  const done = verdicts.size > 0;
  return {
    html: view("checks", done ? "Each candidate, its words, and whether it passes" : `Each candidate's words, and the meaning each must have (${candidates.length}${request.progress?.total ? ` of ${request.progress.total}` : ""})`,
      `<p class="research-view__explain">Each word is measured in everyday ${esc(context.target ?? "")} sentences (news): how often is it used in the meaning needed? Highlighted: looks like the word being researched, so it may be a false friend.</p>
       <div class="research-view__table">${rows}</div>`),
    // A word being sorted right now keeps its own live chart below the table.
    requests: new Set([request.requestId, ...sortings.filter((sorting) => !isRunning(sorting)).map((sorting) => sorting.requestId)]),
    results: new Set(["checks"]),
    facts: [],
  };
}

const STEP_DISPLAYS = {
  "Word forms": formsDisplay,
  "Word family": familyDisplay,
  "Parts and frequency": meaningsDisplay,
  "Candidate checks": checksDisplay,
};

/** The one display of a step that has one (see above), or null. */
export function stepDisplay(section, context = {}) {
  const build = STEP_DISPLAYS[section?.heading];
  if (!build) return null;
  try {
    return build(section, context);
  } catch {
    return null;
  }
}
