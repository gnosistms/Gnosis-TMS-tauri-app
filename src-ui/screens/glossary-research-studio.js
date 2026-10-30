import { studioActivityItems } from "../app/glossary-research-studio-activity.js";
import { studioResultPresentation, studioNarrativeText } from "../app/glossary-research-studio-result.js";
import { escapeHtml, primaryButton, secondaryButton, errorButton, actionNavButton, pageShell, loadingSpinner } from "../lib/ui.js";
import { renderGlossaryTermEditorModal } from "./glossary-term-editor-modal.js";
import { studioView, studioCanVisitStep } from "../app/glossary-research-studio-flow.js";
import { STUDIO_STEPS, STUDIO_DICTIONARY_REVIEW_VERSION, activeMeanings, meaningNumber, studioTrialRoundLabel, sourceCollisions, selectedForms, uniqueTexts, witnessedSplitForms, reviewCompoundReport, buildStudioDraft, stableSignature, studioSourceContext, studioContextRequest, meaningTrialSignature, meaningTrialsAreCurrent, entryBatchSignature, entryTrialsAreCurrent, studioStepNumber, studioStepStatusLabel,
  currentStudioFinding, studioReviewOverride } from "../app/glossary-research-studio-workflow.js";
import { studioGlossaryEntries } from "../app/glossary-research-studio-query.js";
import { studyAssignments } from "../app/glossary-research-studio-testing.js";
import { currentStudioRecommendation, sourceSummaryMustBeSkipped, studioCanRecommendSkip, studioFormsResearchStarted, studioResearchStarted } from "../app/glossary-research-studio-recommendations.js";

const e = (value) => escapeHtml(value ?? "");
const narrative = (value) => e(studioNarrativeText(value));
const quantity = (value, noun) => `${value} ${noun}${value === 1 ? "" : "s"}`;
const button = (label, name, options) => secondaryButton(label, `studio:${name}`, options);
const field = (label, path, value, options = {}) => `<label class="field"><span class="field__label">${e(label)}</span>
  ${options.textarea ? `<textarea class="field__textarea" rows="${options.rows ?? 3}" data-studio-field="${e(path)}" ${options.sharedNote ? `data-studio-shared-note="${e(options.sharedNote)}"` : ""} ${options.disabled ? "disabled" : ""}>${e(value)}</textarea>`
    : `<input class="field__input" data-studio-field="${e(path)}" type="${options.type ?? "text"}" value="${e(value)}" ${options.disabled ? "disabled" : ""}>`}</label>`;
const check = (label, path, checked, disabled = false, attributes = "") => `<label class="field__checkbox studio-check"><input type="checkbox" data-studio-field="${e(path)}" ${attributes} ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>${e(label)}</label>`;
function sourceSpellingNotice(assignments) {
  const count = assignments.filter((assignment) => assignment.preserveSourceSpelling).length;
  return count ? `<p>${count} ${count === 1 ? "occurrence retains" : "occurrences retain"} the original source spelling by human choice. These mentions are tested in context and excluded from target-variant usage counts.</p>` : "";
}
const meaningReferences = (text, study) => String(text ?? "").replace(/\bm\d+\b/gu,
  (id) => study.meanings.some((m) => m.id === id) ? `Meaning ${meaningNumber(study, id)}` : id);
const evidenceDisclosure = (html) => html ? `<details><summary>Evidence and sources</summary>${html}</details>` : "";

function entrySummary(entry) {
  return `<details class="studio-entry"><summary>${e(entry.sourceTerms.join(", "))}</summary>
    <ul>${entry.targetTerms.map((t, i) => `<li>${e(t)}${entry.targetVariantNotes?.[i] ? ` — ${e(entry.targetVariantNotes[i])}` : ""}</li>`).join("")}</ul>
    <p>${e(entry.notesToTranslators)}</p>${entry.footnote ? `<p>${e(entry.footnote)}</p>` : ""}</details>`;
}

function paragraph(p, s) {
  const source = p.text ?? p.source ?? "";
  const highlights = (p.highlightOccurrences ?? [p.highlightOccurrence]).filter((o) => o
    && Number.isInteger(o.start) && Number.isInteger(o.end) && o.start >= 0 && o.end > o.start && o.end <= source.length)
    .sort((a, b) => a.start - b.start);
  let offset = 0; let renderedSource = "";
  for (const occurrence of highlights) {
    if (occurrence.start < offset) continue;
    renderedSource += `${e(source.slice(offset, occurrence.start))}<mark>${e(source.slice(occurrence.start, occurrence.end))}</mark>`;
    offset = occurrence.end;
  }
  renderedSource += e(source.slice(offset));
  const translation = p.translation ?? s.displayTranslations?.[p.id] ?? "";
  const preliminary = p.translation == null && Boolean(translation);
  const context = studioSourceContext(p);
  const contextHtml = context.before.length || context.after.length
    ? `<details class="studio-source-context" ${p.contextKey ? `data-studio-disclosure="${e(p.contextKey)}:source-context"` : ""}><summary>Surrounding source context</summary>
      <p>Neighboring paragraphs help interpret this example. They are context only and are not counted as additional examples.</p>
      ${[["Before this paragraph", context.before], ["After this paragraph", context.after]].filter(([, texts]) => texts.length)
        .map(([label, texts]) => `<h4>${label}</h4>${texts.map((text) => `<p lang="${e(s.scope.sourceLanguage.code)}">${e(text)}</p>`).join("")}`).join("")}</details>` : "";
  return `<article class="studio-passage"><p lang="${e(s.scope.sourceLanguage.code)}">${renderedSource}</p>
    ${translation ? `<div class="studio-translation">${preliminary ? '<p class="studio-preliminary-label"><strong>Preliminary translation</strong> · Without glossary guidance</p>' : ""}<p lang="${e(s.scope.targetLanguage.code)}">${e(translation)}</p></div>` : ""}
    <small>${e((p.references ?? []).map((r) => typeof r === "string" ? r : [r.title ?? r.projectTitle, r.chapterTitle ?? r.chapter_title, r.page, r.line_id].filter(Boolean).join(" · ")).join("; "))}${p.recovered ? " · Additional meaning example" : ""}</small>${contextHtml}${s.step === "4.6" && p.id && !p.translation ? `<div class="studio-actions">${studioView().readingBusy === p.id ? `<span>${loadingSpinner({ key: `reading-${p.id}`, label: "Preparing preliminary translation" })}Preparing preliminary translation…</span>${button("Cancel", "cancel-reading")}` : !translation ? button(studioView().readingErrors?.[p.id] ? "Retry preliminary translation" : "Show preliminary translation", `reading:${p.id}`, { disabled: Boolean(studioView().readingBusy) }) : ""}</div>${studioView().readingErrors?.[p.id] ? `<p class="modal__error">${e(studioView().readingErrors[p.id])}</p>` : ""}` : ""}</article>`;
}

function evidenceHtml(value, seenUrls = new Set()) {
  if (!value) return "";
  if (typeof value === "string") {
    const passages = studioView().study?.passages;
    const source = Array.isArray(passages) ? passages.find((p) => p.id === value) : null;
    const ids = Array.isArray(passages) ? passages.map((p) => p.id) : passages?.ids ?? [];
    if (source || ids.includes(value)) return `<p class="studio-source-reference">${e(source?.reference?.title ?? `Source paragraph ${ids.indexOf(value) + 1}`)}</p>${button("View source paragraph", `view-source:${value}`)}`;
    return `<p>${narrative(value)}</p>`;
  }
  if (Array.isArray(value)) return value.map((item) => evidenceHtml(item, seenUrls)).join("");
  if (typeof value !== "object") return "";
  if (value.author && Array.isArray(value.termCounts)) return `<section class="studio-entry"><h3>${e(value.author)}</h3>
    <p>Verified author or book mentions: ${Number.isInteger(value.verifiedMentions) ? value.verifiedMentions : "Unresolved"}. These are separate from occurrences of this term.</p>
    ${value.mentionEvidence?.schema_version === 2 ? `<p>Shared corpus index · ${quantity(Number(value.mentionEvidence.confirmed_paragraphs), "confirmed paragraph")} · ${e(value.mentionEvidence.confirmed_copies)} corpus ${value.mentionEvidence.confirmed_copies === 1 ? "copy" : "copies"} · ${quantity(Number(value.mentionEvidence.confirmed_occurrences), "name/title occurrence")} · ${quantity(Number(value.mentionEvidence.unresolved_witnesses), "unresolved reference")}. Published reference counts reused.</p>` : ""}
    ${value.termCounts.map((count) => {
      const book = value.books?.find((item) => item.doc_id === count.docId);
      return `<section class="studio-entry"><h4>${e(book?.title ?? count.docId)}</h4>
        <p>${quantity(count.occurrences, "term occurrence")} in ${quantity(count.paragraphs, "paragraph")}</p>
        <p>Catalog metadata · Original publication: ${e(book?.original_first_printing ?? "Unknown")} · First Spanish translation: ${e(book?.first_spanish_translation ?? "Unknown")}</p></section>`;
    }).join("")}
    ${value.passages?.length ? `<details><summary>Sampled source passages (${value.passages.length})</summary>${value.passages.map((passage) => `<article class="studio-passage"><p>${e(passage.text)}</p><small>${e(passage.reference?.title ?? passage.representative?.title ?? "")}</small></article>`).join("")}</details>` : ""}</section>`;
  if (value.definition) {
    const localUrls = new Set();
    const metadata = [value.sourceSense ? `Dictionary sense ${value.sourceSense}` : "", value.grammar
      || (value.labels ?? []).map((label) => label.title || label.abbr).filter(Boolean).join(", ")].filter(Boolean).join(" · ");
    const lists = [["Synonyms", value.synonyms], ["Antonyms", value.antonyms], ["Complex forms", value.complexForms]]
      .filter(([, items]) => Array.isArray(items) && items.length).map(([label, items]) => `<p><strong>${label}:</strong> ${e(items.join(", "))}</p>`).join("");
    const evidence = lists + evidenceHtml(value.evidence, localUrls);
    for (const url of localUrls) seenUrls.add(url);
    return `<article class="studio-entry">${metadata ? `<p class="studio-source-reference"><small>${e(metadata)}</small></p>` : ""}<p>${narrative(value.definition)}</p>${evidenceDisclosure(evidence)}</article>`;
  }
  const url = typeof value.url === "string" && /^https:\/\//u.test(value.url) ? value.url : null;
  let html = value.summary || value.report || value.reason || value.message
    ? `<p>${narrative(value.summary ?? value.report ?? value.reason ?? value.message)}</p>` : "";
  if (value.headword) html += `<h4>${e(value.headword)}</h4>`;
  if (value.etymology) html += `<p>${narrative(value.etymology)}</p>`;
  if (value.status) html += `<p>${e(value.status === "not_found" ? "No dictionary entry found" : value.status === "unreachable" ? "Source unreachable" : value.status)}</p>`;
  if (value.quotation) html += `<blockquote>${e(value.quotation)}</blockquote>`;
  if (value.reference) {
    const ref = value.reference;
    const citation = typeof ref === "string" ? ref : [ref.title ?? ref.bookTitle,
      ref.chapterTitle ?? ref.chapter_title, ref.year,
      ref.page != null ? `Page ${ref.page}` : null, ref.line_id != null ? `Line ${ref.line_id}` : null].filter(Boolean).join(" · ");
    if (citation) html += `<p class="studio-source-reference"><small>${narrative(citation)}</small></p>`;
  }
  if (value.usageNote) html += `<p>${narrative(value.usageNote)}</p>`;
  if (value.cache?.reused) html += `<p class="studio-source-reference"><small>Saved DLE evidence · ${e(value.cache.retrievedAt)}${value.cache.provenance?.timeBasis === "original-cache-file-mtime" ? " · Date of the original saved lookup" : ""}</small></p>`;
  if (url && !seenUrls.has(url)) {
    seenUrls.add(url);
    html += `<p class="studio-source-link"><a href="${e(url)}" data-action="open-external:${e(url)}">${e(url)}</a></p>`;
  }
  for (const key of ["meanings", "evidence", "citations", "authors", "original", "primary", "fallback", "native", "caseVariants", "englishEdition", "englishCaseVariants", "entry", "articles", "senses", "complexForms"]) if (value[key]) html += evidenceHtml(value[key], seenUrls);
  if (value.extract) html += `<details><summary>Dictionary text</summary><p>${e(value.extract)}</p></details>`;
  return html;
}

function meaningPassage(paragraphData, s, assignments) {
  const occurrences = paragraphData.occurrences.filter((o) => assignments.some((a) => a.paragraphId === paragraphData.id && a.occurrenceId === o.id));
  return paragraph({ ...paragraphData, highlightOccurrences: occurrences }, s)
    + `<div class="studio-actions">${occurrences.map((o) => button(`Review occurrence ${paragraphData.occurrences.indexOf(o) + 1}`,
      `review-assignment:${encodeURIComponent(paragraphData.id)}:${encodeURIComponent(o.id)}`, { disabled: studioView().busy })).join("")}</div>`;
}

function meaningsReport(s) {
  return s.meanings.filter((m) => m.enabled !== false).map((m) => {
    const assignments = s.assignments.filter((a) => a.meaningId === m.id);
    const ids = new Set(assignments.map((a) => a.paragraphId));
    return `<section class="studio-entry studio-meaning"><h3>Meaning ${meaningNumber(s, m.id)}${!m.unused ? ` · ${assignments.length} ${assignments.length === 1 ? "occurrence" : "occurrences"}` : ""}</h3><p class="studio-definition">${narrative(m.definition)}</p>
      ${m.unused ? "<p>No corpus example found. Kept in the report only.</p>" : `<details data-studio-disclosure="${e(`meaning-examples:${m.id}`)}"><summary>Show usage examples (${ids.size} ${ids.size === 1 ? "paragraph" : "paragraphs"})</summary>${s.passages.filter((p) => ids.has(p.id)).map((p) => meaningPassage(p, s, assignments)).join("")}</details>`}</section>`;
  }).join("");
}

// Below a finding from the current step 9 test the human can overrule the reviewer,
// stop testing with that paragraph, or edit the entry under test. Older rounds are history.
function findingActions(s, view, choice, translation, signature) {
  if (s.step !== "9" || !currentStudioFinding(s, choice.paragraphId, choice.occurrenceId, translation, signature)) return "";
  const id = `${encodeURIComponent(choice.paragraphId)}:${encodeURIComponent(choice.occurrenceId)}`;
  const override = studioReviewOverride(s, choice.paragraphId, choice.occurrenceId, translation);
  const disabled = view.busy;
  if (override) return `<div class="studio-finding-actions"><p>${override === "accepted" ? "You marked this translation as acceptable." : "Ignored. This paragraph is no longer used for testing."}</p>${button("Undo", `review-undo:${id}`, { disabled })}</div>`;
  return `<div class="studio-finding-actions">${button("Mark this translation as acceptable", `review-accept:${id}`, { disabled })}${button("Ignore this error", `review-ignore:${id}`, { disabled })}${button("Edit glossary entry", `edit-entry:${id}`, { disabled })}</div>`;
}

function trialFindings(trial, s, view, key, signature) {
  const groups = new Map();
  for (const choice of trial.choices ?? []) {
    if (!choice.problem) continue;
    if (!groups.has(choice.paragraphId)) groups.set(choice.paragraphId, []);
    groups.get(choice.paragraphId).push(choice);
  }
  if (!groups.size) return "";
  return `<section class="studio-findings"><h3>Findings to review</h3>${[...groups].map(([paragraphId, choices]) => {
    const source = s.passages.find((p) => p.id === paragraphId);
    const translation = trial.translations?.find((p) => p.paragraphId === paragraphId)?.translation;
    return `<section class="studio-entry">${source ? paragraph({ ...source, translation, contextKey: `${key}:finding:${paragraphId}`,
      highlightOccurrences: source.occurrences.filter((o) => choices.some((c) => c.occurrenceId === o.id)) }, s) : ""}
      ${choices.map((c) => `<div class="studio-finding"><p class="modal__error">${e(c.problem)}</p>${findingActions(s, view, c, translation, signature)}
        ${button("Review meaning", `review-assignment:${encodeURIComponent(c.paragraphId)}:${encodeURIComponent(c.occurrenceId)}`, { disabled: view.busy })}</div>`).join("")}</section>`;
  }).join("")}</section>`;
}


function usageNoteReport(reports, id) {
  const visible = reports.filter((report) => report && (report.summary || report.generalNoteReason || report.candidates?.length));
  if (!visible.length) return "";
  return `<details class="studio-entry" data-studio-disclosure="${e(id)}"><summary>Research report · translation choices</summary>
    <p>Evidence and detailed explanations stay in this report. Only usage notes are sent as glossary guidance.</p>
    ${visible.map((report) => `<section>${report.summary ? `<p>${narrative(report.summary)}</p>` : ""}
      ${report.generalNoteReason ? `<p><strong>Why the shared note needs extra detail:</strong> ${narrative(report.generalNoteReason)}</p>` : ""}
      ${(report.candidates ?? []).map((candidate) => `<article><h4>${e(candidate.text)}</h4>
        ${candidate.explanation ? `<p>${narrative(candidate.explanation)}</p>` : ""}
        ${candidate.longNoteReason ? `<p><strong>Why this note needs extra detail:</strong> ${e(candidate.longNoteReason)}</p>` : ""}</article>`).join("")}</section>`).join("")}
  </details>`;
}

function testingReport(s, view, phase = s.step) {
  const assignments = studyAssignments(s);
  const paragraphCount = new Set(assignments.map((a) => a.paragraphId)).size;
  const splitCount = s.queue.reduce((sum, item) => sum + item.assignments.length, 0);
  const recovered = s.passages.filter((p) => p.recovered).length;
  const draft = buildStudioDraft(s);
  const signature = stableSignature(draft);
  const preview = `<details class="studio-entry studio-test-entry" data-studio-disclosure="entry-preview"><summary>Entry under test · notes and preference</summary>
    <p>Translations are listed in preference order. Pause research to edit notes or preference; changed entries require rechecking earlier batches.</p>
    ${field("General translator note", "generalNote", s.generalNote ?? "", { textarea: true, disabled: view.busy })}
    ${draft.targetTerms.map((text, rank) => {
      const index = s.candidates.findIndex((candidate) => candidate.text === text && candidate.confirmed);
      return `<section class="studio-candidate"><h3>${rank + 1}. ${e(text)}</h3>
        ${field(`Usage note for ${text}`, `candidates.${index}.note`, draft.targetVariantNotes[rank], { textarea: true, sharedNote: text, rows: 6, disabled: view.busy })}
        ${rank ? `<div class="studio-actions">${button("Prefer first", `candidate-first:${index}`, { disabled: view.busy })}${button("Prefer earlier", `candidate-up:${index}`, { disabled: view.busy })}</div>` : ""}</section>`;
    }).join("")}</details>`;
  const skipped = phase === "8" && s.steps["8"]?.status === "skipped" && (s.steps["8"].approved?.reason ?? s.steps["8"].value?.reason);
  return `${skipped ? `<p>Skipped. ${e(skipped)}</p>` : ""}<p>${phase === "8" ? "Testing candidates separately for each meaning." : "Testing the complete entry without telling the translator which meaning applies."}</p>
    <p>This entry: ${quantity(assignments.length, "occurrence")} in ${quantity(paragraphCount, "paragraph")}. Full research sample: ${quantity(s.passages.length, "paragraph")}${recovered ? `, including ${quantity(recovered, "recovered example")}` : ""}.</p>${sourceSpellingNotice(assignments)}
    ${phase === "9" ? `<p>Each validation pass uses one unchanged entry across all batches. Findings are combined before shared notes or preferences are repaired.${s.entryValidation ? ` Current pass: ${s.entryValidation.pass}.` : ""}</p>` : ""}
    ${splitCount ? `<p>${quantity(splitCount, "occurrence")} will be tested separately with the queued split entries.</p>` : ""}${preview}
    ${usageNoteReport(Object.values(s.reports ?? {}).filter((report) => report.kind === "usage-notes" && report.step === phase), `usage-note-repairs:${phase}`)}
    ${phase === "9" && s.assignmentReviewPending ? "<p>Source context or meaning assignments changed. Review any other affected occurrences, then choose Retest meanings. Earlier translation results will be rechecked.</p>" : ""}
    ${Object.entries(s.tests).filter(([key]) => key.startsWith(`${phase}:`)
      && (phase !== "8" || activeMeanings(s).some((meaning) => key === `8:${meaning.id}`))).sort(([a], [b]) => phase === "9"
      ? Number(a.slice(2)) - Number(b.slice(2))
      : activeMeanings(s).findIndex((m) => a === `8:${m.id}`) - activeMeanings(s).findIndex((m) => b === `8:${m.id}`)).map(([key, trial]) => {
      const batch = s.passages.filter((p) => assignments.some((a) => a.paragraphId === p.id)).slice(Number(key.slice(2)), Number(key.slice(2)) + 15);
      const stale = phase === "9" ? trial.signature !== signature
        || trial.batchSignature !== entryBatchSignature(s, batch, assignments.filter((a) => batch.some((p) => p.id === a.paragraphId)))
        : trial.signature !== meaningTrialSignature(s, key.slice(2));
      const label = key.startsWith("8:") ? `Meaning ${meaningNumber(s, key.slice(2))}`
        : `Translation batch ${Math.floor(Number(key.slice(2)) / 15) + 1} · ${batch.length ? `paragraphs ${Number(key.slice(2)) + 1}–${Number(key.slice(2)) + batch.length}` : "outside current sample"}`;
      return `<details class="studio-entry" data-studio-disclosure="${e(key)}"><summary>${stale ? "Recheck pending" : trial.passed ? "Passed" : "Needs review"} · ${label}${trial.rounds != null ? ` · ${studioTrialRoundLabel(trial.rounds)}` : ""} · ${quantity(trial.choices?.length ?? 0, "occurrence")} in ${quantity(trial.translations?.length ?? 0, "paragraph")}</summary>
        ${stale ? phase === "9" ? "<p>This batch has changed glossary guidance or source evidence. It will be rechecked in the next validation pass; unchanged current results are reused.</p>" : "<p>This trial used earlier notes, preferences or meaning assignments and must be rechecked.</p>" : ""}${key.startsWith("8:") ? `<p>${e(s.meanings.find((m) => key === `8:${m.id}`)?.definition)}</p>` : ""}
        ${trial.retainedPassingParagraphs ? `<p>${quantity(trial.retainedPassingParagraphs, "previously passing paragraph")} retained under unchanged research inputs; ${quantity(trial.translations.length - trial.retainedPassingParagraphs, "paragraph")} rechecked this round.</p>` : ""}
        ${key.startsWith("8:") && s.focusedSamples?.[key.slice(2)] ? `<p>Focused sample: ${trial.translations?.length ?? 0} of ${s.focusedSamples[key.slice(2)].totalParagraphs} available paragraphs. Final entry validation retains the complete sample.</p>${trial.translations?.length < s.focusedSamples[key.slice(2)].totalParagraphs ? button("Test all examples for this meaning", `expand-meaning:${key.slice(2)}`, { disabled: view.busy }) : ""}` : ""}${trialFindings(trial, s, view, key, signature)}<details data-studio-disclosure="${e(key)}:translations"><summary>All trial translations (${quantity(trial.translations?.length ?? 0, "paragraph")})</summary>
        ${(trial.translations ?? []).map((t) => {
          const source = s.passages.find((p) => p.id === t.paragraphId);
          return source ? meaningPassage({ ...source, translation: t.translation, contextKey: `${key}:translation:${t.paragraphId}` }, s, trial.choices ?? []) : paragraph(t, s);
        }).join("")}</details></details>`;
    }).join("")}`;
}

function stepContent(s, state) {
  const view = studioView(); const value = s.steps[s.step]?.value;
  const disabled = view.busy;
  if (s.step === "10b" && disabled) return "<p>Checking the retained translations before saving. Removing unused forms changes the entry, so its final selection is tested again.</p>" + testingReport(s, view, "9");
  if (disabled && (!value || (s.step === "4.1" && value.dictionaryVersion !== STUDIO_DICTIONARY_REVIEW_VERSION))
    && s.step !== "2a" && !["8", "9"].includes(s.step)) return "<p>Results will appear here when this step is ready for review.</p>";
  const introduction = {
    "4.1": "Look up definitions, grammatical uses and etymology in source-language dictionaries.",
    "4.3": "Check whether meaningful prefixes, suffixes or word components help explain this term.",
    "4.4.1": "Compare passages from the author's bibliographical sources and verify possible origins.",
    "4.4.2": "Search cited web sources for definitions and possible origins, checking publication dates.",
    "5": "Find recurring expressions or compounds that use this term.",
  }[s.step];
  if (!value && introduction) return `<p>${e(introduction)}</p><p>Choose Run this step to begin, or skip this optional research.</p>`;
  if (s.step === "4.1" && value?.dictionaryVersion !== STUDIO_DICTIONARY_REVIEW_VERSION) return "<p>Refresh this saved dictionary review before continuing.</p>";
  switch (s.step) {
    case "1": return `<label class="field"><span class="field__label">Research corpus</span><select class="field__select" data-studio-field="scope.corpus">
        ${s.scope.sourceLanguage.code.startsWith("es") ? `<option value="samael" ${s.scope.corpus === "samael" ? "selected" : ""}>Complete works of Samael Aun Weor</option>` : ""}
        <option value="projects" ${s.scope.corpus === "projects" ? "selected" : ""}>Select projects</option></select></label>
      ${s.scope.corpus === "projects" ? `<label class="field"><span class="field__label">Projects</span><select class="field__input" multiple data-studio-field="scope.projectIds">${state.projects.filter((p) => p.lifecycleState !== "deleted").map((p) => `<option value="${e(p.id)}" ${s.scope.projectIds.includes(p.id) ? "selected" : ""}>${e(p.title ?? p.name)}</option>`).join("")}</select></label>` : ""}
      ${field("Term to research", "scope.term", s.scope.term, { disabled })}
      ${field("Additional forms or spellings (one per line)", "scope.forms", s.scope.forms.join("\n"), { textarea: true, disabled })}`;
    case "2a": {
      const reviewing = !disabled && value && s.formDiscovery?.version === 3 && s.formDiscovery.phase === "complete";
      if (disabled && view.recommendingStep !== s.step) return "";
      if (studioFormsResearchStarted(s) && !value) return "";
      if (s.formDiscovery?.version === 3 && !reviewing) return "";
      const guidance = reviewing ? "Review the forms you entered together with the additional forms and spellings found by the search. Add any others you know, or uncheck forms to leave them out. Forms not found in the corpus are unchecked; you can override this." : value && s.formDiscovery?.version !== 3 ? "This saved forms review needs updated exact corpus-count checks. Run this step to refresh it, or skip it to use only your entered forms." : view.error ? "The search has not finished. Retry the search to finish checking these forms, or skip this step to use the forms you entered." : !s.formDiscovery ? "Choose Run this step to search for more, or Skip this step to use only these." : "";
      const guidanceHtml = guidance ? `<p>${guidance}</p>` : "";
      if (!reviewing) return `<div class="studio-entered-forms"><p>Word forms entered in step 1:</p><ul aria-label="Entered forms">${s.forms.map((form) => `<li>${e(form.text)}</li>`).join("")}</ul></div>${guidanceHtml}`;
      return `${guidanceHtml}
        <div class="studio-forms" aria-label="Discovered forms" aria-busy="${disabled}">${s.forms.map((f, i) => `<article class="studio-form" aria-label="${e(f.text || "New source form")}">
          <div class="studio-form-heading">${check("Use", `forms.${i}.selected`, f.selected !== false, !reviewing)}${field("Source form", `forms.${i}.text`, f.text, { disabled: !reviewing })}</div>
          <p class="studio-form-status">${e(f.discoveryStatus ?? (Number.isInteger(f.paragraphCount)
            ? f.paragraphCount > 0 ? `Found in ${f.paragraphCount.toLocaleString()} distinct ${f.paragraphCount === 1 ? "paragraph" : "paragraphs"}` : "No exact match in the selected corpus"
            : "Corpus evidence needs checking"))}</p>
          ${f.reason ? `<p class="studio-form-explanation">${narrative(f.reason)}</p>` : ""}
        </article>`).join("")}</div>
        ${reviewing ? `${button("Add spelling or form", "add-form")}${s.forms.some((f) => !Number.isInteger(f.paragraphCount)) ? button("Recheck corpus evidence", "recheck-forms") : ""}` : ""}`;
    }
    case "2b": return !s.relatedEntries.length ? "<p>No related existing entries found.</p>" : `
      <p>The glossary entries below look like the same or similar to the one you are researching.</p>${s.relatedEntries.map(entrySummary).join("")}
      <label class="field"><span class="field__label">What do you want to do about this?</span><select class="field__input" data-studio-branch="true">
      ${[["separate", `Research ${s.scope.term} without looking at the existing glossary entries.`], ["research", `Research ${s.scope.term} taking the existing entries into account.`], ["merge", `Merge ${s.scope.term} into the list of source variants for one of the existing entries.`]].map(([id, label]) => `<option value="${id}" ${view.branch === id ? "selected" : ""}>${e(label)}</option>`).join("")}</select></label>
      ${view.branch === "merge" ? selectedForms(s).map((form) => `<label class="field"><span class="field__label">Add ${e(form)} to</span><select class="field__input" data-studio-merge="${e(form)}"><option value="">Select an entry</option>${s.relatedEntries.map((entry) => `<option value="${e(entry.termId)}" ${view.mergeDestinations[form] === entry.termId ? "selected" : ""}>${e(entry.sourceTerms.join(", "))}</option>`).join("")}</select></label>`).join("") : ""}`;
    case "3": return `<p>${s.passages.length} research paragraphs from ${s.populationCount ?? s.population?.length ?? 0} distinct matching paragraphs.</p>
      <details class="studio-entry"><summary>Review sample (${s.passages.length} paragraphs)</summary>${s.passages.map((p) => paragraph(p, s)).join("")}</details>`;
    case "4.5": return `<p>Review the author's meanings. Edit, split, or combine descriptions by editing this list and selecting the definitions to use.</p>
      ${s.meanings.map((m, i) => `<section class="studio-entry"><h3>Meaning ${meaningNumber(s, m.id)}</h3>${check("Use this definition", `meanings.${i}.enabled`, m.enabled !== false)}${field("Definition", `meanings.${i}.definition`, m.definition, { textarea: true })}${evidenceDisclosure(evidenceHtml(m.evidence))}</section>`).join("")}
      ${(value?.excludedSources ?? []).length ? `<details class="studio-entry"><summary>Background findings not kept as separate meanings (${value.excludedSources.length})</summary>${value.excludedSources.map((row) => `<section><p>${narrative(row.definition)}</p><p>${narrative(row.reason)}</p></section>`).join("")}</details>` : ""}
      ${button("Add meaning", "add-meaning")}`;
    case "4.6": return `<p>${s.passages.length} research paragraphs containing ${s.assignments.length} occurrences. ${s.recoveryConsidered ?? 0} additional paragraphs checked for missing meanings.</p><p>Review the highlighted occurrences for each meaning. Use Review occurrence to correct an assignment while retaining the full paragraph.</p><p>Judge meanings from the original ${e(s.scope.sourceLanguage.name)} text. Preliminary bilingual reading aids are available on request, without glossary guidance. They are not used in later research decisions or counted as test results. Fresh glossary-guided translations are tested in steps 8 and 9.</p>${(s.recoveryConsidered ?? 0) < 500 && s.meanings.some((m) => m.unused) ? `<p>The bounded search leaves some meanings without a confirmed example; this does not establish corpus-wide absence.</p>${button("Search 100 more paragraphs", "expand-recovery", { disabled })}` : ""}${sourceSpellingNotice(s.assignments)}${meaningsReport(s)}`;
    case "4.7": {
      const proposals = (s.splitProposals ?? s.queue).map((proposal, index) => ({ proposal, index, forms: witnessedSplitForms(s, proposal) }));
      const witnessed = proposals.filter((item) => item.forms.length);
      const unverified = proposals.flatMap(({ proposal, forms }) => proposal.forms.filter((form) => !forms.includes(form)));
      return `${value?.summary ? `<p>${narrative(meaningReferences(value.summary, s))}</p>` : ""}${(value?.unverifiedSplits ?? []).length ? `<details class="studio-entry"><summary>Expressions kept with the parent (${value.unverifiedSplits.length})</summary>${value.unverifiedSplits.map((row) => `<p><strong>${e(row.forms.join(", "))}</strong> · ${narrative(row.reason)}</p>`).join("")}</details>` : ""}${witnessed.length ? `<p>Choose which expressions to research as separate entries after this term. Unchecked expressions stay in the original study. Matching uses the longest selected expression.</p><div class="studio-actions">${button("Select all", "select-splits:all")}${button("Clear selection", "select-splits:none")}</div>${witnessed.map(({ proposal, index, forms }) => {
        const q = s.queue.find((item) => item.id === proposal.id);
        return `<section class="studio-entry studio-split">${check("Create separate entry", `splitProposals.${index}.selected`, proposal.selected !== false)}<h3>${e(forms.join(", "))}</h3><p>Provisional translation: ${e((proposal.targetTerms ?? []).join(", "))}</p>${proposal.rationale ? `<p>${narrative(meaningReferences(proposal.rationale, s))}</p>` : ""}${q ? `<details><summary>Review ${q.assignments.length} ${q.assignments.length === 1 ? "occurrence" : "occurrences"} in ${q.passages.length} ${q.passages.length === 1 ? "paragraph" : "paragraphs"}</summary>${q.passages.map((p) => paragraph({ ...p, highlightOccurrences: p.occurrences }, s)).join("")}</details>` : ""}</section>`;
      }).join("")}` : "<p>No separate entries are needed for the observed uses.</p>"}
        ${unverified.length ? `<details class="studio-entry"><summary>Unverified suggestions (${unverified.length})</summary><p>These expressions have no exact occurrence with the proposed meaning in this research sample and will not be queued.</p><ul>${unverified.map((form) => `<li>${e(form)}</li>`).join("")}</ul></details>` : ""}`;
    }
    case "5": {
      const report = reviewCompoundReport(s, value);
      return `${!report.compounds.length ? "<p>No qualifying recurring compounds or phrases were found in the research sample.</p>" : `<p>These expressions have verified examples in this research sample. They will be used as context when translations are suggested in step 6.</p>
        ${report.compounds.map((c) => `<details class="studio-entry"><summary>${e((c.forms ?? [c.phrase]).join(", "))} · ${quantity(c.paragraphIds.length, "paragraph")}</summary><p>${narrative(c.explanation)}</p>${s.passages.filter((p) => c.paragraphIds.includes(p.id)).map((p) => paragraph(p, s)).join("")}</details>`).join("")}`}
        ${report.unverifiedCompounds.length ? `<details class="studio-entry"><summary>Unverified suggestions (${report.unverifiedCompounds.length})</summary><p>These suggestions do not meet the research-witness requirement and will not be used for translation candidates.</p>${report.unverifiedCompounds.map((c) => `<p><strong>${e(c.phrase)}</strong> · ${narrative(c.reason)}</p>`).join("")}</details>` : ""}`;
    }
    case "6": {
      const preference = uniqueTexts(s.candidates.filter((c) => c.selected !== false && c.meaningIds.length).map((c) => c.text));
      return `<p>Select translations for each meaning. Expand Usage notes and editing to change wording, notes, preference, or inflections.</p>
        <p>Keep usage notes brief. Include extra detail only when it prevents a meaningful translation error; keep research explanations in the report below.</p>
        ${usageNoteReport([value?.research], "candidate-note-research")}
        <details class="studio-entry studio-entry-settings" data-studio-disclosure="candidate-entry-settings"><summary>Entry notes and preference</summary>
          <div class="studio-preference"><h3>Current candidate preference</h3><ol>${preference.map((text) => `<li>${e(text)}</li>`).join("")}</ol></div>
          ${field("General translator note", "generalNote", s.generalNote ?? "", { textarea: true })}${field("Footnote", "footnote", s.footnote ?? "", { textarea: true })}
        </details>
        ${activeMeanings(s).map((m) => {
          const candidates = s.candidates.map((c, i) => ({ c, i })).filter(({ c }) => (c.proposedMeaningIds ?? c.meaningIds).includes(m.id));
          return `<section class="studio-entry studio-meaning"><h3>Meaning ${meaningNumber(s, m.id)}</h3><p class="studio-definition">${narrative(m.definition)}</p>
            <ul class="studio-candidate-choices" aria-label="Translations for meaning ${meaningNumber(s, m.id)}">${candidates.map(({ c, i }) => `<li><label class="field__checkbox studio-check"><input type="checkbox" data-studio-field="candidates.${i}.meaningIds" data-studio-meaning="${e(m.id)}" ${c.selected !== false && c.meaningIds.includes(m.id) ? "checked" : ""}><span data-studio-candidate-text="${i}">${e(c.text || "New translation")}</span></label></li>`).join("")}</ul>
            <details class="studio-meaning-editor" data-studio-disclosure="${e(`candidate-meaning:${m.id}`)}"><summary>Usage notes and editing</summary>
              <p>Selections apply to this meaning. Preference and usage notes apply to the complete entry.</p>
              ${candidates.map(({ c, i }) => `<article class="studio-candidate"><div class="studio-candidate-heading"><h4 data-studio-candidate-text="${i}">${e(c.text || "New translation")}</h4><span class="studio-priority">${preference.includes(c.text) ? `Preference ${preference.indexOf(c.text) + 1}` : "Not selected"}</span></div>
                ${field("Translation", `candidates.${i}.text`, c.text)}${field("Usage note", `candidates.${i}.note`, c.note ?? "", { textarea: true, sharedNote: c.text, rows: Math.max(3, Math.min(8, Math.ceil((c.note ?? "").length / 95))) })}
                <div class="studio-actions">${preference.indexOf(c.text) !== 0 ? button("Prefer first", `candidate-first:${i}`) + button("Prefer earlier", `candidate-up:${i}`) : ""}${button("Add inflection", `add-inflection:${i}`)}</div>
              </article>`).join("")}${button("Add translation", `add-candidate:${m.id}`)}
            </details></section>`;
        }).join("")}`;
    }
    case "7": return (value?.decisions ?? []).length ? (value.decisions.map((d) => `<article class="studio-entry"><h3>${e(d.spelling)}</h3><p>${e(d.classification)} · ${narrative(d.reason)}</p>${evidenceHtml(d.evidence)}</article>`).join("")) : "<p>No unresolved spelling questions were identified.</p>";
    case "8": case "9": return testingReport(s, view);
    case "10a": return `<p>Review translations of ${e(s.scope.term)}. Unused forms are unchecked for deletion; select any you want to keep.</p>
      <p>${quantity(studyAssignments(s).length, "researched occurrence")} across ${quantity(new Set(studyAssignments(s).map((a) => a.paragraphId)).size, "paragraph")}.</p>${sourceSpellingNotice(studyAssignments(s))}
      ${uniqueTexts(s.candidates.filter((c) => c.confirmed && c.selected !== false && c.meaningIds.some((id) => activeMeanings(s).some((m) => m.id === id))).map((c) => c.text)).map((text) => {
        const index = s.candidates.findIndex((c) => c.confirmed && c.text === text); const c = s.candidates[index];
        const count = s.usageByText?.[text] ?? s.usage?.[c.id] ?? { occurrences: 0, paragraphs: 0 };
        return `<div class="studio-entry studio-usage">${check(text, `candidates.${index}.retained`, c.retained !== false, false, `data-studio-retain-text="${e(text)}"`)}<span class="studio-usage-count">${quantity(count.occurrences, "occurrence")} across ${quantity(count.paragraphs, "paragraph")}</span></div>`;
      }).join("")}`;
    case "10b": {
      const collisions = sourceCollisions(s, studioGlossaryEntries(s.scope));
      return !collisions.length ? "<p>No source variants collide with existing entries.</p>" : `<p>Choose separately for each source variant. Overwrite changes remain staged until Save; cancelling leaves existing entries unchanged.</p>
        <div class="studio-actions">${button("Overwrite all", "all-collisions:overwrite")}${button("Keep all existing", "all-collisions:keep")}</div>
        ${collisions.map(({ form, entries }) => `<section class="studio-entry"><h3>${e(form)}</h3>${entries.map(entrySummary).join("")}<select class="field__input" data-studio-collision="${e(form)}"><option value="">Select an action</option><option value="overwrite" ${s.collisions[form] === "overwrite" ? "selected" : ""}>Overwrite</option><option value="keep" ${s.collisions[form] === "keep" ? "selected" : ""}>Keep old, drop new</option></select></section>`).join("")}`;
    }
    case "11": return "<p>The researched entry is ready to open in the term editor. You can edit it, save it, cancel, or return to research.</p>";
    case "12": { const count = s.queue.filter((q) => q.status === "queued").length; return `<p>${count ? `${count} split ${count === 1 ? "entry remains" : "entries remain"} to research.` : "All split entries have been reviewed."}</p>${s.queue.map((q) => `<p>${e(q.forms.join(", "))} — ${e(q.status)}</p>`).join("")}`; }
    default: {
      const seenUrls = new Set();
      let findings;
      if (s.step === "4.4.1" && value) {
        const authors = new Map();
        for (const meaning of value.meanings ?? []) {
          const author = meaning.author || "Source not identified";
          const group = authors.get(author) ?? []; group.push(meaning); authors.set(author, group);
        }
        findings = `${value.summary ? `<details class="studio-entry"><summary>Source assessment</summary><p>${narrative(value.summary)}</p></details>` : ""}
          ${(value.authorAssessments ?? []).length ? `<details class="studio-entry"><summary>Author assessments (${value.authorAssessments.length})</summary>${value.authorAssessments.map((a) => `<section><h4>${e(a.author)}</h4><p>${narrative(a.summary)}</p></section>`).join("")}</details>` : ""}
          ${authors.size ? "<p>Open an author to review the source meanings and supporting quotations.</p>" : "<p>No source meanings were identified.</p>"}
          ${[...authors].map(([author, meanings]) => `<details class="studio-entry studio-author-group"><summary>${e(author)} · ${quantity(meanings.length, "source meaning")}</summary>${evidenceHtml(meanings, seenUrls)}</details>`).join("")}`;
      } else findings = evidenceHtml(value && { ...value, evidence: null }, seenUrls);
      const sources = evidenceHtml(value?.evidence, seenUrls);
      return `${findings}${sources ? `<details class="studio-entry studio-sources"><summary>Sources and retrieval details</summary>${sources}</details>` : ""}`;
    }
  }
}

function modal(s, view) {
  const decision = view.hideDecision ? null : s?.pendingDecision; const m = view.modal;
  if (!m && view.hideDecision) return "";
  if (!decision && !m) return "";
  let title; let body; let actions;
  if (m?.kind === "redo") {
    title = "Redo this step?";
    body = "<p>Changing the data in this form means you will need to redo this step and any later steps that depend on it. Do you want to continue editing?</p>";
    actions = button("Cancel", "close-modal", { modalCancel: true, modalInitialFocus: true })
      + primaryButton("Continue", "studio:confirm-redo");
  } else if (m?.kind === "delete") {
    title = "Delete saved research?";
    body = `<p>Permanently delete the saved research for <strong>${e(m.study.term || "Untitled study")}</strong> and its cached evidence from this computer?</p><p>Glossary entries and other saved studies will be kept. This cannot be undone.</p>`;
    actions = button("Cancel", "close-modal", { modalCancel: true, modalInitialFocus: true, disabled: Boolean(view.deletingStudyId) })
      + errorButton(view.deletingStudyId ? "Deleting…" : "Delete research", "studio:confirm-delete", { disabled: Boolean(view.deletingStudyId) });
  } else if (m?.kind === "sourceParagraph") {
    title = "Cited source paragraph";
    body = m.loading ? `<p role="status">Loading saved source evidence…</p>` : m.paragraph ? paragraph(m.paragraph, s) : `<p role="alert">${e(m.error ?? "Source evidence is unavailable.")}</p>`;
    actions = button("Close", "close-modal", { modalCancel: true, modalInitialFocus: true });
  } else if (m?.kind === "meaningReview") {
    title = "Review occurrence meaning";
    const source = s.passages.find((p) => p.id === m.paragraphId);
    const assignment = s.assignments.find((a) => a.paragraphId === m.paragraphId && a.occurrenceId === m.occurrenceId);
    const trials = s.step === "8" ? [s.tests[`8:${assignment?.meaningId}`]]
      : s.step === "9" ? Object.values(s.tests).filter((test) => test.phase === "9") : [];
    const translation = trials.filter(Boolean).flatMap((test) => test.translations ?? [])
      .find((p) => p.paragraphId === m.paragraphId)?.translation;
    body = `<p>Choose the meaning of the highlighted occurrence. The whole paragraph remains as context. Changes must pass meaning tests before the complete entry is tested again.</p>
      ${paragraph({ ...source, highlightOccurrence: source?.occurrences.find((o) => o.id === m.occurrenceId), translation }, s)}
      ${studioContextRequest(source) ? `<div class="studio-context-review">${s.expandedContextIds?.includes(source.id)
        ? `<p>Wider source context loaded: ${quantity(studioSourceContext(source).before.length, "paragraph")} before, ${quantity(studioSourceContext(source).after.length, "paragraph")} after. Open Surrounding source context above to read it.</p>`
        : `${m.loadingContext ? `<div class="studio-progress">${loadingSpinner({ key: "studio-source-context", label: "Loading wider source context" })}<span>Loading wider source context…</span></div>` : ""}${button(m.contextError ? "Retry loading context" : "Load wider context", "load-context", { disabled: Boolean(m.loadingContext || view.savingAssignment) })}<p>Load up to three neighboring paragraphs on either side. These remain source context, not additional research examples.</p>`}
        ${m.contextError ? `<p class="modal__error" role="alert">${e(m.contextError)}</p>` : ""}</div>` : ""}
      <label class="field"><span class="field__label">Meaning in this occurrence</span><select class="field__input" data-studio-decision="meaningReview" data-modal-initial-focus ${view.savingAssignment || m.loadingContext ? "disabled" : ""}>
      ${s.meanings.filter((meaning) => meaning.enabled !== false).map((meaning) => `<option value="${e(meaning.id)}" ${s.decisionInput?.meaningReview === meaning.id ? "selected" : ""}>${meaningNumber(s, meaning.id)}. ${e(meaning.definition)}</option>`).join("")}</select></label>
      <label class="field__checkbox studio-check"><input type="checkbox" data-studio-decision="preserveSourceSpelling" ${s.decisionInput?.preserveSourceSpelling ? "checked" : ""} ${view.savingAssignment || m.loadingContext ? "disabled" : ""}>Retain this source spelling verbatim</label>
      <p>Use this only when the highlighted occurrence explicitly discusses the original spelling or pronunciation. It remains tested in context, but does not count as usage of a target translation. Ordinary references still use the glossary's target forms.</p>`;
    actions = button("Cancel", "close-modal", { modalCancel: true, disabled: view.savingAssignment })
      + primaryButton(view.savingAssignment ? "Saving…" : "Save meaning", "studio:save-assignment", { modalDefault: true, disabled: Boolean(view.savingAssignment || m.loadingContext) });
  } else if (m?.kind === "queue") {
    title = "Research separate entries";
    body = `<p>Some meanings of ${e(s.scope.term)} can be handled more precisely by separate glossary entries: ${e(m.compounds.join(", "))}. We will now research the translations of these compounds.</p>`;
    if (view.openingQueue) body += `<div class="studio-progress">${loadingSpinner({ key: "studio-queue-opening", label: "Opening compound research" })}<span>Opening compound research…</span></div>`;
    actions = button("Cancel", "close-modal", { disabled: Boolean(view.openingQueue) })
      + primaryButton(view.openingQueue ? "Opening study…" : "Continue", "studio:queue", { disabled: Boolean(view.openingQueue) });
  } else if (m?.kind === "skip") {
    title = "Skip this step?"; body = `<p>If you skip this sub-step then the ${e(m.label)} part of the research process also needs to be skipped.</p>`;
    actions = button("Don't skip", "close-modal") + button("Skip it", "confirm-skip");
  } else if (m?.kind === "lastParagraph") {
    title = "Cancel the research"; body = `<p>This is the only remaining paragraph in this study. Removing it will cancel this research.</p>`;
    actions = button("OK", "cancel-last");
  } else if (decision?.kind === "unmatched") {
    title = "Choose a meaning";
    body = `<p>Review the highlighted occurrence of ${e(s.scope.term)}. Choose an existing definition, add a meaning, or remove the paragraph.</p>
      ${paragraph({ ...decision.paragraph, highlightOccurrence: decision.paragraph.occurrences.find((o) => o.id === decision.occurrenceId), translation: decision.recommendation.translation }, s)}
      <label class="field"><span class="field__label">Existing meaning</span><select class="field__input" data-studio-decision="meaning"><option value="">Select a definition</option>${s.meanings.filter((m) => m.enabled !== false).map((m) => `<option value="${e(m.id)}" ${s.decisionInput?.meaning === m.id ? "selected" : ""}>${meaningNumber(s, m.id)}. ${narrative(m.definition)}</option>`).join("")}</select></label>
      <label class="field"><span class="field__label">New meaning</span><textarea class="field__textarea" data-studio-decision="definition">${e(s.decisionInput?.definition ?? decision.recommendation.definition)}</textarea></label>`;
    actions = button("Drop this paragraph", "decision:drop") + button("Assign selected meaning", "decision:assign", { disabled: !s.decisionInput?.meaning }) + button("Add new meaning", "decision:new");
  } else if (decision?.kind === "candidate") {
    title = "Review a new translation";
    body = `<p>Review the proposed forms and their selection conditions before adding them. You can leave an inflection out or adjust its note.</p>
      ${s.candidates.map((candidate, index) => candidate.meaningIds.includes(decision.meaningId) || candidate.groupId === decision.groupId
        ? `<section class="studio-entry"><h3>${e(candidate.text)}</h3>${candidate.groupId === decision.groupId
          ? check("Include proposed form", `candidates.${index}.meaningIds`, candidate.meaningIds.includes(decision.meaningId), false, `data-studio-meaning="${e(decision.meaningId)}"`) : ""}
          ${field("Usage note", `candidates.${index}.note`, candidate.note ?? "", { textarea: true })}</section>` : "").join("")}
      <details><summary>Review ${quantity(decision.translations.length, "preview translation")}</summary>${decision.translations.map((t) => paragraph(t, s)).join("")}</details>
      <label class="field"><span class="field__label">Suggest another word or inflections (comma separated)</span><input class="field__input" data-studio-decision="candidate" value="${e(s.decisionInput?.candidate)}"></label>`;
    actions = button("Use my suggestion", "decision:replace") + primaryButton("Approve suggested forms", "studio:decision:approve");
  } else {
    title = decision?.kind === "progress" ? `Research progress · ${decision.rounds} repair rounds` : "Selection needs review";
    body = `<p>${e(decision?.report ?? "The batch still has failures after three repair rounds. You can stop and resume later, edit the research using Back, or continue testing.")}</p>`;
    actions = decision?.kind === "selection"
      ? button("Review the errors yourself", "decision:stop") + primaryButton("Continue 3 more rounds with AI", "studio:decision:continue")
      : button("Stop", "decision:stop") + primaryButton("Continue", "studio:decision:continue");
  }
  return `<div class="modal-backdrop"><section class="card modal-card studio-modal" role="dialog" aria-modal="true" aria-labelledby="studio-question" data-modal-dialog="studio-question" tabindex="-1"><div class="card__body stack"><h2 id="studio-question">${e(title)}</h2>${body}<div class="modal__actions">${actions}</div>${view.error ? `<p role="alert">${e(view.error)}</p>` : ""}</div></section></div>`;
}

// The reviewer's verdicts with the human's overrides: an accepted translation counts as correct;
// an ignored paragraph stays a failure that no longer decides the test.
function reviewedOccurrences(row, s) {
  return (row.occurrences ?? []).map((o) => {
    const override = o.passed ? null : studioReviewOverride(s, row.paragraphId, o.occurrenceId, row.translation);
    return { ...o, override, passed: o.passed || override === "accepted" };
  });
}

function reviewResult(review, s) {
  const occurrences = review.flatMap((row) => reviewedOccurrences(row, s));
  const ignored = occurrences.filter((o) => o.override === "ignored").length;
  return `${occurrences.filter((o) => o.passed).length} of ${occurrences.length} occurrences passed${ignored ? `; ${ignored} ignored` : ""}.`;
}

function reviewOutcomeLists(review, key, s, view, signature) {
  return [["failed", "Translations that failed to use the correct meaning", false], ["passed", "Translations that used the correct meaning", true]].map(([id, label, passed]) => {
    const rows = review.map((row) => ({ ...row, occurrences: reviewedOccurrences(row, s).filter((o) => o.passed === passed) })).filter((row) => row.occurrences.length);
    const disclosure = `activity:${JSON.stringify(key)}:${id}`;
    return `<details class="studio-review-outcomes" data-studio-disclosure="${e(disclosure)}"><summary>${label} (${rows.reduce((sum, row) => sum + row.occurrences.length, 0)})</summary>${rows.map((row) => {
      const source = Array.isArray(s.passages) ? s.passages.find((p) => p.id === row.paragraphId) : null;
      return `<section class="studio-entry">${source ? paragraph({ ...source, translation: row.translation, contextKey: `${disclosure}:${row.paragraphId}`,
        highlightOccurrences: (source.occurrences ?? []).filter((o) => row.occurrences.some((r) => r.occurrenceId === o.id)) }, s)
        : `<p lang="${e(s.scope.targetLanguage.code)}">${e(row.translation)}</p>`}${row.occurrences.filter((o) => o.problem).map((o) => `<p class="modal__error">${e(o.problem)}</p>${findingActions(s, view, { paragraphId: row.paragraphId, occurrenceId: o.occurrenceId }, row.translation, signature)}`).join("")}</section>`;
    }).join("") || "<p>None.</p>"}</details>`;
  }).join("");
}

function activityProgress(s, view) {
  if (s.step === "2a" && !studioFormsResearchStarted(s) && (!view.busy || view.recommendingStep === s.step)) return "";
  const items = studioActivityItems(s);
  const signature = s.step === "9" ? stableSignature(buildStudioDraft(s)) : null;
  if (!items.length) return view.busy || view.message ? `<div class="studio-progress" role="status" aria-live="polite">${view.busy ? loadingSpinner({ key: `studio-${s.id}-${s.step}`, label: "Research in progress" }) : ""}<span>${e(view.message || "Research in progress…")}</span></div>` : "";
  function list(nodes, path = []) {
    return `<ol class="studio-work-list">${nodes.map((node) => {
      const key = [...path, node.id];
      const children = node.children ?? [];
      const descendantStates = children.map(status);
      let state = node.status ?? "waiting";
      if (descendantStates.includes("running")) state = "running";
      else if (descendantStates.includes("failed")) state = "failed";
      else if (state !== "complete" && children.length && descendantStates.every((value) => value === "complete")) state = "complete";
      if (state === "running" && !view.busy) state = "paused";
      const icon = state === "complete" ? "✓" : state === "failed" ? "!" : state === "paused" ? "Ⅱ" : "○";
      const singleOperation = children.length === 1 && children[0].id.startsWith("operation:") && !(children[0].children?.length) ? children[0] : null;
      const originalFindings = s.step === "2a" && key.length === 2 && key[0] === "origin" && node.id === "search";
      const result = (originalFindings && s.origin?.evidence?.summary) || (Array.isArray(node.review) && node.result ? reviewResult(node.review, s) : node.result) || singleOperation?.result || "";
      const formatted = result ? studioResultPresentation(result) : null;
      const reused = node.reused || singleOperation?.reused ? '<p class="studio-work-result studio-work-reused">Saved result reused.</p>' : "";
      const sources = s.step === "2a" && key.length === 1 && node.id === "origin"
        ? evidenceHtml({ citations: s.origin?.evidence?.citations }) : "";
      const corpusChecks = s.formDiscovery?.corpusResults ?? s.forms;
      const completedCorpus = s.step === "2a" && key.length === 1 && node.id === "forms" && state === "complete"
        && corpusChecks.length > 0 && corpusChecks.every((form) => Number.isInteger(form.paragraphCount) && form.paragraphCount >= 0);
      const corpusForms = completedCorpus ? corpusChecks
        .filter((form) => Number.isInteger(form.paragraphCount) && form.paragraphCount > 0) : [];
      const corpusName = s.scope.corpus === "samael" ? "the Samael Aun Weor corpus" : "the selected projects";
      const childList = children.length && !singleOperation ? list(children, key) : "";
      // Entry validation lists many batches; completed ones fold away so work in progress stays easy to find.
      const foldedBatch = key.length === 1 && node.id.startsWith("batch-") && state === "complete";
      return `<li class="studio-work-item" data-work-state="${e(state)}"><div class="studio-work-heading">${state === "running" ? loadingSpinner({ key: `work-${JSON.stringify(key)}`, label: `In progress: ${node.label}` }) : `<span class="studio-work-icon" aria-hidden="true">${icon}</span>`}<span>${e(node.label)}</span><span class="studio-work-state">${e(({ complete: "Completed", waiting: "Waiting", running: "In progress", paused: "Paused", failed: "Needs attention" })[state])}</span></div>
        ${completedCorpus ? `<p class="studio-work-result">We found ${quantity(corpusForms.length, "form")} used in ${corpusName}${corpusForms.length ? ":" : "."}</p>
          ${corpusForms.length ? `<ul class="studio-corpus-forms" aria-label="Forms found in the corpus">${corpusForms.map((form) => `<li>${e(form.text)} — ${e(form.paragraphCount.toLocaleString())} matching ${form.paragraphCount === 1 ? "paragraph" : "paragraphs"}</li>`).join("")}</ul>` : ""}`
          : formatted ? `${formatted.long ? `<p class="studio-work-result">${e(formatted.preview)}</p><details data-studio-disclosure="${e(`activity:${JSON.stringify(key)}`)}"><summary>${originalFindings ? "Read full findings" : "Read result summary"}</summary><div class="studio-work-result studio-report">${formatted.details ?? formatted.html}</div></details>` : `<div class="studio-work-result studio-report">${formatted.html}</div>`}${reused}` : ""}
        ${Array.isArray(node.review) ? reviewOutcomeLists(node.review, key, s, view, signature) : ""}
        ${sources ? `<details data-studio-disclosure="original-spelling-sources"><summary>Evidence and sources</summary>${sources}</details>` : ""}
        ${node.error || singleOperation?.error ? `<p class="studio-work-error">${e(node.error || singleOperation.error)}</p>` : ""}${completedCorpus && childList ? `<details data-studio-disclosure="forms-corpus-details"><summary>Check details</summary>${childList}</details>`
          : foldedBatch && childList ? `<details data-studio-disclosure="${e(`activity:${JSON.stringify(key)}:details`)}"><summary>Test details</summary>${childList}</details>` : childList}</li>`;
    }).join("")}</ol>`;
  }
  function status(node) {
    const childStates = (node.children ?? []).map(status);
    if (childStates.includes("running")) return "running";
    if (childStates.includes("failed")) return "failed";
    if (node.status === "complete" || (childStates.length && childStates.every((value) => value === "complete"))) return "complete";
    return node.status ?? "waiting";
  }
  return `<section class="studio-work" aria-label="Work in this step"><h3>Work in this step</h3>
    <p class="studio-work-announcement" role="status" aria-live="polite">${e(view.busy ? view.message || "Research in progress" : view.error ? "Research needs attention" : "Research progress saved")}</p>${list(items)}</section>`;
}

function skipRecommendation(s, view) {
  if (!studioCanRecommendSkip(s.step) || ["complete", "merged", "cancelled"].includes(s.status)) return "";
  if (studioResearchStarted(s) || (view.busy && view.recommendingStep !== s.step)) return "";
  const recommendation = currentStudioRecommendation(s);
  const working = view.recommendingStep === s.step;
  return `<aside class="studio-recommendation" aria-label="AI step recommendation">
    <div class="studio-recommendation-heading"><h3>AI recommendation${recommendation && !working ? `: ${e(recommendation.recommendation)} it.` : ""}</h3>
    ${!view.busy && s.step !== "2a" ? button(recommendation ? "Refresh recommendation" : "Get AI recommendation", "recommend", { disabled: view.saving }) : ""}</div>
    ${working ? `<p class="studio-progress" role="status">${loadingSpinner({ key: "skip-recommendation", label: "Considering whether this research step would help" })}<span>Considering whether this research step would help…</span></p>`
      : recommendation ? `<details class="studio-recommendation-reason" data-studio-disclosure="recommendation-reason"><summary class="text-link">Show reasoning</summary><p>${narrative(recommendation.reason)}</p></details>`
        : "<p>No current recommendation. You can request advice, run the research, or skip it.</p>"}
    ${s.step === "4.4.4" ? "<p>Skipping here discards the entire source-research branch. A confirmation will explain this before anything is skipped.</p>" : ""}
  </aside>`;
}

function budgetComparisons(s) {
  return `${s.status === "complete" && !s.referenceStudyId ? button("Compare paragraph budgets", "compare-budgets") : ""}${s.referenceStudyId ? `<aside class="studio-entry"><strong>Controlled paragraph-budget comparison</strong><p>Discovery and recovery are measured separately. Focused and final translation tests use the fixed ${s.comparisonReference?.paragraphCount ?? 101}-paragraph reference and its original meaning assignments. The glossary is not overwritten by this comparison.</p>${!studioView().busy && s.steps[s.step]?.value && !s.pendingDecision && ["bibliography", "assignment"].includes(s.budgetComparisonPhase) ? button(s.budgetComparisonPhase === "bibliography" ? "Keep reference inventory and compare assignments" : "Keep reference sample and compare translations", "budget-next") : s.step === "9" && s.steps["9"]?.value?.complete && s.status !== "complete" ? button("Finish budget comparison", "budget-next") : s.budgetComparisonPhase === "complete" && !s.comparisonResults?.counterfactual ? button("Test omitted interpretation", "counterfactual", { disabled: studioView().busy }) : ""}${s.counterfactualSummary ? `<h4>Omitted-interpretation audit: ${e(s.counterfactualSummary.severity)}</h4><blockquote>${e(s.counterfactualSummary.translation)}</blockquote><p>${narrative(s.counterfactualSummary.explanation)}</p>` : ""}</aside>` : ""}`;
}

export function renderGlossaryResearchStudio(state) {
  const view = studioView(); const s = view.study;
  let body;
  if (!s) body = `<div class="studio-history"><p>Research glossary terms interactively. Your studies and evidence are saved on this computer.</p>${primaryButton("New research", "studio:new")}
    ${view.openingStudyId ? `<div class="studio-progress" role="status" aria-live="polite">${loadingSpinner({ key: "studio-opening", label: "Opening saved research" })}<span>Opening saved research…</span></div>` : ""}
    ${view.error ? `<p class="modal__error" role="alert">${e(view.error)}</p>` : ""}
    ${view.history.map((h) => `<article class="studio-entry"><h3>${e(h.term)}</h3><p>${e(h.status)} · ${e(STUDIO_STEPS.find((st) => st.id === h.step)?.label)}</p><div class="studio-actions">${button(view.openingStudyId === h.id ? "Opening…" : "Open study", `resume:${h.id}`, { disabled: view.openingStudyId === h.id })}${errorButton("Delete research", `studio:delete:${h.id}`)}</div></article>`).join("")}</div>`;
  else {
    const step = STUDIO_STEPS.find((st) => st.id === s.step);
    const canExport = STUDIO_STEPS.indexOf(step) >= STUDIO_STEPS.findIndex((st) => st.id === "4.2");
    const needsResult = !["1", "10a", "10b", "11", "12"].includes(s.step);
    const unfinished = Boolean(s.steps[s.step]?.value?.pending);
    const stepComplete = Boolean(s.steps[s.step]?.approved || ["complete", "skipped"].includes(s.steps[s.step]?.status)
      || (s.steps[s.step]?.value && !unfinished && !s.pendingDecision));
    const entryNeedsRetest = s.step === "9" && !entryTrialsAreCurrent(s);
    const meaningNeedsRetest = s.step === "8" && !meaningTrialsAreCurrent(s);
    const staleDictionary = s.step === "4.1" && s.steps[s.step]?.value && s.steps[s.step].value.dictionaryVersion !== STUDIO_DICTIONARY_REVIEW_VERSION;
    const staleForms = s.step === "2a" && s.steps[s.step]?.value && s.formDiscovery?.version !== 3;
    const browsingCheckpoint = view.revisiting && (s.steps[s.step]?.approved || ["complete", "skipped"].includes(s.steps[s.step]?.status));
    const continueDisabled = Boolean(view.saving) || !browsingCheckpoint && (Boolean(s.pendingDecision) || entryNeedsRetest || meaningNeedsRetest || (s.step === "9" && s.assignmentReviewPending) || unfinished || Boolean(staleDictionary) || Boolean(staleForms) || (needsResult && !s.steps[s.step]?.value) || (s.step === "2a" && (s.formDiscovery && s.formDiscovery.phase !== "complete")));
    const needsRun = needsResult && (!s.steps[s.step]?.value || (unfinished && !s.pendingDecision) || view.error || staleDictionary || staleForms);
    // Run and Skip stay available while advice is requested. Run is the orange
    // default until the AI recommends Skip, while no other primary action shows.
    const recommending = view.busy && view.recommendingStep === s.step;
    const recommended = (!view.busy || recommending) && !s.pendingDecision && needsRun && continueDisabled && studioCanRecommendSkip(s.step)
      ? !recommending && currentStudioRecommendation(s)?.recommendation === "Skip" ? "Skip" : "Run" : null;
    const runButton = recommended === "Run" ? (label, action, options) => primaryButton(label, `studio:${action}`, options) : button;
    const skipButton = recommended === "Skip" ? primaryButton("Skip this step", "studio:skip") : button("Skip this step", "skip");
    const content = stepContent(s, state);
    const formsReview = s.step === "2a" && s.formDiscovery?.phase === "complete" && Boolean(content);
    const contentHtml = content ? `<div class="studio-step"${formsReview ? ' data-studio-forms-review' : ""}>${content}</div>` : "";
    body = `<div class="studio-layout" data-studio-disclosure-context="${e(JSON.stringify([s.id, s.step]))}"><aside class="studio-outline" aria-label="Research steps"><h2>Research steps</h2><ol>${STUDIO_STEPS.map((st) => {
      const status = studioStepStatusLabel(s.steps[st.id]);
      return `<li ${st.id === s.step ? 'aria-current="step"' : ""}><button type="button" class="studio-step-link" data-action="studio:visit:${e(st.id)}" ${studioCanVisitStep(s, st.id) ? "" : "disabled"} ${st.id === s.step ? 'aria-current="step"' : ""}>${e(studioStepNumber(st.id))} · ${e(st.label)}${status ? status === "✓" ? " ✓" : ` · ${e(status)}` : ""}</button></li>`;
    }).join("")}</ol>${Object.values(s.steps).some((record) => record.status === "stale") ? "<p>Needs review: earlier inputs changed. Saved results remain available.</p>" : ""}</aside>
      <section class="studio-main"><header class="studio-step-header"><h2>${e(studioStepNumber(step.id))} · ${e(step.label)}</h2><p>${e(s.scope.sourceLanguage.name)} → ${e(s.scope.targetLanguage.name)}</p></header>
      <div class="studio-content">
      ${["complete", "merged", "cancelled"].includes(s.status) ? `<p role="status">Study ${e(s.status)}. All research remains saved.</p>` : ""}
      ${s.step !== "2a" ? skipRecommendation(s, view) : ""}
      ${["4.4.1", "4.4.4"].includes(s.step) || (s.step === "4.5" && sourceSummaryMustBeSkipped(s)) ? `<p class="studio-step-rule">If both source searches are skipped, the source summary (4.4.3) is skipped automatically.${sourceSummaryMustBeSkipped(s) ? " This rule has been applied." : ""}</p>` : ""}
      ${s.step === "2a" && !formsReview ? contentHtml : ""}
      ${s.step === "2a" ? skipRecommendation(s, view) : ""}
      ${activityProgress(s, view)}
      ${view.error ? `<p class="modal__error" role="alert">${e(view.error)}</p>` : ""}
      ${s.step !== "2a" || formsReview ? contentHtml : ""}
      ${budgetComparisons(s)}</div>
      <footer class="studio-actions studio-footer" data-studio-step="${e(s.step)}">${s.pendingDecision && view.hideDecision ? button("Review paused research", "review-decision") : ""}
      ${canExport ? button("Export research", "export", { disabled: view.exporting, tooltip: "export a summary of the data uncovered during the research process in a JSON format appropriate for sending it to an AI for further discussion.", tooltipOptions: { align: "start" } }) : ""}
      ${view.busy && !recommending ? button("Pause research", "pause") : `${(step.optional || s.step === "4.4.4") && !stepComplete ? skipButton : ""}
      ${view.revisiting && s.steps[s.step]?.value && !s.steps[s.step].value.pending && !["1", "10a", "10b", "11", "12"].includes(s.step) ? button("Redo this step", "redo") : ""}
      ${s.step === "9" && s.assignmentReviewPending ? button("Retest meanings", "retest-meanings")
        : ["8", "9"].includes(s.step) && !s.pendingDecision ? runButton(s.steps[s.step]?.value?.complete ? s.step === "8" ? "Retest meanings" : "Retest entry" : view.error ? "Retry this step" : unfinished ? "Resume this step" : "Run this step", "run", { disabled: !entryNeedsRetest && !meaningNeedsRetest })
        : needsRun ? runButton(staleDictionary ? "Refresh dictionary research" : staleForms ? "Refresh forms research" : s.step === "2a" && s.formDiscovery ? "Retry search" : view.error ? "Retry this step" : unfinished ? "Resume this step" : "Run this step", "run") : ""}
      ${needsRun && continueDisabled ? "" : primaryButton(view.saving ? "Saving…" : s.step === "1" ? "Begin research" : s.step === "11" ? "Open term editor" : s.step === "12" ? s.status === "complete" ? "Return to glossary" : s.queue.some((q) => q.status === "queued") ? "Continue split-entry queue" : "Finish research" : "Save and continue", s.step === "12" && s.status === "complete" ? "studio:exit" : "studio:next", { disabled: continueDisabled })}`}
      </footer></section></div>`;
  }
  return pageShell({ title: s?.scope.term ? `Research: ${s.scope.term}` : "Glossary research studio",
    headerClass: "studio-page-header", bodyClass: s ? "page-body--studio" : "",
    navButtons: [actionNavButton("Glossary", "studio:exit", true, { isBack: true })], body, tools: "", leftTools: "", noticeText: "" }) + modal(s, view)
    + (state.glossaryTermEditor?.studioEntry ? renderGlossaryTermEditorModal(state) : "");
}
