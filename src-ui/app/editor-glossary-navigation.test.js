import test from "node:test";
import assert from "node:assert/strict";

import { resolveSelectedChapterGlossary } from "./project-context.js";
import { applyGlossaryEditorPayload } from "./glossary-shared.js";
import { resolveGlossaryEditorNavigationSource } from "./glossary-editor-navigation-source.js";
import { createGlossaryEditorState, state } from "./state.js";

function snapshotSharedState() {
  return {
    projects: state.projects,
    deletedProjects: state.deletedProjects,
    selectedGlossaryId: state.selectedGlossaryId,
    selectedChapterId: state.selectedChapterId,
    glossaries: state.glossaries,
    glossaryEditor: state.glossaryEditor,
  };
}

function restoreSharedState(snapshot) {
  state.projects = snapshot.projects;
  state.deletedProjects = snapshot.deletedProjects;
  state.selectedGlossaryId = snapshot.selectedGlossaryId;
  state.selectedChapterId = snapshot.selectedChapterId;
  state.glossaries = snapshot.glossaries;
  state.glossaryEditor = snapshot.glossaryEditor;
}

test("resolveSelectedChapterGlossary returns the linked glossary for the active file", () => {
  const snapshot = snapshotSharedState();

  try {
    state.selectedChapterId = "chapter-2";
    state.projects = [{
      id: "project-1",
      chapters: [
        {
          id: "chapter-1",
          linkedGlossary: {
            glossaryId: "glossary-1",
            repoName: "fixture/glossary-1",
          },
        },
        {
          id: "chapter-2",
          linkedGlossary: {
            glossaryId: "glossary-2",
            repoName: "fixture/glossary-2",
          },
        },
      ],
    }];
    state.deletedProjects = [];
    state.glossaries = [
      { id: "glossary-1", repoName: "fixture/glossary-1", title: "Glossary One" },
      { id: "glossary-2", repoName: "fixture/glossary-2", title: "Glossary Two" },
    ];

    assert.equal(resolveSelectedChapterGlossary()?.id, "glossary-2");
  } finally {
    restoreSharedState(snapshot);
  }
});

test("applyGlossaryEditorPayload preserves editor-origin navigation state", () => {
  const snapshot = snapshotSharedState();

  try {
    state.glossaries = [
      { id: "glossary-1", repoName: "fixture/glossary-1", title: "Glossary One" },
    ];
    state.glossaryEditor = {
      ...createGlossaryEditorState(),
      status: "loading",
      navigationSource: "editor",
      glossaryId: "glossary-1",
      repoName: "fixture/glossary-1",
      title: "Glossary One",
    };

    applyGlossaryEditorPayload({
      glossaryId: "glossary-1",
      title: "Glossary One",
      sourceLanguage: { code: "en", name: "English" },
      targetLanguage: { code: "es", name: "Spanish" },
      termCount: 1,
      terms: [
        {
          termId: "term-1",
          sourceTerms: ["alpha"],
          targetTerms: ["alfa"],
        },
      ],
    });

    assert.equal(state.glossaryEditor.navigationSource, "editor");
    assert.equal(state.glossaryEditor.status, "ready");
    assert.equal(state.glossaryEditor.terms[0]?.termId, "term-1");
  } finally {
    restoreSharedState(snapshot);
  }
});

test("resolveGlossaryEditorNavigationSource clears editor-origin navigation when explicitly opened normally", () => {
  assert.equal(
    resolveGlossaryEditorNavigationSource({ navigationSource: null }, "editor"),
    null,
  );
  assert.equal(
    resolveGlossaryEditorNavigationSource({}, "editor"),
    "editor",
  );
  assert.equal(
    resolveGlossaryEditorNavigationSource({ navigationSource: "editor" }, null),
    "editor",
  );
});
