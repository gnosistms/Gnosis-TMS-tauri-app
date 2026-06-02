# Inline Markup Module

Pure parsing and serialization of the inline markup format used in translation row
content. No Tauri dependencies, no DOM, no side effects — all functions are pure
transforms over string or AST values.

See parent `src-ui/CLAUDE.md` for editor-level rules (scroll preservation, write
permission queue, virtualization).

## Purpose

Translation rows may contain inline formatting: bold, italic, underline, and ruby
annotations (phonetic readings above CJK base text). This module owns:

- Parsing the stored markup string into an AST
- Serializing the AST back to a markup string (round-trip stable)
- Applying style transforms to a selection range
- Mapping cursor positions between base text and visible text
- Rendering the markup to sanitized HTML for display
- Search highlight injection into rendered output

## Module Inventory

| File | Responsibility |
|---|---|
| `parser.js` | Parses inline markup string → AST. Handles tag aliases, nesting, malformed input. |
| `serialize.js` | AST → markup string, HTML, history text, and ruby notation variants. |
| `transforms.js` | Toggle bold/italic/underline/ruby on a selection range. Describes selection state. |
| `ranges.js` | Maps base-text character ranges to visible-text ranges (ruby base vs. reading). |
| `highlights.js` | Renders markup HTML with overlaid search/glossary/editor highlight spans. |
| `ruby.js` | Language-specific ruby button config (Japanese: 振り仮名, Chinese: 拼音). |

## Supported Markup

The supported inline tag set is fixed: `strong` (bold), `em` (italic), `u` (underline),
`ruby` / `rt` (phonetic annotation). Tag aliases `b` → `strong`, `i` → `em` are
normalized on parse.

No other tags are permitted. The serializer and HTML renderer drop any tag not in the
supported set — this is the sanitization contract.

## Key Invariants

**Round-trip stability** — serialization is canonical and idempotent:
`serialize(parse(serialize(parse(x)))) === serialize(parse(x))`. Tag aliases are
normalized on parse (`b` → `strong`, `i` → `em`), so inputs using aliases will not
be byte-identical after the first round-trip but will be stable on all subsequent
ones. Tests in `editor-inline-markup.test.js` enforce this.

**Sanitization is always applied** — `renderSanitizedInlineMarkupHtml` and all
`renderSanitized*` functions strip unsupported tags. Never render raw markup string
as innerHTML — always go through a `renderSanitized*` function.

**Base text vs. visible text** — ruby annotations add characters to the visible
rendering that are not part of the base translatable text. `ranges.js` maps between
these two coordinate spaces. When computing word counts, glossary matches, or search
positions, use base text coordinates, not visible text coordinates.

**Toggle semantics** — `toggleInlineMarkupSelection` adds a style when none of the
selected range has it, removes it when all of the range has it, and adds it when
the range is mixed. Describe the selection first with `describeInlineMarkupSelection`
to determine the correct toggle direction before applying.

## Ruby Annotation Format

Ruby annotations wrap base text in `<ruby>` with the reading in `<rt>`:

```html
<ruby>漢字<rt>かんじ</rt></ruby>
```

The serializer's `serializeInlineMarkupRubyNotation` produces an alternative
`base(reading)` plain-text representation for export and history display.

`ruby.js` provides language-aware button labels and placeholder text:
- Japanese (`ja`): label `振`, placeholder `よみ`
- Chinese (`zh*`): label varies by simplified/traditional detection
- Other languages: no ruby button shown

## Common Mistakes

- **Do not add new supported tags** without updating `SUPPORTED_TAGS`, `STYLE_TO_TAG`,
  and `TAG_TO_STYLE` in `parser.js` and adding round-trip tests.
- **Do not render markup string directly as innerHTML** — always use a
  `renderSanitized*` export from `serialize.js` or `highlights.js`.
- **Do not use visible text length** for glossary match positions or word counts —
  ruby `<rt>` content inflates the visible length. Use `extractInlineMarkupBaseText`.
