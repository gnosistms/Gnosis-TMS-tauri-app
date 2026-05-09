# Notes on Target Variants in Glossaries

## Summary

Add target-variant-specific notes while preserving the existing global notes and footnote fields. Store global notes as TU-level `<note>`, store target variant notes inside each target `<tuv>`, show paired target variant notes in the glossary editor and tooltips, and pass compact structured JSON glossary guidance to AI prompts with empty fields omitted.

The selected glossary editor UI reference is the Option 1 mockup at `/private/tmp/gnosis-mockups/glossary-target-variant-notes-options.html`: keep the existing source variant lane, and extend each target row into a continuous Target + Notes + Actions shell.

The selected editor tooltip reference is `/private/tmp/gnosis-mockups/glossary-tooltip-target-variant-notes-options.html`: use the compact inline target variant notes format from former Option 4 and omit subtitle/helper lines to save space.

## Key Changes

- Extend glossary term data with `targetVariantNotes` / `target_variant_notes`, aligned by index with `targetTerms` / `target_terms`; old glossary JSON without this field loads as empty notes.
- Treat target variant text and target variant note as a paired data unit during every normalization step. Do not sanitize, deduplicate, reorder, add, remove, or drag `targetTerms` without applying the same operation to `targetVariantNotes`.
- Add a shared pair-normalization rule in both frontend and Rust persistence:
  - Trim target text and target note values.
  - Preserve one empty/no-translation target variant and allow it to carry a note.
  - When duplicate non-empty target variants are saved or imported, keep the first variant position and merge distinct non-empty notes with `\n\n`.
  - Return `targetTerms` and `targetVariantNotes` arrays with exactly the same length; missing legacy notes are filled with empty strings.
- Keep the existing `notesToTranslators` field as **Global notes** and keep `footnote` as a term-level field.
- TMX import/export:
  - Export global notes as `<tu><note>...</note>`.
  - Export each target variant as `<tuv xml:lang="target"><note>...</note><seg>...</seg></tuv>` when its note is non-empty; omit the `<note>` when empty.
  - Import TU-level notes into global notes.
  - Import target-language TUV notes into the aligned target variant note.
  - Ignore notes inside source-language TUVs.
  - If duplicate target variants import/save with different notes, keep one target variant and merge non-empty notes with a blank line separator.
  - Parser implementation must distinguish note scope instead of treating every `<note>` as TU-level: track whether the current `<note>` belongs directly to `<tu>` or inside a `<tuv>`, accumulate target TUV notes with that TUV's `<seg>`, and only decide which TUV notes to keep after source and target language codes are resolved.
- UI:
  - Use the selected Option 1 mockup: source variants stay on the left in the existing format; target rows on the right become a continuous row shell containing target text, target note, drag handle, and remove button.
  - Header labels are source language, target language, `Notes`.
  - The scalable widths must satisfy `source variant text width = target variant text width` and `target note width = 1.5 * target variant text width`, after fixed controls/gutters are accounted for.
  - Target rows start at the same visual height as existing source variant rows; if a target note grows taller, the whole target row grows and the target text field stays height-aligned with its note field.
  - Rename the lower `Notes` field label to `Global notes`.
  - Add/edit/remove/drag target variants as a pair: target text plus target note move together.
  - The empty/no-translation target variant can also have a note.
  - Glossary editor search must search target variant notes in addition to source variants, target variants, global notes, and footnotes.
  - Preserve the existing ruby button behavior and markup. The mockup uses `r` because Spanish/Vietnamese do not localize the ruby button, but Chinese/Japanese/Korean labels already use localized characters; do not regress that behavior.

## AI And Tooltips

- AI glossary hints should be formatted as compact JSON, not TMX. Omit absent fields entirely; do not send `null`, empty strings, or empty arrays.
- Prompt object shape per matched term:

```json
{
  "sourceTerm": "alquimia",
  "targetVariants": [
    { "text": "thuat luyen kim dan", "note": "Use in spiritual contexts." },
    { "text": "gia kim thuat" }
  ],
  "globalNotes": ["General guidance."],
  "footnotes": ["Suggested footnote."]
}
```

- Update AI request types so glossary hints can carry paired target variant notes plus footnotes. Keep existing global-note behavior compatible by treating current `notes` as global notes.
- Update the glossary matcher model so it stores ordered target variant objects, not separate flattened target term and note sets. Source matching, target matching, tooltip payloads, and AI glossary hint builders must all preserve the target text to target note pairing.
- Target-hover payloads need the matched target variant object, the actual source variant that triggered the row match, global notes, and footnotes. Do not derive target-hover notes by looking up text in a flattened note list.
- Tooltip behavior:
  - Source hover: show the matched source term, all target variants with their notes, global notes, and footnotes; omit sections that are empty.
  - Target hover: show the actual underlined target variant used in the row as the title, then show the actual underlined source variant used in the row as the second line. Do not repeat the target variant in that second line. Then show that target variant’s note if present, global notes, and footnotes.
  - Follow `/private/tmp/gnosis-mockups/glossary-tooltip-target-variant-notes-options.html` for tooltip formatting. Keep tooltip compact: no subtitles/helper lines, no empty labels, no placeholder text, concise sections, and no repeated full target list on target hover.

## Test Plan

- Rust TMX tests:
  - Round-trip global notes, target variants, target variant notes, footnote, and untranslated state.
  - Import legacy TMX with only TU-level `<note>`.
  - Import target TUV notes and ignore source TUV notes.
  - Deduplicate target variants while merging their notes.
- Rust AI prompt tests:
  - JSON glossary hint includes target variant notes, global notes, and footnotes.
  - Empty note/global/footnote fields are omitted.
  - Existing no-glossary and no-translation variant behavior remains intact.
- Frontend tests:
  - Modal renders source, target, and notes headers; lower field says `Global notes`.
  - Editing target note updates `targetVariantNotes`.
  - Add/remove/move target variants keeps notes aligned.
  - Duplicate target variant saves merge notes and keep the first target variant position.
  - Empty/no-translation target variant notes survive edit, save, load, and AI hint building.
  - Glossary editor search matches target variant notes.
  - Save payload includes `targetVariantNotes`; loaded old terms default to empty notes.
  - Tooltip payload/rendering matches source-hover and target-hover rules and omits empty fields.
  - AI glossary hint builders preserve variant-note pairing.
  - Ruby controls retain the existing localized labels and behavior.

## Assumptions

- `targetVariantNotes` is an index-aligned array instead of replacing `targetTerms`, to minimize migration and keep existing glossary term APIs compatible.
- Empty target variants remain valid and can carry notes.
- Source-language TUV notes are ignored on import.
- Duplicate target variants merge notes instead of preserving duplicate rows.
