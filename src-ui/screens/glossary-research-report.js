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
      <div class="rr-field">
        <span class="rr-field__label">${esc(meta.sourceLanguage.name)} forms in this entry</span>
        <p class="rr-current__note" lang="${esc(meta.sourceLanguage.code)}">${esc(draft.existing.sourceTerms.join(", "))}</p>
      </div>
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
        <section class="rr-block rr-grid-2">
          <label class="rr-field">
            <span class="rr-field__label">Note for all translations (TMX)</span>
            <textarea class="field__input rr-autosize" rows="2" lang="${esc(tgt)}" data-research-entry="${esc(entry.id)}:generalNote">${esc(draft.generalNote)}</textarea>
          </label>
          <label class="rr-field">
            <span class="rr-field__label">${esc(meta.sourceLanguage.name)} forms in this entry</span>
            <input class="field__input" type="text" value="${esc(draft.sourceTerms.join(", "))}" data-research-entry="${esc(entry.id)}:sourceTerms" />
          </label>
        </section>
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

/** Word family, parts, sense frequencies and the candidate checks. */
function renderFrequency(run) {
  const meta = run.meta;
  const src = meta.sourceLanguage;
  const tgt = meta.targetLanguage;
  const family = run.family?.members ?? [];
  const parts = run.parts;
  const checks = run.checks;
  if (!family.length && !parts && !checks) return "";
  const source = parts?.source;
  const verdictLabel = { pass: "passes", fail: "fails", unclear: "unclear", unchecked: "not checked" };
  const removed = (run.confirmedProposal ?? run.proposal)?.removedByChecks ?? [];
  const notes = run.footnotes ?? [];
  return `
    <section class="rr-section">
      <h2>Parts and frequency</h2>
      <p class="rr-muted">Zipf scores: 0 = not in ordinary use, about 3 = an everyday word, 5+ = very common. A sense's score is the word's score reduced by the share of general-corpus sentences that use the word in that sense.</p>
      ${parts?.study ? `<p>Parts: ${parts.study.parts.map((p) => `<span lang="${esc(src.code)}">${esc(p.part)}</span> (${esc(p.meaning)})`).join(" + ")}</p>` : ""}
      ${source ? `
        <ul>
          <li><span lang="${esc(src.code)}">${esc(meta.term)}</span>: Zipf ${formatZipf(source.wordZipf)}${source.invented ? " — not in the dictionary and practically absent from general use: the author's own word" : ""}</li>
          ${parts.study.senses.map((sense) => `<li>${esc(sense.gloss)}${sense.usedByAuthor ? " (used by the author)" : ""}: ${esc(describeSense(source.term.senses[sense.id]))}</li>`).join("")}
          ${source.bases.map((base) => `<li><span lang="${esc(src.code)}">${esc(base.word)}</span>: Zipf ${formatZipf(base.measure.wordZipf)}; in the sense “${esc(base.neededSense)}”: ${esc(describeSense(base.needed))}</li>`).join("")}
        </ul>` : parts ? `<p>No ${esc(src.name)} frequency data was available.</p>` : ""}
      ${family.length ? `<h3>Word family in the texts</h3><p>${family.map((m) => `<span lang="${esc(src.code)}">${esc(m.form)}</span> (${m.rows})`).join(", ")}</p>` : ""}
      ${checks?.candidates?.length ? `
        <h3>Candidate checks in general ${esc(tgt.name)}</h3>
        <table class="rr-checks">
          <thead><tr><th>Translation</th><th>Result</th><th>Words and their Zipf scores</th></tr></thead>
          <tbody>
          ${checks.candidates.map((c) => `<tr>
            <td><strong lang="${esc(tgt.code)}">${esc(c.target)}</strong></td>
            <td><span class="rr-pill${c.verdict === "pass" ? " rr-pill--ok" : c.verdict === "fail" ? " rr-pill--warn" : ""}">${esc(verdictLabel[c.verdict] ?? c.verdict)}</span></td>
            <td>${c.words.map((w) => `<span lang="${esc(tgt.code)}">${esc(w.word)}</span> ${formatZipf(w.zipf)}${w.measure?.needed ? `, in the sense needed ${esc(describeSense(w.measure.needed))}` : ""}`).join(" · ")}
              ${[...c.reasons, ...c.notes].length ? `<div class="rr-muted">${esc([...c.reasons, ...c.notes].join("; "))}</div>` : ""}
              ${c.clashes.length ? `<div class="rr-muted">Already used in the glossary for: ${esc(c.clashes.map((x) => x.sourceTerms.join(" / ")).join("; "))}</div>` : ""}</td>
          </tr>`).join("")}
          </tbody>
        </table>` : ""}
      ${removed.length ? `<p>Removed from the proposal by the checks: ${removed.map((r) => `<span lang="${esc(tgt.code)}">${esc(r.target)}</span>`).join(", ")}.</p>` : ""}
      ${checks?.failedWords?.length ? `<p>Words to look for in finished ${esc(tgt.name)} translations (any word containing them): ${checks.failedWords.map((w) => `<strong lang="${esc(tgt.code)}">${esc(w)}</strong>`).join(", ")}.</p>` : ""}
      ${(run.aggregate?.otherRenderings ?? []).some((o) => o.failedWord) ? `<p>Judges' own renderings that contain a word whose check failed: ${run.aggregate.otherRenderings.filter((o) => o.failedWord).map((o) => `<span lang="${esc(tgt.code)}">${esc(o.rendering)}</span> (${o.n})`).join(", ")}.</p>` : ""}
      ${notes.length ? `<h3>Translator's notes proposed for rare translations</h3><ul>${notes.map((n) => `<li><strong lang="${esc(tgt.code)}">${esc(n.target)}</strong> (Zipf ${formatZipf(n.zipf)}): <span lang="${esc(tgt.code)}">${esc(n.note)}</span></li>`).join("")}</ul>` : ""}
    </section>`;
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
