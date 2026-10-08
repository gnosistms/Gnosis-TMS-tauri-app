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
    ...senses.map((sense) => [sense.gloss, counts.get(sense.id) ?? 0, sense.id === "needed" ? "needed" : "sense", sense.id === "needed" ? "needed" : ""]),
    ...[["other", "another meaning"], ["not_this_word", "not this word (a name, another word)"]]
      .filter(([id]) => counts.get(id)).map(([id, text]) => [text, counts.get(id), "rest"]),
  ];
  const done = Boolean(request.usage);
  return view("senses",
    `${done ? "Sorted" : "Sorting"} ${done ? sorted : `${sorted} of ${total}`} general ${esc(hint.language)} sentences with “${esc(hint.word)}” by meaning`,
    `<p class="research-view__explain">Each sentence is put under the meaning it uses. A meaning's share of the sentences becomes its share of the word's frequency score.</p>${bars(rows, total, "Sentences per meaning")}`);
}

function formsView(request, value) {
  const forms = list(value?.forms).filter((form) => str(form?.form));
  if (!forms.length) return view("forms", "Word forms", muted("…"));
  if (forms.some((form) => "keep" in form)) {
    return view("forms", "Checking the forms against the texts",
      `<div class="research-view__chips">${forms.map((form) => `<span title="${esc(form.reason)}">${chip(form.form, form.keep === false ? "dropped" : "")}</span>`).join("")}</div>
       <p class="research-view__explain">Struck-out forms were dropped; hover for the reason.</p>`);
  }
  return view("forms", "Forms of the term to search for",
    `<div class="research-view__chips">${forms.map((form) => `<span title="${esc([form.kind, form.confidence].filter(Boolean).join(", "))}">${chip(form.form, [form.kind === "spelling" ? "outline" : "", form.confidence === "low" ? "faint" : ""].filter(Boolean).join(" research-view__chip--"))}</span>`).join("")}</div>
     <p class="research-view__explain">Solid: inflections. Outlined: other spellings. Faded: less likely.</p>`);
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
  const kinds = { prefixed: "prefix", suffixed: "suffix", compound: "compound", phrase: "phrase" };
  return view("family", words.length ? `${plural(words.length, "related word")} found` : "Looking for related words",
    `<div class="research-view__rows">${words.map((word) => `
      <div class="research-view__row"><strong>${esc(word.form)}</strong> ${word.kind ? label(kinds[word.kind] ?? word.kind) : ""} ${muted(word.reason)}</div>`).join("")}</div>`);
}

function sourcesView(request, value) {
  if (value && "confirmed" in value) {
    return view("original-check", "Checking the original word in the original text",
      `<p>${value.confirmed === true ? label("confirmed", "good") : value.confirmed === false ? label("not confirmed", "warn") : ""} ${value.originalTerm ? `<strong>“${esc(value.originalTerm)}”</strong>` : ""}</p>
       ${value.basis ? `<p class="research-view__explain">${esc(value.basis)}</p>` : ""}
       ${value.meaningInOriginal ? `<p>${esc(value.meaningInOriginal)}</p>` : ""}`);
  }
  const senses = list(value?.senses).filter((sense) => str(sense?.sense));
  return view("sources", "Where the term comes from", `
    ${value?.summary ? `<p class="research-view__summary">${esc(value.summary)}</p>` : ""}
    ${senses.map((sense) => `
      <div class="research-view__card">
        <div class="research-view__title">${sense.label ? `<strong>${esc(sense.label)}</strong> ` : ""}${sense.wordClass ? muted(`(${sense.wordClass})`) : ""} ${sense.inDictionary === true ? label("in the dictionary") : sense.inDictionary === false ? label("not in the dictionary", "accent") : ""}</div>
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
  return view("parts", "Parts and meanings", `
    ${parts.length ? `<div class="research-view__equation">${parts.map((part, index) => `${index ? '<span class="research-view__plus">+</span>' : ""}<span class="research-view__part"><strong>${esc(part.part)}</strong>${muted(part.meaning)}</span>`).join("")}</div>` : ""}
    ${senses.length ? `<ol class="research-view__definitions">${senses.map((sense) => `<li>${esc(sense.gloss)}${sense.usedByAuthor === true ? ` ${label("used by the author", "accent")}` : ""}</li>`).join("")}</ol>` : ""}
    ${bases.length ? `<div class="research-view__rows">${bases.map((base) => `<div class="research-view__row">Base word <strong>${esc(base.word)}</strong>: ${esc(base.neededSense)} ${list(base.otherSenses).length ? muted(`+${plural(list(base.otherSenses).length, "other meaning")}`) : ""}</div>`).join("")}</div>` : ""}`);
}

function candidatesView(request, value) {
  const senses = list(value?.senses).filter((sense) => str(sense?.sense));
  const groups = senses.reduce((n, sense) => n + list(sense.groups).length, 0);
  return view("candidates", senses.length ? `${plural(groups, "group")} of candidate translations for ${plural(senses.length, "meaning")}` : "Candidate translations",
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
  return view("checks", `${total ? `${candidates.length} of ${total}` : candidates.length} candidates taken apart into their words`,
    `<p class="research-view__explain">Each word is then measured in general use; a word that looks like the Spanish term is also checked for the meaning it is used in.</p>
     <div class="research-view__table">${candidates.map((c) => {
      const words = list(c.words).filter((w) => str(w?.word));
      const own = words.filter((w) => !w.partOf);
      return `<div class="research-view__trow">
        <div class="research-view__tcell"><strong>${esc(c.target)}</strong>${c.establishedUsage === true ? ` ${label("established", "good")}` : ""}</div>
        <div class="research-view__tcell">${own.map((w) => {
          const parts = words.filter((p) => p.partOf === w.word).map((p) => p.word);
          return `<div class="research-view__word">${chip(w.word, w.lookalike ? "flag" : "")}${parts.length ? ` ${muted(`= ${parts.join(" + ")}`)}` : ""}${w.lookalike ? ` ${muted(`looks like “${w.resembles || "the term"}”: measured by meaning`)}` : ""}${w.neededSense ? `<div class="research-view__note">${esc(w.neededSense)}</div>` : ""}</div>`;
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

function discoveryView(request, value, batch) {
  const items = list(value?.items).filter((item) => str(item?.occId));
  const all = [...batchItems(request, batch), ...items];
  const rows = tallyRows(all, (item) => str(item?.rendering), (key) => key).slice(0, 8);
  return view("discovery", `Open reading: what a translator reaches for${batch?.length > 1 ? " (this batch so far)" : ""}`,
    `${rows.length ? bars(rows, 0, "Renderings used") : ""}
     <div class="research-view__rows">${items.map((item) => `<div class="research-view__row">${muted(item.occId)} <strong>${esc(item.rendering)}</strong> ${muted(item.phraseTranslation)}${item.expressionCandidate ? ` ${label(`expression: ${item.expressionCandidate}`, "accent")}` : ""}</div>`).join("")}</div>`);
}

function highlightIn(sentence, wording) {
  const text = str(sentence);
  const at = wording ? text.toLowerCase().indexOf(String(wording).toLowerCase()) : -1;
  return at < 0 ? esc(text) : `${esc(text.slice(0, at))}<mark>${esc(text.slice(at, at + wording.length))}</mark>${esc(text.slice(at + wording.length))}`;
}

function countingView(request, value, batch) {
  const names = request.progress?.variants ?? {};
  const items = list(value?.items).filter((item) => str(item?.occId));
  const all = [...batchItems(request, batch), ...items];
  const rows = tallyRows(all, (item) => (item.status === "selected" ? item.variantId : item.status ? `__${item.status}` : ""),
    (key) => (key === "__other" ? "something else" : key === "__unresolved" ? "could not tell" : names[key] ?? key));
  return view("counting", `Which translation fits each use${batch?.length > 1 ? " (this batch so far)" : ""}`,
    `${rows.length ? bars(rows.map(([text, n]) => [text, n, text === "something else" || text === "could not tell" ? "rest" : "sense"]), 0, "Chosen translations") : ""}
     <div class="research-view__rows">${items.map((item) => `<div class="research-view__row">
        ${muted(item.occId)} ${item.status && item.status !== "selected" ? label(item.status === "other" ? `something else${item.otherRendering ? `: ${item.otherRendering}` : ""}` : "could not tell", "warn") : ""}${item.fit === "poor" ? ` ${label("poor fit", "warn")}` : ""}
        <div class="research-view__sentence">${highlightIn(item.sentenceTranslation, item.chosenWording)}</div>
      </div>`).join("")}</div>`);
}

function proposalView(request, value) {
  const entries = list(value?.entries).filter((entry) => list(entry?.sourceTerms).length || str(entry?.generalNote));
  const leftOut = list(value?.leftOutRenderings).filter((item) => str(item?.rendering));
  const small = (title, items, render) => (items.length ? `<div class="research-view__block"><div class="research-view__title">${title}</div><ul class="research-view__list">${items.map(render).join("")}</ul></div>` : "");
  return view("proposal", `Proposed ${entries.length === 1 ? "entry" : "entries"}${value?.partOfSpeech ? ` ${muted(`(${value.partOfSpeech})`)}` : ""}`, `
    ${entries.map((entry) => `<div class="research-view__card">
      <div class="research-view__title"><strong>${esc(list(entry.sourceTerms).join(" · "))}</strong>${entry.kind === "expression" ? ` ${label("expression")}` : ""}</div>
      ${entry.generalNote ? `<div class="research-view__note">${esc(entry.generalNote)}</div>` : ""}
      <ul class="research-view__list">${list(entry.variants).filter((v) => str(v?.target)).map((v) => `<li><strong>${esc(v.target)}</strong>${v.note ? ` — ${esc(v.note)}` : ""}</li>`).join("")}</ul>
    </div>`).join("")}
    ${small("Left out", leftOut, (item) => `<li><strong>${esc(item.rendering)}</strong>${item.count ? ` ${muted(`×${item.count}`)}` : ""} ${muted(item.reason)}</li>`)}
    ${small("Fixed expressions without their own entry", list(value?.rejectedExpressions).filter((x) => str(x?.source)), (item) => `<li><strong>${esc(item.source)}</strong> ${muted(item.reason)}</li>`)}
    ${small("Separate studies suggested", list(value?.derivativeStudies).filter((x) => str(x?.source)), (item) => `<li><strong>${esc(item.source)}</strong> ${muted(item.reason)}</li>`)}
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
export function liveAnswerHtml(request, { batch = null } = {}) {
  const render = VIEWS[request?.stage];
  if (!render || !request.answer) return null;
  const value = parsePartialJson(request.answer);
  if (!value) return null;
  try {
    return render(request, value, batch);
  } catch {
    return null;
  }
}
