import test from "node:test";
import assert from "node:assert/strict";

import {
  applyEditorDerivedGlossaryEntries,
  applyEditorDerivedGlossaryEntry,
  buildEditorDerivedGlossaryContext,
  buildEditorGlossaryRevisionKey,
  editorDerivedGlossaryIsStale,
  editorDerivedGlossaryMatchesContext,
  hydrateEditorDerivedGlossaryEntryState,
  resolveHighlightableEditorDerivedGlossaryEntry,
  resolveEditorDerivedGlossaryEntry,
  resolveEditorDerivedGlossarySourceText,
  refreshEditorDerivedGlossaryMetadata,
} from "./editor-derived-glossary-state.js";

function readyDerivedEntry(overrides = {}) {
  return {
    status: "ready",
    error: "",
    requestKey: "req-1",
    translationSourceLanguageCode: "en",
    glossarySourceLanguageCode: "es",
    targetLanguageCode: "vi",
    translationSourceText: "The inner chamber glows.",
    glossarySourceText: "La camara interior brilla.",
    glossarySourceTextOrigin: "generated",
    glossaryRevisionKey: "rev-1",
    entries: [],
    matcherModel: { sourceLanguage: { code: "en" }, targetLanguage: { code: "vi" } },
    ...overrides,
  };
}

function metadataRefreshFixture() {
  const glossary = {
    glossaryId: "g", repoName: "g", sourceLanguage: { code: "es" }, targetLanguage: { code: "vi" },
    terms: [{ termId: "term-1", sourceTerms: ["camara"], targetTerms: ["buong"],
      footnote: "old footnote", notesToTranslators: "old note", targetVariantNotes: ["old variant"] }],
  };
  const languages = [{ code: "en" }, { code: "es" }, { code: "vi" }];
  const entry = hydrateEditorDerivedGlossaryEntryState(readyDerivedEntry({
    translationSourceText: "chamber", glossarySourceText: "camara", glossarySourceTextOrigin: "row",
    glossaryRevisionKey: buildEditorGlossaryRevisionKey(glossary), matcherModel: null,
    entries: [{ sourceTerm: "chamber", glossarySourceTerm: "camara", targetVariants: [{ text: "buong", note: "old variant" }],
      globalNotes: ["old note"], notes: ["old note"], footnotes: ["old footnote"] }],
  }), languages, glossary);
  return { glossary, languages, entries: { "row-1": entry } };
}

for (const change of [
  { footnote: "new footnote" }, { footnote: "" },
  { targetVariantNotes: ["new variant"] }, { targetVariantNotes: [""] },
  { notesToTranslators: "new note" },
]) {
  test(`metadata-only refresh preserves English alignment: ${JSON.stringify(change)}`, () => {
    const { glossary, languages, entries } = metadataRefreshFixture();
    const next = { ...glossary, terms: [{ ...glossary.terms[0], ...change }] };
    const updated = refreshEditorDerivedGlossaryMetadata(entries, glossary, next, languages);
    const entry = updated["row-1"];
    assert.equal(entry.entries[0].sourceTerm, "chamber");
    assert.equal(entry.requestKey, entries["row-1"].requestKey);
    assert.equal(entry.glossaryRevisionKey, buildEditorGlossaryRevisionKey(next));
    assert.deepEqual(entry.entries[0].footnotes, next.terms[0].footnote ? [next.terms[0].footnote] : []);
    assert.deepEqual(entry.entries[0].globalNotes, [next.terms[0].notesToTranslators]);
    assert.equal(entry.entries[0].targetVariants[0].note ?? "", next.terms[0].targetVariantNotes[0]);
    assert.notEqual(entry.matcherModel, entries["row-1"].matcherModel);
    const row = { rowId: "row-1", fields: { en: "chamber", es: "camara", vi: "buong" },
      persistedFields: { en: "chamber", es: "camara", vi: "buong" } };
    assert.ok(resolveHighlightableEditorDerivedGlossaryEntry({
      glossary: next, rows: [row], derivedGlossariesByRowId: updated,
    }, row.rowId, row));
    // Persisted entries have no matcher; hydration must keep the new metadata.
    const hydrated = hydrateEditorDerivedGlossaryEntryState({ ...entry, matcherModel: null }, languages, next);
    assert.deepEqual(hydrated.entries, entry.entries);
  });
}

test("metadata refresh does not bless stale alignments, changed wording, or another glossary", () => {
  const { glossary, languages, entries } = metadataRefreshFixture();
  for (const patch of [{ sourceTerms: ["otra"] }, { targetTerms: ["phong"] }, { lifecycleState: "deleted" }]) {
    const next = { ...glossary, terms: [{ ...glossary.terms[0], ...patch, footnote: "new" }] };
    assert.equal(refreshEditorDerivedGlossaryMetadata(entries, glossary, next, languages), entries);
  }
  const next = { ...glossary, terms: [{ ...glossary.terms[0], footnote: "new" }] };
  const stale = { "row-1": { ...entries["row-1"], glossaryRevisionKey: "older-revision" } };
  assert.equal(refreshEditorDerivedGlossaryMetadata(stale, glossary, next, languages), stale);
  assert.equal(refreshEditorDerivedGlossaryMetadata(entries, glossary, { ...next, glossaryId: "another" }, languages), entries);
});

test("derived lookup reads only the requested entry and uses an already-known row", () => {
  const row = { rowId: "row-1", fields: { en: "The inner chamber glows.", es: "" } };
  const chapter = {
    glossary: null,
    get rows() { assert.fail("known-row resolution must not scan chapter rows"); },
    derivedGlossariesByRowId: {
      "row-1": readyDerivedEntry({ glossaryRevisionKey: "" }),
      get unrelated() { assert.fail("must not normalize unrelated derived entries"); },
    },
  };
  assert.equal(resolveEditorDerivedGlossaryEntry(chapter, "missing"), null);
  assert.equal(resolveEditorDerivedGlossaryEntry(chapter, "row-1").status, "ready");
  assert.equal(resolveHighlightableEditorDerivedGlossaryEntry(chapter, row.rowId, row).status, "ready");
});

test("generated derived glossary entries match when the live glossary-source field is still empty", () => {
  const entry = readyDerivedEntry();
  const context = buildEditorDerivedGlossaryContext({
    translationSourceLanguageCode: "en",
    glossarySourceLanguageCode: "es",
    targetLanguageCode: "vi",
    translationSourceText: "The inner chamber glows.",
    glossarySourceText: "",
    glossaryRevisionKey: "rev-1",
  });

  assert.equal(editorDerivedGlossaryMatchesContext(entry, context), true);
  assert.equal(editorDerivedGlossaryIsStale(entry, context), false);
});

test("row-sourced derived glossary entries become stale after the glossary-source field becomes empty", () => {
  const entry = readyDerivedEntry({
    glossarySourceTextOrigin: "row",
  });
  const context = buildEditorDerivedGlossaryContext({
    translationSourceLanguageCode: "en",
    glossarySourceLanguageCode: "es",
    targetLanguageCode: "vi",
    translationSourceText: "The inner chamber glows.",
    glossarySourceText: "",
    glossaryRevisionKey: "rev-1",
  });

  assert.equal(editorDerivedGlossaryMatchesContext(entry, context), false);
  assert.equal(editorDerivedGlossaryIsStale(entry, context), true);
});

test("derived glossary entries become stale when the translation source text changes", () => {
  const entry = readyDerivedEntry();
  const context = buildEditorDerivedGlossaryContext({
    translationSourceLanguageCode: "en",
    glossarySourceLanguageCode: "es",
    targetLanguageCode: "vi",
    translationSourceText: "The inner chamber now glows brightly.",
    glossarySourceText: "",
    glossaryRevisionKey: "rev-1",
  });

  assert.equal(editorDerivedGlossaryMatchesContext(entry, context), false);
  assert.equal(editorDerivedGlossaryIsStale(entry, context), true);
});

test("hydrateEditorDerivedGlossaryEntryState rebuilds the matcher model for a persisted ready entry", () => {
  const hydratedEntry = hydrateEditorDerivedGlossaryEntryState(
    readyDerivedEntry({
      matcherModel: null,
      entries: [{
        sourceTerm: "inner chamber",
        glossarySourceTerm: "camara interior",
        targetVariants: ["buong noi tam"],
        notes: ["Dung thuat ngu cua glossary"],
      }],
    }),
    [
      { code: "en", name: "English" },
      { code: "es", name: "Spanish" },
      { code: "vi", name: "Vietnamese" },
    ],
    {
      glossaryId: "glossary-1",
      repoName: "glossary-1",
      title: "Glossary",
    },
  );

  assert.equal(hydratedEntry.matcherModel?.sourceLanguage?.code, "en");
  assert.equal(hydratedEntry.matcherModel?.targetLanguage?.code, "vi");
});

test("resolveEditorDerivedGlossarySourceText regenerates the pivot when the source changed but the glossary-source field did not", () => {
  const source = resolveEditorDerivedGlossarySourceText(
    {
      fields: {
        en: "The inner chamber now glows brightly.",
        es: "La camara interior brilla.",
      },
      persistedFields: {
        en: "The inner chamber glows.",
        es: "La camara interior brilla.",
      },
    },
    "en",
    "es",
  );

  assert.deepEqual(source, {
    glossarySourceText: "",
    glossarySourceTextOrigin: "generated",
  });
});

test("resolveEditorDerivedGlossarySourceText reuses the row text when the glossary-source field changed alongside the source", () => {
  const source = resolveEditorDerivedGlossarySourceText(
    {
      fields: {
        en: "The inner chamber now glows brightly.",
        es: "La camara interior ahora brilla mas.",
      },
      persistedFields: {
        en: "The inner chamber glows.",
        es: "La camara interior brilla.",
      },
    },
    "en",
    "es",
  );

  assert.deepEqual(source, {
    glossarySourceText: "La camara interior ahora brilla mas.",
    glossarySourceTextOrigin: "row",
  });
});

test("resolveHighlightableEditorDerivedGlossaryEntry ignores stale entries after a glossary revision change", () => {
  const entry = readyDerivedEntry({
    rowId: "row-1",
  });
  const chapterState = {
    glossary: {
      glossaryId: "glossary-1",
      repoName: "glossary-1",
      sourceLanguage: { code: "es", name: "Spanish" },
      targetLanguage: { code: "vi", name: "Vietnamese" },
      terms: [
        {
          termId: "term-1",
          sourceTerms: ["camara interior"],
          targetTerms: ["buong noi tam"],
        },
      ],
    },
    rows: [
      {
        rowId: "row-1",
        fields: {
          en: "The inner chamber glows.",
          es: "La camara interior brilla.",
          vi: "Buong noi tam dang sang.",
        },
        persistedFields: {
          en: "The inner chamber glows.",
          es: "La camara interior brilla.",
          vi: "Buong noi tam dang sang.",
        },
      },
    ],
    derivedGlossariesByRowId: {
      "row-1": entry,
    },
  };

  assert.equal(resolveHighlightableEditorDerivedGlossaryEntry(chapterState, "row-1"), null);
});

test("applyEditorDerivedGlossaryEntries writes a batch in one pass, matching sequential singular applies", () => {
  const chapterState = {
    chapterId: "chapter-1",
    derivedGlossariesByRowId: {
      "row-0": readyDerivedEntry({ requestKey: "req-0" }),
    },
  };
  const batch = {
    "row-1": readyDerivedEntry({ requestKey: "req-1" }),
    "row-2": readyDerivedEntry({ requestKey: "req-2" }),
    "  ": readyDerivedEntry({ requestKey: "req-blank" }),
  };

  const batched = applyEditorDerivedGlossaryEntries(chapterState, batch);
  let sequential = chapterState;
  sequential = applyEditorDerivedGlossaryEntry(sequential, "row-1", batch["row-1"]);
  sequential = applyEditorDerivedGlossaryEntry(sequential, "row-2", batch["row-2"]);

  assert.deepEqual(batched, sequential);
  assert.deepEqual(
    Object.keys(batched.derivedGlossariesByRowId).sort(),
    ["row-0", "row-1", "row-2"],
  );
});

test("applyEditorDerivedGlossaryEntries is a no-op for empty input or a missing chapter", () => {
  const chapterState = {
    chapterId: "chapter-1",
    derivedGlossariesByRowId: {},
  };

  assert.equal(applyEditorDerivedGlossaryEntries(chapterState, {}), chapterState);
  assert.equal(applyEditorDerivedGlossaryEntries(chapterState, null), chapterState);
  const noChapter = { chapterId: "" };
  assert.equal(
    applyEditorDerivedGlossaryEntries(noChapter, { "row-1": readyDerivedEntry() }),
    noChapter,
  );
});

const {
  normalizeEditorDerivedGlossaryEntryState,
  normalizeEditorGlossaryRevisionKey,
} = await import("./editor-derived-glossary-state.js");
const {
  GLOSSARY_MATCHER_POLICY,
  GLOSSARY_MATCHER_POLICY_VERSION,
} = await import("./glossary-token-matcher.js");

function revisionGlossaryState(overrides = {}) {
  return {
    glossaryId: "glossary-1",
    repoName: "glossary-repo",
    sourceLanguage: { code: "es" },
    targetLanguage: { code: "vi" },
    terms: [
      { termId: "t1", sourceTerms: ["camara"], targetTerms: ["buong"], notesToTranslators: "" },
      { termId: "t2", sourceTerms: ["luz"], targetTerms: ["anh sang"], lifecycleState: "deleted" },
    ],
    ...overrides,
  };
}

test("glossary revision keys are short hashes that track glossary content", () => {
  const glossaryState = revisionGlossaryState();
  const key = buildEditorGlossaryRevisionKey(glossaryState);

  // A hash, not the ~150 KB revision JSON that used to be stored per row entry.
  assert.match(key, /^h1:[0-9a-f]{16}$/);
  assert.equal(buildEditorGlossaryRevisionKey(glossaryState), key);
  // Same content in a fresh object hashes the same (memo is by identity only).
  assert.equal(buildEditorGlossaryRevisionKey(revisionGlossaryState()), key);
  // A term change (or a term added in place) changes the key.
  assert.notEqual(
    buildEditorGlossaryRevisionKey(revisionGlossaryState({
      terms: [{ termId: "t1", sourceTerms: ["camara"], targetTerms: ["phong"] }],
    })),
    key,
  );
  glossaryState.terms.push({ termId: "t3", sourceTerms: ["fuego"], targetTerms: ["lua"] });
  assert.notEqual(buildEditorGlossaryRevisionKey(glossaryState), key);
  assert.equal(buildEditorGlossaryRevisionKey(null), "");
});

for (const change of [{ footnote: "new footnote" }, { targetVariantNotes: ["new variant note"] }]) {
  test(`glossary ${Object.keys(change)[0]} edits invalidate cached derived hover details`, () => {
    const original = revisionGlossaryState();
    const updated = { ...original, terms: original.terms.map((term, index) => index === 0 ? { ...term, ...change } : term) };
    const originalKey = buildEditorGlossaryRevisionKey(original);
    const updatedKey = buildEditorGlossaryRevisionKey(updated);
    assert.notEqual(updatedKey, originalKey);
    const entry = readyDerivedEntry({ glossaryRevisionKey: originalKey });
    assert.equal(editorDerivedGlossaryIsStale(entry, { ...entry, glossaryRevisionKey: updatedKey }), true);
  });
}

test("legacy JSON revision keys normalize to the hashed key so cached entries stay fresh", () => {
  const glossaryState = revisionGlossaryState();
  // What buildEditorGlossaryRevisionKey stored before keys were hashed.
  const legacyKey = JSON.stringify({
    matcherPolicy: GLOSSARY_MATCHER_POLICY,
    matcherPolicyVersion: GLOSSARY_MATCHER_POLICY_VERSION,
    glossaryId: "glossary-1",
    repoName: "glossary-repo",
    sourceLanguageCode: "es",
    targetLanguageCode: "vi",
    terms: [{ termId: "t1", sourceTerms: ["camara"], targetTerms: ["buong"], notes: [] }],
  });
  const hashedKey = buildEditorGlossaryRevisionKey(glossaryState);

  assert.equal(normalizeEditorGlossaryRevisionKey(legacyKey), hashedKey);
  assert.equal(normalizeEditorGlossaryRevisionKey(hashedKey), hashedKey);
  assert.equal(normalizeEditorGlossaryRevisionKey("rev-1"), "rev-1");
  assert.equal(
    normalizeEditorDerivedGlossaryEntryState({ glossaryRevisionKey: legacyKey }).glossaryRevisionKey,
    hashedKey,
  );

  const entry = readyDerivedEntry({ glossaryRevisionKey: legacyKey });
  const context = {
    translationSourceLanguageCode: entry.translationSourceLanguageCode,
    glossarySourceLanguageCode: entry.glossarySourceLanguageCode,
    targetLanguageCode: entry.targetLanguageCode,
    translationSourceText: entry.translationSourceText,
    glossarySourceText: entry.glossarySourceText,
    glossarySourceTextOrigin: entry.glossarySourceTextOrigin,
    glossaryRevisionKey: hashedKey,
  };
  assert.equal(editorDerivedGlossaryIsStale(entry, context), false);
});
