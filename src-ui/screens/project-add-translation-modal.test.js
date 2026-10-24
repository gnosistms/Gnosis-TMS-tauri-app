import test from "node:test";
import assert from "node:assert/strict";

import { renderProjectAddTranslationModal } from "./project-add-translation-modal.js";

test("add translation input modal defaults to upload with supported formats", () => {
  const html = renderProjectAddTranslationModal({
    projectAddTranslation: {
      isOpen: true,
      step: "input",
      inputMode: "upload",
      pastedText: "",
      error: "",
    },
  });

  assert.match(html, /ADD TRANSLATIONS/);
  assert.match(html, /Add translation text/);
  assert.match(html, /select-project-add-translation-input-mode:upload/);
  assert.match(html, /select-project-add-translation-input-mode:pasteLink/);
  assert.match(html, /select-project-add-translation-input-mode:pasteText/);
  assert.match(html, /data-project-add-translation-dropzone/);
  assert.match(html, /\.txt, \.docx, \.rtf, or \.srt/);
  assert.match(html, /existing chapter keeps its formatting and timing/);
  assert.match(html, /data-action="select-project-add-translation-file"[^>]*>Select file<\/button>/);
});

test("subtitle chapters show only SRT upload even with a stale paste mode", () => {
  for (const inputMode of ["upload", "pasteLink", "pasteText"]) {
    const html = renderProjectAddTranslationModal({
      projectAddTranslation: { isOpen: true, step: "input", requiresSrtFile: true, inputMode },
    });
    assert.match(html, /Add subtitle translation/);
    assert.match(html, /Drop one SRT file/);
    assert.match(html, /valid \.srt file is required/);
    assert.match(html, /data-action="select-project-add-translation-file"[^>]*>Select file<\/button>/);
    assert.doesNotMatch(html, /select-project-add-translation-input-mode|submit-project-add-translation-(paste|link)|data-project-add-translation-(textarea|link-input)|\.txt|\.docx|\.rtf/);
  }
});

test("add translation paste mode renders requested copy", () => {
  const html = renderProjectAddTranslationModal({
    projectAddTranslation: {
      isOpen: true,
      step: "input",
      inputMode: "pasteText",
      pastedText: "",
      error: "",
    },
  });

  assert.match(html, /placeholder="Paste your translation here\."/);
  assert.match(html, /data-action="submit-project-add-translation-paste"[^>]*disabled[\s\S]*>Continue<\/button>/);
});

test("add translation paste modal enables Continue after text is pasted", () => {
  const html = renderProjectAddTranslationModal({
    projectAddTranslation: {
      isOpen: true,
      step: "input",
      inputMode: "pasteText",
      pastedText: "Translated text",
      error: "",
    },
  });

  assert.match(html, /data-action="submit-project-add-translation-paste"[^>]*>Continue<\/button>/);
  assert.doesNotMatch(html, /data-action="submit-project-add-translation-paste" disabled/);
});

test("add translation link mode only advertises Google Docs", () => {
  const html = renderProjectAddTranslationModal({
    projectAddTranslation: {
      isOpen: true,
      step: "input",
      inputMode: "pasteLink",
      linkUrl: "https://docs.google.com/document/d/example/edit",
      error: "",
    },
  });

  assert.match(html, /Paste a public Google Docs link here/);
  assert.match(html, /data-project-add-translation-link-input/);
  assert.match(html, /data-action="submit-project-add-translation-link"[^>]*>Continue<\/button>/);
  assert.doesNotMatch(html, /Google Sheets/);
});

test("add translation language modal disables Continue until selection", () => {
  const html = renderProjectAddTranslationModal({
    projectAddTranslation: {
      isOpen: true,
      step: "selectLanguage",
      targetLanguageCode: "",
      error: "",
    },
  });

  assert.match(html, /class="language-picker-modal__list-frame"[\s\S]*data-project-add-translation-language-list/);
  assert.match(html, /data-action="continue-project-add-translation-language"[^>]*disabled/);
  assert.match(html, /data-action="cancel-project-add-translation"/);
});

test("add translation language modal enables Continue after selection", () => {
  const html = renderProjectAddTranslationModal({
    projectAddTranslation: {
      isOpen: true,
      step: "selectLanguage",
      targetLanguageCode: "vi",
      error: "",
    },
  });

  assert.match(html, /class="language-picker-modal__option is-selected"[\s\S]*data-action="select-project-add-translation-language:vi"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /data-action="continue-project-add-translation-language"[^>]*>Continue<\/button>/);
});

test("add translation language modal uses translation language actions", () => {
  const html = renderProjectAddTranslationModal({
    projectAddTranslation: {
      isOpen: true,
      step: "selectLanguage",
      targetLanguageCode: "vi",
      error: "",
    },
  });

  assert.match(html, /TRANSLATION LANGUAGE/);
  assert.match(html, /What language is this translation\?/);
  assert.match(html, /data-action="select-project-add-translation-language:vi"/);
  assert.doesNotMatch(html, /select-project-import-source-language/);
  assert.doesNotMatch(html, /data-action="continue-project-add-translation-language" disabled/);
});

test("add translation warning modals render requested actions", () => {
  const existing = renderProjectAddTranslationModal({
    projectAddTranslation: {
      isOpen: true,
      step: "existingTranslationWarning",
      error: "",
    },
  });
  assert.match(existing, /EXISTING TRANSLATIONS/);
  assert.match(existing, /This language already has translation text/);
  assert.match(existing, /data-action="continue-project-add-translation-existing"/);

  const mismatch = renderProjectAddTranslationModal({
    projectAddTranslation: {
      isOpen: true,
      step: "mismatchWarning",
      error: "",
    },
  });
  assert.match(mismatch, /TEXT MISMATCH/);
  assert.match(mismatch, /Inserted text does not match well/);
  assert.match(mismatch, /data-action="continue-project-add-translation-mismatch"/);
});

test("add translation progress modal shows full staged progress", () => {
  const html = renderProjectAddTranslationModal({
    projectAddTranslation: {
      isOpen: true,
      step: "aligning",
      flow: "multi",
      progress: {
        stageId: "row_alignment",
        stageLabel: "Summarizing sections",
        message: "Working",
        completed: 2,
        total: 4,
        percent: 50,
      },
      error: "",
    },
  });

  assert.match(html, /Aligning and inserting/);
  assert.match(html, /Please wait/);
  assert.match(html, /Aligning your translation text with this file\. This may take a few minutes\./);
  assert.match(html, /Preparing text units/);
  assert.match(html, /Summarizing sections/);
  assert.match(html, /Finding section matches/);
  assert.match(html, /Choosing the best matches/);
  assert.match(html, /Aligning paragraphs/);
  assert.match(html, /Resolving conflicts/);
  assert.match(html, /Splitting combined target rows/);
  assert.match(html, /Final checks/);
  assert.match(html, /Applying translation/);
  assert.match(html, /aria-label="Preparing text units"[\s\S]*aria-valuenow="100"/);
  assert.match(html, /aria-label="Aligning paragraphs"[\s\S]*aria-valuenow="50"/);
  assert.match(html, /aria-label="Applying translation"[\s\S]*aria-valuenow="0"/);
  assert.match(html, /Working 2 \/ 4/);
  assert.match(html, /<div class="modal__actions">\s*<button[^>]*data-action="cancel-project-add-translation"[^>]*data-modal-cancel[^>]*>Cancel<\/button>/);
});

test("alignment cancellation is pending until confirmed and disabled during local save", () => {
  for (const modal of [
    { step: "aligning", status: "canceling", progress: { stageId: "row_alignment" } },
    { step: "applying", status: "running", progress: { stageId: "apply" } },
  ]) {
    const html = renderProjectAddTranslationModal({ projectAddTranslation: { isOpen: true, ...modal } });
    assert.match(html, /data-action="cancel-project-add-translation"[^>]*disabled/);
    if (modal.status === "canceling") assert.match(html, />Canceling\.\.\.<\/button>/);
  }
});

test("subtitle progress displays timestamp matching and insertion with Cancel and no AI stages", () => {
  const html = renderProjectAddTranslationModal({ projectAddTranslation: {
    isOpen: true, step: "aligning", status: "running", flow: "subtitle",
    progress: { stageId: "match_timestamps", status: "running", completed: 0, total: 279 },
  } });
  assert.match(html, /Matching exact start times and inserting unmatched subtitles in time order/);
  assert.match(html, /Checking SRT format/);
  assert.match(html, /Matching start times/);
  assert.match(html, /data-action="cancel-project-add-translation"/);
  assert.doesNotMatch(html, /Summarizing|Finding section|Aligning paragraphs|Splitting combined|few minutes/);
});

test("subtitle mismatch warning reports incoming percentage and new rows with Cancel focused", () => {
  const html = renderProjectAddTranslationModal({ projectAddTranslation: {
    isOpen: true, step: "mismatchWarning", flow: "subtitle",
    subtitleMismatch: { unmatchedCount: 222, totalCount: 279, unmatchedPercent: 222 / 279 * 100, confirmation: "plan-1" },
  } });
  assert.match(html, /79\.57%/);
  assert.match(html, /there is no subtitle in the original file that starts at the same time/);
  assert.match(html, /lose the timing data in the new file/);
  assert.match(html, /Do you want to try it anyway/);
  assert.match(html, /data-action="cancel-project-add-translation"[^>]*data-modal-cancel[^>]*data-modal-initial-focus/);
  assert.match(html, /data-action="continue-project-add-translation-mismatch"[^>]*>Continue/);
  assert.doesNotMatch(html, /data-modal-default|TEXT MISMATCH|pasted text/);
});

test("loose subtitle matching warning uses its own percentage and Continue action", () => {
  const html = renderProjectAddTranslationModal({ projectAddTranslation: {
    isOpen: true, step: "mismatchWarning", subtitleMismatch: { stage: "overlap", unmatchedPercent: 10.5, confirmation: "overlap-plan" },
  } });
  assert.match(html, /Even with this looser matching criteria, 10\.5% of your new subtitles still didn&#39;t match up with the original file/);
  assert.match(html, /This will be a messy match\. Do you still want to continue/);
  assert.match(html, />Continue<\/button>/);
  assert.doesNotMatch(html, /Save \(not recommended\)/);
});

test("meaning warning shows every rejected original/new pair safely and requires explicit risky save", () => {
  const examples = Array.from({ length: 7 }, (_, i) => ({ sourceLine: i + 10, targetLine: i + 20, sourceText: `Old <script>${i}</script>`, targetText: `New ${i}` }));
  const html = renderProjectAddTranslationModal({ projectAddTranslation: {
    isOpen: true, step: "mismatchWarning", subtitleMismatch: { stage: "meaning", unmatchedPercent: 35, examples, confirmation: "meaning-plan" },
  } });
  for (const pair of examples) {
    assert.match(html, new RegExp(`Original subtitle ${pair.sourceLine}:`));
    assert.match(html, new RegExp(`New subtitle ${pair.targetLine}:`));
  }
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|data-modal-default/);
  assert.match(html, /We recommend you cancel the alignment procedure and re-examine your subtitles/);
  assert.match(html, />Save \(not recommended\)<\/button>/);
  assert.match(html, /data-action="cancel-project-add-translation"[^>]*data-modal-initial-focus/);
});

test("add translation progress modal shows single-block staged progress", () => {
  const html = renderProjectAddTranslationModal({
    projectAddTranslation: {
      isOpen: true,
      step: "aligning",
      flow: "single",
      progress: {
        stageId: "row_alignment",
        status: "running",
        stageLabel: "Aligning translation",
        message: "Aligning your translation",
        completed: 0,
        total: 1,
        percent: 0,
      },
      error: "",
    },
  });

  assert.match(html, /Preparing text/);
  assert.match(html, /Aligning translation/);
  assert.match(html, /Applying translation/);
  assert.doesNotMatch(html, /Preparing text units/);
  assert.doesNotMatch(html, /Summarizing sections/);
  assert.doesNotMatch(html, /Finding section matches/);
  assert.doesNotMatch(html, /Choosing the best matches/);
  assert.match(html, /add-translation-progress__step--indeterminate/);
  assert.match(html, /aria-label="Aligning translation"[\s\S]*aria-valuenow="0"/);
  assert.match(html, /class="add-translation-progress__bar-fill"><\/span>/);
});

test("add translation progress modal treats cached preflight as aligned", () => {
  const html = renderProjectAddTranslationModal({
    projectAddTranslation: {
      isOpen: true,
      step: "applying",
      flow: "multi",
      progress: {
        stageId: "preflight",
        status: "complete",
        message: "Loaded cached alignment preflight",
        completed: 1,
        total: 1,
      },
      error: "",
    },
  });

  assert.match(html, /aria-label="Final checks"[\s\S]*aria-valuenow="100"/);
  assert.match(html, /aria-label="Applying translation"[\s\S]*aria-valuenow="0"/);
});


test("apply errors provide retry and keyboard cancel without a busy dialog", () => {
  for (const [kind, label] of [["retry", "Retry"], ["sourceChanged", "Restart alignment"]]) {
    const html = renderProjectAddTranslationModal({ projectAddTranslation: {
      isOpen: true, step: "applyError", status: "idle", applyErrorKind: kind, error: "Could not save.",
    } });
    assert.match(html, /Translation could not be applied/);
    assert.match(html, /data-action="retry-project-add-translation-apply"/);
    assert.ok(html.includes(label));
    assert.doesNotMatch(html, /data-action="edit-project-add-translation-text"/);
    assert.match(html, /data-modal-cancel/);
    assert.doesNotMatch(html, /aria-busy="true"|Please wait/);
  }
});

test("preflight split failures preserve the error without suggesting text edits", () => {
  const html = renderProjectAddTranslationModal({ projectAddTranslation: {
    isOpen: true, step: "selectLanguage", targetLanguageCode: "vi", error: "Paragraph 2 could not be split safely.",
  } });
  assert.match(html, /Paragraph 2 could not be split safely/);
  assert.doesNotMatch(html, /data-action="edit-project-add-translation-text"/);
});
