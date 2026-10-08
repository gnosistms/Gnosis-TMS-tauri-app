import {
  actionNavButton,
  escapeHtml,
  pageShell,
  primaryButton,
  renderCollapseChevron,
  renderStateCard,
  secondaryButton,
} from "../lib/ui.js";
import { formatUsd } from "../app/glossary-research-budget.js";
import { describeSense, formatZipf } from "../app/glossary-research-frequency.js";

const esc = escapeHtml;
const EXAMPLES_SHOWN = 5;

function highlight(text, start, end) {
  return `${esc(text.slice(0, start))}<mark>${esc(text.slice(start, end))}</mark>${esc(text.slice(end))}`;
}

function highlightWording(sentence, wording) {
  if (!wording) return esc(sentence);
  const index = sentence.toLowerCase().indexOf(wording.toLowerCase());
  return index < 0 ? esc(sentence) : highlight(sentence, index, index + wording.length);
}

/** Source sentence with its neighbours when short, judged span highlighted. */
function sourceExcerpt(item, occurrence) {
  const text = item.text;
  let a = occurrence.sentenceStart;
  let b = occurrence.sentenceEnd;
  const before = text.lastIndexOf(". ", a - 2);
  if (a > 0 && a - (before + 2) <= 260) a = before >= 0 ? before + 2 : 0;
  const after = text.indexOf(". ", b);
  if (b < text.length && (after < 0 ? text.length : after + 1) - b <= 260) b = after < 0 ? text.length : after + 1;
  const body = highlight(text.slice(a, b), occurrence.markStart - a, occurrence.markEnd - a);
  return `${a > 0 ? "…" : ""}${body}${b < text.length ? "…" : ""}`;
}

function reference(item) {
  const ref = item.reference ?? {};
  const label = [ref.title, ref.chapter, ref.paragraph != null ? `¶${ref.paragraph}` : ""].filter(Boolean).map(esc).join(" · ");
  const copies = item.copyCount > 1 ? ` <span class="muted">(+${item.copyCount - 1} identical)</span>` : "";
  if (ref.url) return `<button type="button" class="text-action" data-action="open-research-source:${esc(ref.url)}">${label}</button>${copies}`;
  return `${label}${copies}`;
}

function renderExample(run, occurrence, judgment, targetCode, sourceCode) {
  const item = run.sample.items[occurrence.itemId];
  const fit = judgment.fit && judgment.fit !== "good" ? `<span class="rr-pill rr-pill--warn">${esc(judgment.fit)} fit</span>` : "";
  return `
    <li class="rr-example">
      <div class="rr-example__line">
        <span class="rr-example__lang">${esc(sourceCode.toUpperCase())}</span>
        <p lang="${esc(sourceCode)}">${sourceExcerpt(item, occurrence)}</p>
      </div>
      ${judgment.sentenceTranslation ? `
        <div class="rr-example__line">
          <span class="rr-example__lang">${esc(targetCode.toUpperCase())}</span>
          <p lang="${esc(targetCode)}">${highlightWording(judgment.sentenceTranslation, judgment.chosenWording)}</p>
        </div>` : ""}
      <div class="rr-example__meta">${reference(item)}${fit}${judgment.note ? `<span class="rr-example__note">${esc(judgment.note)}</span>` : ""}</div>
    </li>`;
}

function renderVariantExamples(report, run, entryId, variantId, meta) {
  const key = `${entryId}:${variantId}`;
  if (!report.expandedVariants[key]) return "";
  const judgments = run.counting.judgments;
  const matching = run.counting.occurrences.filter((occurrence) => occurrence.entryId === entryId
    && (variantId === "__other"
      ? judgments[occurrence.occId]?.status !== "selected"
      : judgments[occurrence.occId]?.variantId === variantId));
  const translated = matching.filter((occurrence) => judgments[occurrence.occId]?.sentenceTranslation);
  if (!matching.length) return `<div class="rr-examples"><p class="rr-muted">No sampled use chose this translation.</p></div>`;
  const shown = report.showAllExamples[key] ? translated : translated.slice(0, EXAMPLES_SHOWN);
  return `
    <div class="rr-examples">
      <p class="rr-muted">Only the sentence with the word is translated, not the whole passage.</p>
      <ol class="rr-examples__list">
        ${shown.map((occurrence) => renderExample(run, occurrence, judgments[occurrence.occId], meta.targetLanguage.code, meta.sourceLanguage.code)).join("")}
      </ol>
      ${translated.length > shown.length ? `<button type="button" class="rr-link" data-action="show-all-research-examples:${esc(key)}">Show ${translated.length - shown.length} more</button>` : ""}
    </div>`;
}

function countCell(key, count, total, passages, expanded, unit) {
  const pct = total ? Math.round((100 * count) / total) : 0;
  return `
    <div class="rr-count">
      <div class="rr-count__figure"><strong>${count}</strong><span> of ${total} ${unit}</span></div>
      <div class="rr-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
      <button type="button" class="rr-link rr-count__toggle collapse-affordance" data-action="toggle-research-examples:${esc(key)}" aria-expanded="${expanded ? "true" : "false"}">
        ${renderCollapseChevron(expanded)}<span>${passages == null ? "" : `${passages} passage${passages === 1 ? "" : "s"} · `}${expanded ? "hide" : "show"}</span>
      </button>
    </div>`;
}

function sameForms(a, b) {
  const key = (forms) => [...new Set(forms.map((form) => form.trim().toLowerCase()))].sort().join("|");
  return key(a) === key(b);
}

/** The entry as it is in the glossary now, each translation marked kept or left out by the suggestion. */
function renderCurrentEntry(run, draft, meta) {
  const comparison = (run.confirmedProposal ?? run.proposal)?.existingComparison ?? [];
  const compared = (target) => comparison.find((item) => item.existing?.trim().toLowerCase() === target.trim().toLowerCase());
  const proposed = new Set(draft.variants.map((variant) => variant.target.trim().toLowerCase()));
  const tgt = meta.targetLanguage.code;
  const rows = draft.existing.targetTerms.map((target, index) => {
    const item = compared(target);
    const kept = item?.verdict === "proposed" || proposed.has(target.trim().toLowerCase());
    const status = kept
      ? `<span class="rr-pill rr-pill--ok">also in the suggestion</span>`
      : item?.verdict === "left_out" ? `<span class="rr-pill rr-pill--warn">left out of the suggestion</span>` : "";
    const note = draft.existing.targetVariantNotes?.[index];
    return `
      <li class="rr-current__row">
        <div class="rr-current__head"><span class="rr-current__target" lang="${esc(tgt)}">${esc(target)}</span>${status}</div>
        ${note ? `<p class="rr-current__variant-note" lang="${esc(tgt)}">${esc(note)}</p>` : ""}
        ${!kept && item?.reason ? `<p class="rr-muted">Why: ${esc(item.reason)}</p>` : ""}
      </li>`;
  }).join("");
  return `
    <section class="rr-block rr-current-entry">
      ${draft.existing.notesToTranslators ? `
        <div class="rr-field">
          <span class="rr-field__label">Note for all translations</span>
          <p class="rr-current__note" lang="${esc(tgt)}">${esc(draft.existing.notesToTranslators)}</p>
        </div>` : ""}
      ${sameForms(draft.existing.sourceTerms, draft.sourceTerms) ? "" : `
      <div class="rr-field">
        <span class="rr-field__label">${esc(meta.sourceLanguage.name)} forms in the glossary</span>
        <p class="rr-current__note" lang="${esc(meta.sourceLanguage.code)}">${esc(draft.existing.sourceTerms.join(", "))}</p>
      </div>`}
      <ul class="rr-current">${rows}</ul>
    </section>`;
}

function renderEntryCard(report, run, entry) {
  const draft = report.entryDrafts[entry.id];
  const counts = run.aggregate.entries[entry.id] ?? { occurrences: 0, passages: 0, variants: {}, other: 0, unresolved: {}, failed: 0, notRun: 0 };
  const meta = run.meta;
  const tgt = meta.targetLanguage.code;
  // With two judges every use is counted twice: the counts are votes.
  const judges = run.aggregate.totals?.judges ?? 1;
  const unit = judges > 1 ? "votes" : "uses";
  const uses = Math.round(counts.occurrences / judges);
  // Only an entry already in the glossary has a choice: the suggested update or the entry as it is.
  const hasCurrent = Boolean(draft.existingTermId && draft.existing);
  const showingCurrent = hasCurrent && draft.decision === "keep";
  const variantRows = draft.variants.map((variant, index) => {
    const key = `${entry.id}:${variant.id}`;
    const c = counts.variants[variant.id] ?? { occurrences: 0, passages: 0 };
    const neverChosen = !variant.include && c.occurrences === 0 && !variant.added;
    return `
      <div class="rr-variant${variant.include ? "" : " is-excluded"}">
        <input class="rr-variant__check" type="checkbox" aria-label="Include ${esc(variant.target)}" data-research-entry="${esc(entry.id)}:include:${index}" ${variant.include ? "checked" : ""} />
        <div class="rr-variant__main">
          <div class="rr-variant__head">
            <input class="rr-variant__target" type="text" lang="${esc(tgt)}" value="${esc(variant.target)}" placeholder="New translation" data-research-entry="${esc(entry.id)}:target:${index}" aria-label="Translation" />
            ${variant.fromExisting ? `<span class="rr-pill">in current entry</span>` : ""}
            ${neverChosen ? `<span class="rr-pill rr-pill--warn">never chosen</span>` : ""}
          </div>
          <textarea class="rr-variant__note" rows="1" lang="${esc(tgt)}" placeholder="When to use it" data-research-entry="${esc(entry.id)}:note:${index}" aria-label="Usage note for ${esc(variant.target)}">${esc(variant.note)}</textarea>
        </div>
        ${countCell(key, c.occurrences, counts.occurrences, c.passages, report.expandedVariants[key], unit)}
        ${renderVariantExamples(report, run, entry.id, variant.id, meta)}
      </div>`;
  }).join("");
  const unresolved = Object.values(counts.unresolved).reduce((a, b) => a + b, 0);
  const otherKey = `${entry.id}:__other`;
  const otherCount = counts.other + unresolved + (counts.failed ?? 0);
  const variantsLabel = entry.sourceTerms.slice(1);
  return `
    <article class="rr-entry">
      <header class="rr-entry__head">
        <div>
          <p class="rr-eyebrow">${entry.kind === "expression" ? "Expression" : "Entry"} · ${uses} uses in ${counts.passages} passages</p>
          <h2 class="rr-entry__title" lang="${esc(meta.sourceLanguage.code)}">${esc(entry.sourceTerms[0] ?? "")}</h2>
          ${variantsLabel.length ? `<p class="rr-entry__forms" lang="${esc(meta.sourceLanguage.code)}">${esc(variantsLabel.join(" · "))}</p>` : ""}
        </div>
        ${hasCurrent ? `
        <div class="rr-segmented" role="radiogroup" aria-label="Which version to show">
          ${[["update", "Suggested update"], ["keep", "Current glossary entry"]].map(([value, label]) => `
            <label class="rr-segmented__option${draft.decision === value ? " is-selected" : ""}">
              <input type="radio" name="decision-${esc(entry.id)}" data-action="set-research-entry-decision:${esc(entry.id)}:${value}" ${draft.decision === value ? "checked" : ""} />
              <span>${esc(label)}</span>
            </label>`).join("")}
        </div>` : ""}
      </header>
      ${draft.saveError ? `<p class="rr-alert" role="alert">${esc(draft.saveError)}</p>` : ""}
      ${draft.saveStatus === "saved" ? `<p class="rr-saved">Saved to the glossary</p>` : ""}
      ${showingCurrent ? renderCurrentEntry(run, draft, meta) : `
      <fieldset class="rr-entry__fields">
        <label class="rr-field">
          <span class="rr-field__label">Note for all translations (TMX)</span>
          <textarea class="field__input rr-autosize" rows="2" lang="${esc(tgt)}" data-research-entry="${esc(entry.id)}:generalNote">${esc(draft.generalNote)}</textarea>
        </label>
        <section class="rr-block">
          <div class="rr-table-head"><span>Translation and when to use it</span><span>Chosen in the sample</span></div>
          ${variantRows}
          <div class="rr-variant rr-variant--other">
            <span></span>
            <div class="rr-variant__main"><span class="rr-variant__label">None of these fit</span>
              <p class="rr-muted">The translator wrote something else${unresolved ? `; ${unresolved} not decided` : ""}${counts.failed ? `; ${counts.failed} failed` : ""}.</p></div>
            ${countCell(otherKey, otherCount, counts.occurrences, null, report.expandedVariants[otherKey], unit)}
            ${renderVariantExamples(report, run, entry.id, "__other", meta)}
          </div>
          <button class="rr-link rr-add" type="button" data-action="add-research-entry-variant:${esc(entry.id)}">+ Add a translation</button>
        </section>
      </fieldset>`}
    </article>`;
}

const ZIPF_WORDS = ["", "rare", "uncommon", "everyday", "common", "very common"];

/**
 * The stretch of the Zipf scale one chart needs: from just below its lowest
 * value to just above its highest, on whole numbers, at least two steps wide.
 */
export function zipfRange(values) {
  const known = values.filter((v) => Number.isFinite(v));
  if (!known.length) return { lo: 0, hi: 4 };
  let lo = Math.max(0, Math.floor(Math.min(...known) - 0.25));
  let hi = Math.ceil(Math.max(...known) + 0.25);
  if (hi - lo < 2) hi = lo + 2;
  return { lo, hi };
}

/** Whole-number ticks of a range, each with its plain word while there is room for the words. */
function zipfTicks({ lo, hi }) {
  const ticks = [];
  for (let z = Math.ceil(lo); z <= hi; z += 1) {
    const word = hi - lo <= 4 || z % 2 === 1 ? ZIPF_WORDS[z] ?? "" : "";
    ticks.push([z, word]);
  }
  return ticks;
}

/** Plain word for a Zipf score. */
function zipfWord(zipf) {
  if (zipf == null) return "";
  if (zipf < 1) return "almost never used";
  if (zipf < 2) return "rare";
  if (zipf < 3) return "uncommon";
  if (zipf < 4) return "an everyday word";
  if (zipf < 5) return "common";
  return "very common";
}

/** Where a score sits on a chart's range, as a CSS length. */
const placeOn = ({ lo, hi }) => (zipf) => `${((Math.max(lo, Math.min(hi, zipf ?? lo)) - lo) / (hi - lo)) * 100}%`;

/** The line under a translation: which word set its score, and anything else worth knowing. */
function scoredBy(c, tgt) {
  const own = c.words.filter((w) => !w.partOf);
  const parts = c.words.filter((w) => w.partOf);
  const word = (w) => `<span lang="${esc(tgt.code)}">${esc(w.word)}</span> ${formatZipf(w.zipf)}`;
  const rarest = own.reduce((best, w) => (w.zipf != null && (best == null || w.zipf < best.zipf) ? w : best), null);
  const lines = [];
  if (own.length > 1 && rarest) {
    const rest = own.filter((w) => w !== rarest);
    lines.push(`Scored by its rarest word, <span lang="${esc(tgt.code)}">${esc(rarest.word)}</span>${rest.length ? ` (also ${rest.map(word).join(", ")})` : ""}.`);
  }
  if (parts.length) lines.push(`Not counted, parts of a compound: ${parts.map(word).join(", ")}.`);
  for (const w of own) if (w.measure?.needed) lines.push(`<span lang="${esc(tgt.code)}">${esc(w.word)}</span> in the meaning needed: ${esc(describeSense(w.measure.needed))}.`);
  // Frequency reasons are what the chart shows; other findings stay as text.
  const other = [...c.reasons.filter((r) => !/^much less known than/.test(r)), ...c.notes];
  for (const text of other) lines.push(esc(text));
  if (c.clashes.length) lines.push(`Already used in the glossary for ${esc(c.clashes.map((x) => x.sourceTerms.join(" / ")).join("; "))}.`);
  return lines.length ? `<span class="rr-scale__detail">${lines.join(" ")}</span>` : "";
}

/** One meaning of the source word: its score in general use, the minimum, and its translations on one scale. */
function renderMeaning(sense, index, measure, candidates, src, tgt, meta) {
  const term = `<strong lang="${esc(src.code)}">${esc(meta.term)}</strong>`;
  const measured = measure?.zipf != null;
  const minimum = measured ? Math.max(0, measure.zipf - 1) : null;
  const rule = !measure ? `This meaning was not measured in general ${esc(src.name)}, so its translations are not held to a minimum.`
    : measured
      ? `In general ${esc(src.name)}, ${term} in this meaning scores <strong>${formatZipf(measure.zipf)}</strong>, ${zipfWord(measure.zipf)} (${measure.inSense} of the ${measure.classified} sentences we sorted use it). A translation should score at least <strong>${formatZipf(minimum)}</strong>.`
      : `None of the ${measure.classified} general ${esc(src.name)} sentences we sorted use this meaning, so we can't tell how common it is (below ${formatZipf(measure.upperBound)}). Its translations are not held to a minimum.`;
  const range = zipfRange([...candidates.map((c) => c.zipf), measured ? measure.zipf : null, minimum]);
  const at = placeOn(range);
  const verdict = (c) => c.verdict === "fail"
    ? (c.reasons.some((r) => /^much less known than/.test(r)) ? ["too rare", "fail"] : ["fails", "fail"])
    : c.verdict === "pass" ? ["passes", "pass"] : [c.verdict === "unclear" ? "unclear" : "not checked", "unclear"];
  const rows = [...candidates].sort((a, b) => (b.zipf ?? -1) - (a.zipf ?? -1)).map((c) => {
    const [label, kind] = verdict(c);
    const absent = c.zipf != null && c.zipf <= 0;
    return `
      <div class="rr-scale__row">
      <div class="rr-scale__label">
        <strong lang="${esc(tgt.code)}">${esc(c.target)}</strong>
        ${scoredBy(c, tgt)}
      </div>
      <div class="rr-scale__plot" title="${esc(`${c.target}: ${formatZipf(c.zipf)}${measured ? `, minimum ${formatZipf(minimum)}` : ""}`)}">
        <span class="rr-scale__bar rr-scale__bar--${kind}" style="width:${at(c.zipf)}"></span>
        <span class="rr-scale__value" style="left:${at(c.zipf)}">${c.zipf == null ? "no score" : formatZipf(c.zipf)}${absent ? ` · not found in general ${esc(tgt.name)}` : ""}</span>
      </div>
      <div class="rr-scale__result"><span class="rr-pill rr-pill--${kind === "pass" ? "ok" : kind === "fail" ? "bad" : "warn"}">${label}</span></div>
      </div>`;
  }).join("");
  return `
    <div class="rr-meaning">
      <div class="rr-meaning__head">
        <h3>Meaning ${index + 1}</h3>
        ${sense.usedByAuthor ? '<span class="rr-pill">used by the author</span>' : ""}
      </div>
      <p class="rr-meaning__gloss">${esc(sense.gloss)}</p>
      <p class="rr-meaning__rule">${rule}</p>
      ${candidates.length ? `
        <div class="rr-scale${measured ? "" : " rr-scale--open"}" role="group" aria-label="${esc(tgt.name)} translations of meaning ${index + 1} on the Zipf scale">
          <div class="rr-scale__overlay" aria-hidden="true">
            ${measured ? `<span class="rr-scale__zone" style="width:${at(minimum)}"><span>too rare</span></span>
            <span class="rr-scale__ref" style="left:${at(measure.zipf)}"><span>${esc(meta.term)} ${formatZipf(measure.zipf)}</span></span>` : ""}
          </div>
          <div class="rr-scale__row rr-scale__row--axis" aria-hidden="true">
            <span></span>
            <div class="rr-scale__axis">
              ${zipfTicks(range).map(([z, word]) => `<span style="left:${at(z)}"><b>${z}</b>${esc(word)}</span>`).join("")}
            </div>
            <span></span>
          </div>
          ${rows}
        </div>` : ""}
    </div>`;
}

/** Word family, parts, and the frequency check meaning by meaning. */
function renderFrequency(run) {
  const meta = run.meta;
  const src = meta.sourceLanguage;
  const tgt = meta.targetLanguage;
  const family = run.family?.members ?? [];
  const parts = run.parts;
  const checks = run.checks;
  if (!family.length && !parts && !checks) return "";
  const source = parts?.source;
  const removed = (run.confirmedProposal ?? run.proposal)?.removedByChecks ?? [];
  const notes = run.footnotes ?? [];
  const senses = parts?.study?.senses ?? [];
  const candidates = checks?.candidates ?? [];
  const forms = (source?.forms ?? []).filter((f) => f && typeof f === "object");
  const withTranslations = senses.filter((sense) => candidates.some((c) => c.senseId === sense.id));
  const without = senses.filter((sense) => !candidates.some((c) => c.senseId === sense.id));
  const orphan = candidates.filter((c) => !senses.some((sense) => sense.id === c.senseId));
  return `
    <section class="rr-section">
      <h2>How common the translations are</h2>
      <div class="rr-explainer">
        <p>A translation should be about as familiar to ${esc(tgt.name)} readers as the ${esc(src.name)} word is to ${esc(src.name)} readers, in the meaning it translates. Familiarity is measured on the <strong>Zipf scale</strong>: how often a word turns up in everyday writing. Each step up means ten times as often; about 3 is an everyday word.</p>
        <p>A translation may be at most <strong>one step rarer</strong> than the ${esc(src.name)} word. In the charts below, the thin vertical line marks the ${esc(src.name)} word and the shaded area is too rare.</p>
      </div>
      ${source ? `
        <p class="rr-source-line">${term(meta, src)} in general ${esc(src.name)}, all meanings together: <strong>${formatZipf(source.wordZipf)}</strong>, ${zipfWord(source.wordZipf)}${forms.length > 1 ? ` (${forms.map((f) => `<span lang="${esc(src.code)}">${esc(f.form)}</span> ${formatZipf(f.zipf)}`).join(" + ")}, counted together)` : ""}.${source.invented ? " It is not in the dictionary and is practically absent from general use: the author's own word." : ""}
          ${source.term?.classified ? ` To split this by meaning, ${source.term.classified} sentences containing it were sorted.` : ""}</p>
        ${source.bases.map((base) => `<p class="rr-muted">Base word <span lang="${esc(src.code)}">${esc(base.word)}</span>: ${formatZipf(base.measure.wordZipf)}; in the meaning “${esc(base.neededSense)}”: ${esc(describeSense(base.needed))}.</p>`).join("")}
        ${withTranslations.map((sense) => renderMeaning(sense, senses.indexOf(sense), source.term.senses[sense.id], candidates.filter((c) => c.senseId === sense.id), src, tgt, meta)).join("")}
        ${orphan.length ? renderMeaning({ gloss: "Translations not tied to one of the meanings above" }, senses.length, null, orphan, src, tgt, meta) : ""}
        ${without.length ? `<p class="rr-muted rr-meaning__none">No translation was proposed for ${without.map((sense) => `meaning ${senses.indexOf(sense) + 1} (${esc(sense.gloss)})`).join("; ")}.</p>` : ""}` : parts ? `<p>No ${esc(src.name)} frequency data was available.</p>` : ""}
      ${parts?.study?.parts?.length ? `<p class="rr-muted">Parts of ${esc(meta.term)}: ${parts.study.parts.map((p) => `<span lang="${esc(src.code)}">${esc(p.part)}</span> (${esc(p.meaning)})`).join(" + ")}</p>` : ""}
      ${family.length ? `<p class="rr-muted">Word family in the texts: ${family.map((m) => `<span lang="${esc(src.code)}">${esc(m.form)}</span> (${m.rows})`).join(", ")}</p>` : ""}
      ${removed.length ? `<p>Removed from the proposal by the checks: ${removed.map((r) => `<span lang="${esc(tgt.code)}">${esc(r.target)}</span>`).join(", ")}.</p>` : ""}
      ${checks?.failedWords?.length ? `<p>Words to look for in finished ${esc(tgt.name)} translations (any word containing them): ${checks.failedWords.map((w) => `<strong lang="${esc(tgt.code)}">${esc(w)}</strong>`).join(", ")}.</p>` : ""}
      ${(run.aggregate?.otherRenderings ?? []).some((o) => o.failedWord) ? `<p>Judges' own renderings that contain a word whose check failed: ${run.aggregate.otherRenderings.filter((o) => o.failedWord).map((o) => `<span lang="${esc(tgt.code)}">${esc(o.rendering)}</span> (${o.n})`).join(", ")}.</p>` : ""}
      ${notes.length ? `<h3>Translator's notes proposed for rare translations</h3><ul>${notes.map((n) => `<li><strong lang="${esc(tgt.code)}">${esc(n.target)}</strong> (Zipf ${formatZipf(n.zipf)}): <span lang="${esc(tgt.code)}">${esc(n.note)}</span></li>`).join("")}</ul>` : ""}
    </section>`;
}

function term(meta, src) {
  return `<strong lang="${esc(src.code)}">${esc(meta.term)}</strong>`;
}

function renderConvergence(run) {
  const pairs = run.convergence?.pairs ?? [];
  if (!pairs.length) return "";
  const src = run.meta.sourceLanguage;
  const tgt = run.meta.targetLanguage;
  const verdict = { same: "same meaning here: sharing is fine", different: "different meanings: taken out of the proposal", unknown: "not judged" };
  return `
    <section class="rr-section">
      <h2>Translations shared with other words</h2>
      <p class="rr-muted">Two words may share a translation when they mean the same in these texts; if both stand in one sentence, the translator says it once. When they mean different things, the shared translation would merge them.</p>
      <ul>
        ${pairs.map((p) => `<li><strong lang="${esc(tgt.code)}">${esc(p.target)}</strong> for <span lang="${esc(src.code)}">${esc(p.sourceTerms[0])}</span> and <span lang="${esc(src.code)}">${esc(p.otherSourceTerms[0])}</span>: ${esc(verdict[p.relation] ?? p.relation)}
          <br><span class="muted">${p.evidence?.passages ?? 0} sampled passages with both${p.evidence?.sameSentence ? `, ${p.evidence.sameSentence} in one sentence` : ""}${p.reason ? `. ${esc(p.reason)}` : ""}</span></li>`).join("")}
      </ul>
    </section>`;
}

function renderSecondary(run, report) {
  const meta = run.meta;
  const totals = run.aggregate.totals;
  const proposal = run.confirmedProposal ?? run.proposal ?? {};
  const list = (title, items, map) => items?.length ? `<h3>${esc(title)}</h3><ul>${items.map(map).join("")}</ul>` : "";
  const usage = run.usage ?? [];
  const cost = usage.reduce((sum, record) => sum + (record.costUsd ?? 0), 0);
  const dictionary = run.dictionary ?? {};
  const methodOpen = report?.expandedVariants?.__method === true;
  const study = run.sources?.study;
  const origins = study?.senses?.filter((sense) => !sense.inDictionary) ?? [];
  const sources = study ? `
    <section class="rr-section">
      <h2>Where the term comes from</h2>
      <p>${esc(study.summary)}</p>
      ${origins.map((sense) => `
        <h3>${esc(sense.sense)}</h3>
        <ul>
          ${sense.sourceBook ? `<li>Source: ${esc(sense.sourceBook)}${sense.originalTerm ? ` — original ${esc(sense.originalLanguage ?? "")} term “${esc(sense.originalTerm)}” (${esc(sense.originalTermBasis)})` : ""}</li>` : ""}
          <li>Meaning there: ${esc(sense.meaningInSource)}</li>
          ${sense.meaningInOriginal ? `<li>In the original text: ${esc(sense.meaningInOriginal)}</li>` : ""}
          <li>How the author uses it: ${esc(sense.authorUsage)}</li>
          ${sense.equivalences?.length ? `<li>Equated with: ${sense.equivalences.map((e) => `${esc(e.term)} (${esc(e.relation)})`).join(", ")}</li>` : ""}
        </ul>`).join("")}
    </section>` : "";
  return `
    ${sources}
    ${renderFrequency(run)}
    ${renderConvergence(run)}
    ${run.prose ? `<section class="rr-section"><h2>Summary</h2><p>${esc(run.prose.summary)}</p>
      ${run.prose.recommendations?.length ? `<ul>${run.prose.recommendations.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}</section>` : ""}
    ${[proposal.derivativeStudies, proposal.rejectedExpressions, proposal.sensesOutsideDictionary, proposal.openQuestions].some((items) => items?.length) ? `
    <section class="rr-section">
      <h2>Further questions</h2>
      ${list("Suggested separate studies", proposal.derivativeStudies, (d) => `<li><span lang="${esc(meta.sourceLanguage.code)}">${esc(d.source)}</span> — ${esc(d.reason)}</li>`)}
      ${list("Recurring combinations without their own entry", proposal.rejectedExpressions, (d) => `<li><span lang="${esc(meta.sourceLanguage.code)}">${esc(d.source)}</span> — ${esc(d.reason)}</li>`)}
      ${list("Senses outside the dictionary", proposal.sensesOutsideDictionary, (d) => `<li>${esc(d.gloss)} — ${esc(d.evidence)}</li>`)}
      ${list("Open questions", proposal.openQuestions, (q) => `<li>${esc(q)}</li>`)}
    </section>` : ""}
    <section class="rr-section rr-section--fold">
      <h2 class="rr-fold__heading">
        <button type="button" class="rr-fold__toggle collapse-affordance" data-action="toggle-research-examples:__method" aria-expanded="${methodOpen ? "true" : "false"}">
          ${renderCollapseChevron(methodOpen)}<span>How this was measured</span>
        </button>
      </h2>
      ${methodOpen ? `
      <div class="rr-fold__body">
      <h3>Method</h3>
      <p>Counts show which proposed translation was judged most appropriate in each sampled context. They measure contextual preference, not frequency in ${esc(meta.targetLanguage.name)} or exclusive correctness.</p>
      <ul>
        <li>Texts: ${meta.sourceMode === "samael" ? "complete works of Samael Aun Weor" : "selected team projects"}; ${totals.populationDistinct} distinct passages (${totals.populationRows} before merging ${totals.duplicateGroups} groups of identical passages).</li>
        <li>Sample: ${totals.passagesSampled} passages (${totals.sampleRequested} requested), ${totals.occurrencesSampled} occurrences; seed ${esc(meta.seed)}. The translations and notes were fixed (version ${esc(run.frozen.version)}) before counting.</li>
        ${totals.judges === 2 ? `<li>Two judges translated every occurrence independently, each seeing the translations in a different order; the counts are their ${totals.votes} votes. They agreed on ${totals.agreement.agreed} of ${totals.agreement.compared} occurrences.</li>` : ""}
        <li>Each occurrence's sentence was translated, then the translation it used was identified. Model: ${esc(meta.modelId)}.</li>
              </ul>
      <h3>Dictionary</h3>
      ${dictionary.status === "found" ? `<p class="muted">${esc(dictionary.sourceName)}${dictionary.url ? ` — ${esc(dictionary.url)}` : ""}</p><pre class="research-dictionary" lang="${esc(meta.sourceLanguage.code)}">${esc(dictionary.text)}</pre>` : `<p>No dictionary entry was found (${esc((dictionary.tried ?? []).join(", "))}).</p>`}
      ${(dictionary.notes ?? []).map((note) => `<p>${esc(note)}</p>`).join("")}
      <h3>Cost</h3>
      <p>${usage.length} AI requests, US${formatUsd(cost)} (limit US${formatUsd(meta.spendingLimitUsd)}).</p>
      </div>` : ""}
    </section>`;
}

/** One Save for the whole report: every entry not set to keep the current one. */
function renderSaveButton(report) {
  const drafts = Object.values(report.entryDrafts ?? {});
  const pending = drafts.filter((draft) => draft.decision !== "keep" && draft.saveStatus !== "saved");
  const saving = drafts.some((draft) => draft.saveStatus === "saving");
  const label = saving ? "Saving…" : !pending.length && drafts.some((draft) => draft.saveStatus === "saved") ? "Saved" : "Save to glossary";
  return primaryButton(label, "save-research-report", { disabled: saving || !pending.length });
}

export function renderGlossaryResearchReportScreen(state) {
  const report = state.glossaryResearchReport;
  const navButtons = [actionNavButton("Glossary", "close-research-report", false, { isBack: true })];
  let body;
  let title = "Research report";
  if (report.status === "loading") {
    body = renderStateCard({ eyebrow: "RESEARCH", title: "Loading the report…" });
  } else if (report.status === "error") {
    body = renderStateCard({ eyebrow: "RESEARCH", title: "Could not open this report.", subtitle: report.error, tone: "error" });
  } else if (report.run) {
    const run = report.run;
    title = `Research: ${run.meta.term} → ${run.meta.targetLanguage.name}`;
    body = `
      <section class="rr">
        ${report.copyNotice ? `<p class="rr-muted">${esc(report.copyNotice)}</p>` : ""}
        ${run.frozen.entries.map((entry) => renderEntryCard(report, run, entry)).join("")}
        ${renderSecondary(run, report)}
      </section>`;
  } else {
    body = "";
  }
  return pageShell({
    title,
    navButtons,
    tools: report.run ? `<div class="rr-tools">${secondaryButton("Copy for AI discussion", "copy-research-markdown")}${renderSaveButton(report)}</div>` : "",
    body,
  });
}
