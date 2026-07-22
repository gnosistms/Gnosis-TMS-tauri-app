# PDF export: pick fonts by content, not just declared language

## Problem

`required_fonts` chooses fonts from the chapter's declared `language_code` alone. A
Vietnamese chapter quoting Chinese names or Hebrew scripture therefore has no path to a
font that covers them, and the export is refused:

```
The selected PDF fonts do not contain every character in this chapter:
伏 (U+4F0F), 羲 (U+7FB2). Use DOCX or HTML for this document for now.
```

This is long-standing, not a regression. The Greek case looked identical but had a
different cause — EB Garamond had been covering Greek silently, and dropping it from the
Latin branch in 0.8.68 exposed it. That one is fixed by restoring EB Garamond.

**Typst cannot report this itself.** Compiling a document with uncovered characters exits
`0` with no error and no warning, renders tofu boxes, and writes a NUL byte into the PDF
text layer where the character belongs. The preflight check in `validate_document_glyphs`
is the only signal that exists, so it stays.

## Fix

Scan the chapter's characters, detect scripts the language-chosen fonts do not cover, and
add a font for each one we have.

| script | font | size | note |
|---|---|---|---|
| Greek + polytonic | EB Garamond | — | already required for Latin; 70/73 basic, 233/255 polytonic |
| IAST Sanskrit | Cormorant | — | romanised Sanskrit is Latin; 29/29 of ā ī ū ṛ ṝ ḷ ṃ ḥ ś ṣ ṭ ḍ ṇ |
| Hebrew | Noto Serif Hebrew | 179 KB | 27/27 letters, 55/55 niqqud and cantillation |
| Devanagari | Noto Serif Devanagari | 740 KB | full main and extended blocks; Vedic marks less `U+1CF7` and `U+1CFA` |
| Han | Noto Serif SC | 25 MB | 20,992 ideographs |

Scripts with no font available (Syriac, Coptic, …) keep failing the preflight with the
existing message. Silent tofu is the worse outcome.

Known limitation, not fixable in the font layer: **Devanagari text extracted from the PDF
comes out garbled** — reph reordering makes `भूर्भुवः` extract as `भूर्भुर्भुवः`. The page
renders correctly; only copy-paste and search out of the PDF are affected.

### Why Simplified Chinese alone, with no Traditional fallback

Both Noto Serif SC and TC contain both repertoires — 義/义, 學/学, 龍/龙 are all in both.
The difference is regional glyph shape and total coverage, not which characters exist:

- in SC but not TC: 11,887 codepoints
- in TC but not SC: 1,707, of which **1,689 are CJK Extension B** (rare historical and
  dialect characters) plus 6 compatibility ideographs

So SC is effectively a superset for any realistic quotation, and a TC rung on the ladder
would be machinery for a case that may never arrive. Accepted cost: quotations render in
mainland glyph shapes. If an Extension B character ever appears, the preflight names it
and TC can be added then.

### Hebrew needs no bidi work

Verified: `אֱלֹהִים` inside an LTR Vietnamese paragraph renders right-to-left with niqqud
attached, and a multi-word phrase orders its words correctly, with `dir: ltr` left alone.
Typst applies the bidi algorithm per run. Only the font is needed.

### Greek runs must be held to one family

Cormorant carries four stray Greek glyphs, mu among them, so per-character fallback set
`γάμος` as `γά` + `μ` + `ος` across two typefaces. A show rule over the Greek and
polytonic ranges keeps whole runs in EB Garamond.

## Steps

1. Add `Noto Serif Hebrew` and `Noto Serif Devanagari` assets scoped to new `hebrew` and
   `devanagari` script markers.
2. Add `document_scripts(document)` returning the script markers present in the text.
3. Feed those into `required_fonts` so `ensure_fonts` downloads them and
   `validate_document_glyphs` validates against the same set.
4. Report progress for the 25 MB Han download so it does not read as a hang.
5. Cover Han and Hebrew in the Typst compile smoke test.

## Verification

- A Vietnamese chapter containing 伏羲 and pointed Hebrew exports without the preflight
  error, with each script in its own font and Latin still in Cormorant.
- A chapter with no Han downloads no CJK font — the 25 MB cost is only paid when needed.
- A script we have no font for still fails the preflight rather than emitting tofu.
