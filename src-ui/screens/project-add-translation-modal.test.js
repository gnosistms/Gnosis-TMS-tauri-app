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
  assert.match(html, /data-action="submit-project-add-translation-paste" disabled/);
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

test("add translation progress modal shows completed total", () => {
  const html = renderProjectAddTranslationModal({
    projectAddTranslation: {
      isOpen: true,
      step: "aligning",
      progress: {
        stageLabel: "Summarizing sections",
        message: "Working",
        completed: 3,
        total: 10,
      },
      error: "",
    },
  });

  assert.match(html, /Summarizing sections/);
  assert.match(html, /Working 3 \/ 10/);
});
