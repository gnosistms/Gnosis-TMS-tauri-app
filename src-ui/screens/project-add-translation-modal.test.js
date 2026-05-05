import test from "node:test";
import assert from "node:assert/strict";

import { renderProjectAddTranslationModal } from "./project-add-translation-modal.js";

test("add translation paste modal renders requested copy", () => {
  const html = renderProjectAddTranslationModal({
    projectAddTranslation: {
      isOpen: true,
      step: "pasteText",
      pastedText: "",
      error: "",
    },
  });

  assert.match(html, /Add translations/);
  assert.match(html, /Paste your translation/);
  assert.match(html, /Paste your translation text for the entire file into the box below/);
  assert.match(html, /placeholder="Paste your translation here\."/);
  assert.match(html, /data-action="submit-project-add-translation-paste" disabled[\s\S]*>Continue<\/button>/);
});

test("add translation paste modal enables Continue after text is pasted", () => {
  const html = renderProjectAddTranslationModal({
    projectAddTranslation: {
      isOpen: true,
      step: "pasteText",
      pastedText: "Translated text",
      error: "",
    },
  });

  assert.match(html, /data-action="submit-project-add-translation-paste">Continue<\/button>/);
  assert.doesNotMatch(html, /data-action="submit-project-add-translation-paste" disabled/);
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

  assert.match(html, /data-project-add-translation-language-list/);
  assert.match(html, /data-action="continue-project-add-translation-language" disabled/);
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
  assert.match(html, /data-action="continue-project-add-translation-language">Continue<\/button>/);
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
  assert.match(html, /What language did you paste\?/);
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
  assert.match(html, /Preparing text units/);
  assert.match(html, /Summarizing sections/);
  assert.match(html, /Finding section matches/);
  assert.match(html, /Selecting section corridor/);
  assert.match(html, /Aligning rows inside matched sections/);
  assert.match(html, /Resolving conflicts/);
  assert.match(html, /Splitting combined target rows/);
  assert.match(html, /Final checks/);
  assert.match(html, /Applying translation/);
  assert.match(html, /aria-label="Preparing text units"[\s\S]*aria-valuenow="100"/);
  assert.match(html, /aria-label="Aligning rows inside matched sections"[\s\S]*aria-valuenow="50"/);
  assert.match(html, /aria-label="Applying translation"[\s\S]*aria-valuenow="0"/);
  assert.match(html, /Working 2 \/ 4/);
});

test("add translation progress modal treats cached preflight as aligned", () => {
  const html = renderProjectAddTranslationModal({
    projectAddTranslation: {
      isOpen: true,
      step: "applying",
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
