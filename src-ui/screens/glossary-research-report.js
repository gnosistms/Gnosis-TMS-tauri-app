import {
  actionNavButton,
  escapeHtml,
  pageShell,
  primaryButton,
  renderStateCard,
  secondaryButton,
} from "../lib/ui.js";
import { formatUsd } from "../app/glossary-research-budget.js";

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
  return `
    <div class="research-example">
      <p class="research-example__source" lang="${esc(sourceCode)}">${sourceExcerpt(item, occurrence)}</p>
      ${judgment.sentenceTranslation ? `
        <p class="research-example__translation"><span class="research-tag">translated sentence, not the full passage</span>
          <span lang="${esc(targetCode)}">${highlightWording(judgment.sentenceTranslation, judgment.chosenWording)}</span></p>` : ""}
      <div class="research-example__meta">Source: ${reference(item)} · ${esc(occurrence.occId)}${judgment.fit ? ` · fit: ${esc(judgment.fit)}` : ""}${judgment.note ? ` — ${esc(judgment.note)}` : ""}</div>
    </div>`;
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
  if (!matching.length) return `<div class="research-examples"><p class="muted">No sampled occurrence chose this translation.</p></div>`;
  const shown = report.showAllExamples[key] ? translated : translated.slice(0, EXAMPLES_SHOWN);
  return `
    <div class="research-examples">
      <p class="muted">${translated.length} translated example${translated.length === 1 ? "" : "s"} saved for ${matching.length} occurrence${matching.length === 1 ? "" : "s"}.</p>
      ${shown.map((occurrence) => renderExample(run, occurrence, judgments[occurrence.occId], meta.targetLanguage.code, meta.sourceLanguage.code)).join("")}
      ${translated.length > shown.length ? `<button type="button" class="button button--secondary button--compact" data-action="show-all-research-examples:${esc(key)}">Show more (${translated.length - shown.length})</button>` : ""}
    </div>`;
}

function renderEntryCard(report, run, entry) {
  const draft = report.entryDrafts[entry.id];
  const counts = run.aggregate.entries[entry.id] ?? { occurrences: 0, passages: 0, variants: {}, other: 0, unresolved: {}, failed: 0, notRun: 0 };
  const meta = run.meta;
  const total = counts.occurrences || 1;
  const decisionOptions = draft.existingTermId
    ? [["update", "Update existing entry"], ["keep", "Keep existing"]]
    : [["add", "Add to glossary"], ["keep", "Don't add"]];
  const variantRows = draft.variants.map((variant, index) => {
    const key = `${entry.id}:${variant.id}`;
    const c = counts.variants[variant.id] ?? { occurrences: 0, passages: 0 };
    const pct = Math.round((100 * c.occurrences) / total);
    return `
      <div class="research-variant${variant.include ? "" : " is-excluded"}">
        <div class="research-variant__row">
          <input type="checkbox" aria-label="Include this translation" data-research-entry="${esc(entry.id)}:include:${index}" ${variant.include ? "checked" : ""} />
          <input class="field__input research-variant__target" type="text" lang="${esc(meta.targetLanguage.code)}" value="${esc(variant.target)}" data-research-entry="${esc(entry.id)}:target:${index}" aria-label="Translation" />
          <button type="button" class="research-variant__count" data-action="toggle-research-examples:${esc(key)}" aria-expanded="${report.expandedVariants[key] ? "true" : "false"}">
            ${c.occurrences} of ${counts.occurrences} · ${c.passages} passages <span class="research-bar"><span style="width:${pct}%"></span></span>
          </button>
        </div>
        <textarea class="field__input research-variant__note" rows="2" lang="${esc(meta.targetLanguage.code)}" data-research-entry="${esc(entry.id)}:note:${index}" aria-label="Usage note (TMX)">${esc(variant.note)}</textarea>
        ${variant.fromExisting ? `<span class="research-tag research-tag--existing">in the existing entry</span>` : ""}
        ${!variant.include && c.occurrences === 0 && !variant.added ? `<span class="research-tag research-tag--warn">never chosen in the sample — proposed for removal</span>` : ""}
        ${renderVariantExamples(report, run, entry.id, variant.id, meta)}
      </div>`;
  }).join("");
  const unresolved = Object.values(counts.unresolved).reduce((a, b) => a + b, 0);
  const otherKey = `${entry.id}:__other`;
  const existing = draft.existing ? `
    <div class="research-existing-box">
      <div class="research-existing-box__title">Existing entry</div>
      <div><strong>${esc(draft.existing.sourceTerms.join(" / "))}</strong> → ${esc(draft.existing.targetTerms.join(", "))}</div>
      ${draft.existing.notesToTranslators ? `<div class="muted">${esc(draft.existing.notesToTranslators)}</div>` : ""}
    </div>` : "";
  return `
    <section class="card research-entry">
      <header class="research-entry__head">
        <h3>${entry.kind === "expression" ? "Expression entry" : "Entry"}: <span lang="${esc(meta.sourceLanguage.code)}">${esc(entry.sourceTerms.join(" / "))}</span></h3>
        <span class="muted">${counts.occurrences} occurrences in ${counts.passages} passages</span>
      </header>
      ${existing}
      <div class="research-decision" role="radiogroup" aria-label="What to do with this entry">
        ${decisionOptions.map(([value, label]) => `
          <label class="research-radio"><input type="radio" name="decision-${esc(entry.id)}" data-action="set-research-entry-decision:${esc(entry.id)}:${value}" ${draft.decision === value ? "checked" : ""} /> <span>${esc(label)}</span></label>`).join("")}
      </div>
      <fieldset class="research-entry__fields" ${draft.decision === "keep" ? "disabled" : ""}>
        <label class="field">
          <span class="field__label">Source terms (${esc(meta.sourceLanguage.name)})</span>
          <input class="field__input" type="text" value="${esc(draft.sourceTerms.join(", "))}" data-research-entry="${esc(entry.id)}:sourceTerms" />
        </label>
        <label class="field">
          <span class="field__label">General translation guidance (TMX, ${esc(meta.targetLanguage.name)})</span>
          <textarea class="field__input" rows="2" lang="${esc(meta.targetLanguage.code)}" data-research-entry="${esc(entry.id)}:generalNote">${esc(draft.generalNote)}</textarea>
        </label>
        <div class="research-variants-list">${variantRows}</div>
        <div class="research-add-variant">
          <button class="term-lane__add-button" type="button" data-action="add-research-entry-variant:${esc(entry.id)}" aria-label="Add translation"><span class="term-lane__add-icon" aria-hidden="true"></span></button>
          <span class="research-add-variant__label">add translation</span>
        </div>
      </fieldset>
      <div class="research-entry__other">
        <button type="button" class="text-action" data-action="toggle-research-examples:${esc(otherKey)}">Other / none fits: ${counts.other} · unresolved: ${unresolved}${counts.failed ? ` · failed: ${counts.failed}` : ""}</button>
        ${renderVariantExamples(report, run, entry.id, "__other", meta)}
      </div>
      <footer class="research-entry__foot">
        ${draft.saveError ? `<span class="form-error" role="alert">${esc(draft.saveError)}</span>` : ""}
        ${draft.saveStatus === "saved" ? `<span class="research-saved">Saved to the glossary</span>` : ""}
        ${draft.decision === "keep" ? "" : primaryButton(draft.saveStatus === "saving" ? "Saving…" : draft.existingTermId ? "Save update" : "Save to glossary", `save-research-entry:${entry.id}`, { disabled: draft.saveStatus === "saving" })}
      </footer>
    </section>`;
}

function renderSecondary(run) {
  const meta = run.meta;
  const totals = run.aggregate.totals;
  const proposal = run.confirmedProposal ?? run.proposal ?? {};
  const list = (title, items, map) => items?.length ? `<h3>${esc(title)}</h3><ul>${items.map(map).join("")}</ul>` : "";
  const usage = run.usage ?? [];
  const cost = usage.reduce((sum, record) => sum + (record.costUsd ?? 0), 0);
  const dictionary = run.dictionary ?? {};
  return `
    ${run.prose ? `<section class="card research-section"><h2>Summary</h2><p>${esc(run.prose.summary)}</p>
      ${run.prose.recommendations?.length ? `<ul>${run.prose.recommendations.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}</section>` : ""}
    <section class="card research-section">
      ${list("Suggested separate studies", proposal.derivativeStudies, (d) => `<li><span lang="${esc(meta.sourceLanguage.code)}">${esc(d.source)}</span> — ${esc(d.reason)}</li>`)}
      ${list("Recurring combinations without their own entry", proposal.rejectedExpressions, (d) => `<li><span lang="${esc(meta.sourceLanguage.code)}">${esc(d.source)}</span> — ${esc(d.reason)}</li>`)}
      ${list("Senses outside the dictionary", proposal.sensesOutsideDictionary, (d) => `<li>${esc(d.gloss)} — ${esc(d.evidence)}</li>`)}
      ${list("Open questions", proposal.openQuestions, (q) => `<li>${esc(q)}</li>`)}
      <h2>Method</h2>
      <p>Counts show which proposed translation was judged most appropriate in each sampled context. They measure contextual preference, not frequency in ${esc(meta.targetLanguage.name)} or exclusive correctness.</p>
      <ul>
        <li>Texts: ${meta.sourceMode === "samael" ? "complete works of Samael Aun Weor" : "selected team projects"}; ${totals.populationDistinct} distinct passages (${totals.populationRows} before merging ${totals.duplicateGroups} groups of identical passages).</li>
        <li>Sample: ${totals.passagesSampled} passages (${totals.sampleRequested} requested), ${totals.occurrencesSampled} occurrences; seed ${esc(meta.seed)}. The translations and notes were fixed (version ${esc(run.frozen.version)}) before counting.</li>
        <li>Each occurrence's sentence was translated, then the translation it used was identified. Model: ${esc(meta.modelId)}.</li>
        <li>Outcomes: ${esc(JSON.stringify(totals.outcomes))}</li>
      </ul>
      <h2>Dictionary</h2>
      ${dictionary.status === "found" ? `<p class="muted">${esc(dictionary.sourceName)}${dictionary.url ? ` — ${esc(dictionary.url)}` : ""}</p><pre class="research-dictionary" lang="${esc(meta.sourceLanguage.code)}">${esc(dictionary.text)}</pre>` : `<p>No dictionary entry was found (${esc((dictionary.tried ?? []).join(", "))}).</p>`}
      ${(dictionary.notes ?? []).map((note) => `<p>${esc(note)}</p>`).join("")}
      <h2>Cost</h2>
      <p>${usage.length} AI requests, US${formatUsd(cost)} (limit US${formatUsd(meta.spendingLimitUsd)}).</p>
    </section>`;
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
      <section class="stack research-report">
        <p class="research-report__banner">Nothing is written to the glossary until you save an entry. ${run.aggregate.totals.passagesSampled} passages, ${run.aggregate.totals.occurrencesSampled} occurrences sampled.</p>
        ${run.frozen.entries.map((entry) => renderEntryCard(report, run, entry)).join("")}
        ${renderSecondary(run)}
        ${report.copyNotice ? `<p class="muted">${esc(report.copyNotice)}</p>` : ""}
      </section>`;
  } else {
    body = "";
  }
  return pageShell({
    title,
    navButtons,
    tools: report.run ? secondaryButton("Copy for AI discussion", "copy-research-markdown") : "",
    body,
  });
}
