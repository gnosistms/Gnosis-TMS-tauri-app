import { state } from "./state.js";
import { invoke } from "./runtime.js";
import { srtGroupingEnabled, srtGroupForRow, combineSrtRows } from "./editor-srt-grouping.js";
import { beginSrtGroupEdit, updateSrtGroupDraft, pendingSrtGroupEdits } from "./editor-srt-group-edit-flow.js";
import { composeSrtGroupText } from "./editor-srt-group-text.js";
import { ensureEditorAiTranslateProviderReady } from "./editor-ai-translate-flow.js";
import { buildEditorAiReviewBatchRequest } from "./editor-ai-review-request.js";
import { buildEditorAiTranslationGlossaryHints, buildEditorDerivedGlossaryModel } from "./editor-glossary-highlighting.js";
import { resolveEditorDerivedGlossaryUsage } from "./editor-derived-glossary-flow.js";
import { applyStoredSelectedTeamAiActionPreferences, ensureSharedAiActionConfigurationLoaded, resolveAiReviewProviderAndModel, openAiReviewMissingKeyModal } from "./ai-settings-flow.js";
import { ensureSelectedTeamAiProviderReady } from "./team-ai-flow.js";
import { selectedProjectsTeamInstallationId } from "./project-context.js";
import { editorFootnotesPlainText } from "./editor-utils.js";
import { editorFootnoteMarkerSequencesEqual, mergeEditorFootnoteCorrections, serializeEditorFootnotesForLegacy } from "./editor-footnotes.js";
import { applyEditorAiReviewLoading, applyEditorAiReviewLoaded, applyEditorAiReviewFailed } from "./editor-ai-review-state.js";
import { logEditorAssistantTranslationDraft } from "./editor-ai-assistant-flow.js";
import { loadEditorAiReviewQaHints } from "./editor-ai-qa.js";
import { buildBatchSourceContext } from "./editor-ai-context-window.js";
import { showNoticeBadge } from "./status-feedback.js";
import { srtGroupSnapshot, validSrtGroupAiResults } from "./editor-srt-group-ai.js";

async function groupHints(chapter, combined, source, target, provider) {
  const context = { chapterState: chapter, chapterId: chapter.chapterId, projectId: chapter.projectId,
    row: combined, rowId: combined.rowId, sourceLanguage: source, targetLanguage: target,
    sourceLanguageCode: source.code, targetLanguageCode: target.code,
    sourceText: combined.fields[source.code], sourceLanguageLabel: source.name, targetLanguageLabel: target.name };
  const derived = resolveEditorDerivedGlossaryUsage(context, { useCurrentGlossarySourceText: true });
  let matcher = chapter.glossary?.matcherModel;
  if (derived.kind === "derived") {
    let pivotText = derived.preparationGlossarySourceText;
    if (!pivotText.trim()) {
      const pivot = await invoke("run_ai_translation", { request: { ...provider,
        installationId: selectedProjectsTeamInstallationId(), text: context.sourceText,
        sourceLanguage: source.name, targetLanguage: derived.glossarySourceLanguageLabel } });
      pivotText = pivot.translatedText ?? "";
    }
    const payload = await invoke("prepare_editor_ai_translated_glossary", { request: {
      ...provider, installationId: selectedProjectsTeamInstallationId(),
      translationSourceText: context.sourceText, translationSourceLanguage: source.name,
      glossarySourceLanguage: derived.glossarySourceLanguageLabel, targetLanguage: target.name,
      glossarySourceText: pivotText, glossaryTerms: derived.glossaryTerms,
    } });
    matcher = buildEditorDerivedGlossaryModel({ sourceLanguage: source, targetLanguage: target, entries: payload.entries ?? [] });
    if (state.editorChapter?.chapterId === chapter.chapterId) state.editorChapter = {
      ...state.editorChapter, srtGroupGlossaries: { ...state.editorChapter.srtGroupGlossaries,
        [combined.srtGroup.key]: { fields: combined.fields, matcherModel: matcher, glossaryModel: chapter.glossary?.matcherModel, sourceCode: source.code, pivotCode: derived.glossarySourceLanguageCode } },
    };
  }
  return buildEditorAiTranslationGlossaryHints(combined.fields[source.code], source.baseCode ?? source.code,
    target.baseCode ?? target.code, matcher);
}

export async function runSrtGroupAi(render, kind, actionId, operations) {
  let chapter = state.editorChapter;
  if (!srtGroupingEnabled(chapter)) return false;
  let members = srtGroupForRow(chapter, chapter.activeRowId);
  if (members.length < 2) return false;
  if (state.offline?.isEnabled) { showNoticeBadge("This operation is not supported in offline mode", render); return true; }
  if (chapter.srtAiOperation?.status === "loading") return true;
  if (!(await operations.flushDirtyEditorRows(render))) return true;
  chapter = state.editorChapter;
  members = srtGroupForRow(chapter, chapter.activeRowId);
  const source = chapter.languages.find((language) => language.code === chapter.selectedSourceLanguageCode);
  const targetCode = kind === "translate" ? chapter.selectedTargetLanguageCode : chapter.activeLanguageCode;
  const target = chapter.languages.find((language) => language.code === targetCode);
  if (!source || !target || (kind !== "grammar" && source.code === target.code)) {
    showNoticeBadge("Select a target language to run this action.", render);
    return true;
  }
  const combined = combineSrtRows(members, chapter.languages, chapter);
  const captured = srtGroupSnapshot(members);
  const first = members[0].rowId;
  const requestKey = `${first}:${Date.now()}`;
  const edit = beginSrtGroupEdit(first, target.code);
  if (!edit) return true;
  const originalText = edit.draft;
  const footnote = editorFootnotesPlainText(members[0].footnotes?.[target.code]);
  const caption = members[0].imageCaptions?.[target.code] ?? "";
  const current = () => state.editorChapter?.chapterId === chapter.chapterId
    && srtGroupingEnabled(state.editorChapter)
    && state.editorChapter.selectedSourceLanguageCode === source.code
    && (kind === "translate" ? state.editorChapter.selectedTargetLanguageCode : state.editorChapter.activeLanguageCode) === target.code
    && state.editorChapter.glossary?.matcherModel === chapter.glossary?.matcherModel
    && srtGroupSnapshot(srtGroupForRow(state.editorChapter, first)) === captured
    && pendingSrtGroupEdits(state.editorChapter).length === 0;
  state.editorChapter = { ...state.editorChapter, activeRowId: first, srtGroupReview: null,
    srtAiOperation: { status: "loading", rowId: first, requestKey } };
  if (kind !== "translate") state.editorChapter = applyEditorAiReviewLoading(state.editorChapter, first, target.code, requestKey, originalText, footnote, caption, kind);
  render?.({ scope: "translate-sidebar" });
  try {
    let provider;
    if (kind === "translate") {
      const ready = await ensureEditorAiTranslateProviderReady(render, actionId);
      if (!ready.ok) throw new Error(ready.error || "Configure the AI translation provider before translating.");
      provider = { providerId: ready.providerId, modelId: ready.modelId };
    } else {
      applyStoredSelectedTeamAiActionPreferences(render);
      await ensureSharedAiActionConfigurationLoaded(render);
      provider = resolveAiReviewProviderAndModel();
      if (!(await ensureSelectedTeamAiProviderReady(render, provider.providerId))?.ok) {
        openAiReviewMissingKeyModal();
        return true;
      }
    }
    const hints = kind === "grammar" ? [] : await groupHints(chapter, combined, source, target, provider);
    const results = [];
    let promptText = "";
    // Bound requests, but validate the entire captured sentence before applying.
    for (let offset = 0; offset < members.length; offset += 30) {
      if (!current()) throw new Error("The sentence changed while AI was running. Run the action again.");
      const rows = members.slice(offset, offset + 30);
      let request;
      if (kind === "translate") {
        request = { ...provider, installationId: selectedProjectsTeamInstallationId(),
          sourceLanguage: source.name, targetLanguage: target.name,
          sourceLanguageCode: source.code, targetLanguageCode: target.code,
          glossaryHints: hints, subtitleCues: true, sentenceGroup: true,
          sentenceSourceText: combined.fields[source.code],
          ...buildBatchSourceContext(chapter, rows[0].rowId, rows.at(-1).rowId, source.code, target.code),
          rows: rows.map((row) => ({ rowId: row.rowId, sourceText: row.fields[source.code] ?? "",
            sourceFootnote: editorFootnotesPlainText(row.footnotes?.[source.code]),
            sourceImageCaption: row.imageCaptions?.[source.code] ?? "",
            targetFootnote: editorFootnotesPlainText(row.footnotes?.[target.code]),
            targetImageCaption: row.imageCaptions?.[target.code] ?? "" })),
        };
      } else {
        const qaHintsByRowId = await loadEditorAiReviewQaHints({ targetLanguageCode: target.code,
          rows: rows.map((row) => ({ rowId: row.rowId, text: row.fields[target.code] ?? "", footnote: editorFootnotesPlainText(row.footnotes?.[target.code]), imageCaption: row.imageCaptions?.[target.code] ?? "" })) });
        request = buildEditorAiReviewBatchRequest({ chapterState: chapter, rows, sourceLanguageCode: source.code,
          targetLanguageCode: target.code, ...provider, reviewMode: kind,
          qaHintsByRowId, installationId: selectedProjectsTeamInstallationId() });
        request.glossaryHints = hints;
        request.subtitleCues = true;
        request.sentenceGroup = true;
        request.sentenceSourceText = combined.fields[source.code];
        request.sentenceTargetText = combined.fields[target.code];
      }
      const payload = await invoke(kind === "translate" ? "run_ai_translation_batch" : "run_ai_review_batch", { request });
      if (!validSrtGroupAiResults(rows, payload, kind)) throw new Error("AI did not return every subtitle exactly once. Nothing was applied; retry the group.");
      results.push(...rows.map((row) => payload.rows.find((result) => result.rowId === row.rowId)));
      promptText += payload.promptText ?? "";
    }
    if (!current()) throw new Error("The sentence changed while AI was running. Nothing was applied.");
    if (kind === "translate") {
      const text = composeSrtGroupText(results.map((result) => result.translatedText ?? ""), edit.markers);
      if (members.some((row) => String(row.fields[target.code] ?? "").trim())) {
        logEditorAssistantTranslationDraft({ rowId: first, sourceLanguageCode: source.code, targetLanguageCode: target.code,
          sourceLanguageLabel: source.name, targetLanguageLabel: target.name, ...provider,
          sourceText: combined.fields[source.code], targetText: combined.fields[target.code],
          draftTranslationText: text, promptText, summary: "Sentence translation draft",
          srtGroupDraft: { memberRowIds: edit.memberRowIds, markers: edit.markers, results, captured, sourceCode: source.code, targetCode: target.code },
        });
        state.editorChapter = { ...state.editorChapter, sidebarTab: "assistant" };
      } else {
        updateSrtGroupDraft(first, target.code, text, { forceSave: true });
        for (const [index, result] of results.entries()) {
          if (result.translatedFootnote) operations.updateEditorRowFieldValue(members[index].rowId, target.code, result.translatedFootnote, "footnote");
          if (result.translatedImageCaption) operations.updateEditorRowFieldValue(members[index].rowId, target.code, result.translatedImageCaption, "image-caption");
        }
        await operations.flushDirtyEditorRows(render);
      }
    } else {
      for (const [index, result] of results.entries()) {
        if (result.suggestedText && !editorFootnoteMarkerSequencesEqual(members[index].fields[target.code] ?? "", result.suggestedText)) throw new Error("AI changed footnote markers. Nothing was applied.");
      }
      const suggested = composeSrtGroupText(results.map((result) => result.suggestedText), edit.markers);
      state.editorChapter = applyEditorAiReviewLoaded(state.editorChapter, first, target.code, requestKey,
        originalText, footnote, caption, suggested, "", [], "", promptText, kind, results.every((result) => result.reviewed));
      state.editorChapter = { ...state.editorChapter, srtGroupReview: { first, sourceCode: source.code, targetCode: target.code, memberRowIds: edit.memberRowIds, captured, results } };
    }
    render?.({ scope: "translate-body" });
  } catch (error) {
    if (state.editorChapter?.chapterId === chapter.chapterId && kind !== "translate") state.editorChapter = applyEditorAiReviewFailed(state.editorChapter, first, target.code, requestKey, originalText, error.message, footnote, caption);
    showNoticeBadge(error?.message ?? String(error), render);
  } finally {
    if (state.editorChapter?.chapterId === chapter.chapterId && state.editorChapter.srtAiOperation?.requestKey === requestKey) {
      const edits = { ...state.editorChapter.srtGroupEdits };
      for (const entry of Object.values(edits)) {
        if (!entry.forceSave && entry.draft === entry.savedDraft && (state.editorChapter.mainFieldEditor?.rowId !== entry.firstRowId
          || state.editorChapter.mainFieldEditor?.languageCode !== entry.languageCode)) delete edits[entry.key];
      }
      state.editorChapter = { ...state.editorChapter, srtAiOperation: null, srtGroupEdits: edits };
    }
    render?.({ scope: "translate-sidebar" });
  }
  return true;
}

export async function applySrtGroupReview(render, operations) {
  const review = state.editorChapter?.srtGroupReview;
  if (!srtGroupingEnabled(state.editorChapter) || !review || !review.memberRowIds.includes(state.editorChapter.activeRowId)) return false;
  const members = srtGroupForRow(state.editorChapter, review.first);
  if (state.editorChapter.selectedSourceLanguageCode !== review.sourceCode
    || srtGroupSnapshot(members) !== review.captured || pendingSrtGroupEdits(state.editorChapter).length) { showNoticeBadge("The sentence changed. Review it again before applying.", render); return true; }
  const edit = beginSrtGroupEdit(review.first, review.targetCode);
  const corrections = review.results.map((result, index) => mergeEditorFootnoteCorrections(members[index].footnotes?.[review.targetCode], result.suggestedFootnotes ?? []));
  if (corrections.some((result) => !result.ok)) { showNoticeBadge("AI changed footnote markers. Nothing was applied.", render); return true; }
  if (!edit) return true;
  updateSrtGroupDraft(review.first, review.targetCode, composeSrtGroupText(review.results.map((result) => result.suggestedText), edit.markers), { forceSave: true });
  for (const [index, result] of review.results.entries()) {
    if (result.suggestedFootnotes?.length) operations.updateEditorRowFieldValue(members[index].rowId, review.targetCode, serializeEditorFootnotesForLegacy(corrections[index].footnotes), "footnote");
    if (result.suggestedImageCaption) operations.updateEditorRowFieldValue(members[index].rowId, review.targetCode, result.suggestedImageCaption, "image-caption");
  }
  if (await operations.flushDirtyEditorRows(render)) state.editorChapter = { ...state.editorChapter, srtGroupReview: null };
  render?.({ scope: "translate-body" });
  return true;
}
