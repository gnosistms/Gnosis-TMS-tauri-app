import test from "node:test";
import assert from "node:assert/strict";

const { createGlossaryEditorState, resetSessionState, state } = await import("../app/state.js");
const { renderGlossaryEditorScreen } = await import("./glossary-editor.js");

function installGlossaryEditorFixture({ searchQuery = "", terms, canManageProjects = true } = {}) {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.selectedGlossaryId = "glossary-1";
  state.teams = [
    {
      id: "team-1",
      canManageProjects,
      githubOrg: "fixture-org",
    },
  ];
  state.glossaryEditor = {
    ...createGlossaryEditorState(),
    status: "ready",
    glossaryId: "glossary-1",
    title: "Fixture Glossary",
    sourceLanguage: { code: "ja", name: "Japanese" },
    targetLanguage: { code: "en", name: "English" },
    searchQuery,
    terms: terms ?? [
      {
        termId: "term-1",
        sourceTerms: ["alpha"],
        targetTerms: ["beta"],
        notesToTranslators: "",
        footnote: "",
      },
    ],
  };
}

test.afterEach(() => {
  resetSessionState();
});

test("glossary editor renders clickable term rows with separate delete actions", () => {
  installGlossaryEditorFixture();

  const html = renderGlossaryEditorScreen(state);

  assert.match(html, /term-grid--row term-grid--row--interactive/);
  assert.match(html, /<div class="term-grid term-grid--row[^"]*"[^>]*data-action="edit-glossary-term:term-1"/);
  assert.match(html, /data-action="delete-glossary-term:term-1"/);
});

test("glossary editor only shows row edit affordances when the selected team can manage projects", () => {
  installGlossaryEditorFixture({ canManageProjects: false });

  const lockedHtml = renderGlossaryEditorScreen(state);

  assert.doesNotMatch(lockedHtml, /term-grid--row--interactive/);
  assert.doesNotMatch(lockedHtml, /data-action="edit-glossary-term:term-1"/);
  assert.doesNotMatch(lockedHtml, /data-action="delete-glossary-term:term-1"/);

  state.teams[0].canManageProjects = true;

  const unlockedHtml = renderGlossaryEditorScreen(state);

  assert.match(unlockedHtml, /term-grid--row term-grid--row--interactive/);
  assert.match(unlockedHtml, /data-action="edit-glossary-term:term-1"/);
  assert.match(unlockedHtml, /data-action="delete-glossary-term:term-1"/);
});

test("glossary editor search matches ruby visible text and renders ruby markup", () => {
  installGlossaryEditorFixture({
    searchQuery: "かんじ",
    terms: [
      {
        termId: "term-1",
        sourceTerms: ["<ruby>漢字<rt>かんじ</rt></ruby>"],
        targetTerms: ["kanji"],
        notesToTranslators: "",
        footnote: "",
      },
    ],
  });

  const html = renderGlossaryEditorScreen(state);

  assert.match(html, /<ruby>漢字<rt>かんじ<\/rt><\/ruby>/);
  assert.doesNotMatch(html, /No terms match this search\./);
  assert.doesNotMatch(html, /&lt;ruby&gt;/);
});
