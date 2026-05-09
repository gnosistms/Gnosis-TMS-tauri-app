# Glossary AI No-Translation Hints

## Goal

Represent empty target variants as an explicit no-translation option in AI glossary hints, without treating them as note-only target variants.

## Contract

AI glossary hint shape:

```json
{
  "sourceTerm": "mente",
  "targetVariants": [
    { "text": "tam tri", "note": "Use in doctrinal contexts." }
  ],
  "noTranslation": {
    "position": "later",
    "note": "Omit when redundant in flowing prose."
  },
  "globalNotes": ["General guidance."],
  "footnotes": ["Suggested footnote."]
}
```

Rules:

- `targetVariants` contains only non-empty target text.
- An empty target variant means no translation is allowed.
- The empty target variant's aligned note becomes `noTranslation.note`.
- Omit `noTranslation.note` when blank.
- Omit `noTranslation` entirely when there is no empty variant.
- `noTranslation.position` preserves the empty variant's preference ranking:
  - `only`: no translation is the only option.
  - `first`: no translation is preferred; target variants are fallbacks.
  - `later`: target variants are preferred; no translation is an allowed fallback.
- If duplicate empty variants are imported or otherwise encountered, normalize to one no-translation option and merge distinct notes with a blank line.

## Implementation

- Keep glossary storage unchanged: `targetTerms[]` and aligned `targetVariantNotes[]`.
- In frontend glossary matcher data, preserve no-translation as separate candidate metadata: `noTranslationPosition` and `noTranslationNote`.
- In AI hint builders, split paired target rows into:
  - non-empty pairs -> `targetVariants`
  - empty pair -> `noTranslation`
- In Rust AI request types, add `noTranslation` while keeping `noTranslationPosition` as a legacy compatibility input.
- In Rust prompt serialization, output `noTranslation` as compact JSON and explain its semantics in prompt guidance.
- In derived glossary preparation, pass `noTranslation` through request, matching, response, cache model rebuild, and final AI hints.

## Tests

- Direct AI hint for only/first/later empty variants emits `noTranslation` with position and optional note.
- Empty variants are not serialized as `{ "note": "..." }` target variants.
- Derived glossary preparation preserves persisted empty variants and empty-variant notes.
- Rust prompt JSON includes `noTranslation`, omits empty fields, and explains omission semantics.
