# Kindred-style PDF export typography

Imitate the Vellum "Kindred" book style in the chapter PDF export. Reference: a
Vellum-generated sample PDF whose embedded fonts are Alegreya (chapter heading),
Great Vibes (drop cap), and Crimson Text (body — our Crimson Pro is its successor,
already in place).

## Scope

1. **Chapter titles**: Alegreya, all-caps, matched to the measured Vellum
   settings — regular weight (Vellum embeds no bold cut), 0.12em tracking, and
   the Vellum title-to-body ratio (12.5pt over a 9.5pt body → 14.5pt over our
   11pt body) — keeping the centred layout and the flourish ornament
   underneath (shipped earlier — `chapter_flourish.svg`).
2. **Body headings** (`heading1`/`heading2` blocks): Alegreya via a
   `#show heading` rule.
3. **Drop caps**: the first letter of the chapter's opening paragraph set in
   Great Vibes across two lines, via the MIT-licensed `droplet` Typst package
   (`@preview/droplet:0.3.1`), vendored into the crate so exports stay offline.
4. Latin-script exports only. CJK and Arabic exports keep their current
   heading faces, and no drop cap (no Latin letterforms to drop). The gate is
   the same one the Greek-run rule already uses: Crimson Pro leads the family
   list.

## Fonts

Added to `FONT_ASSETS` with `language: "latin"`, pinned to the same google/fonts
commit (`684b69db…`) as the existing downloads:

| File | Family | Size | SHA-256 |
|---|---|---|---|
| Alegreya-Roman.ttf | Alegreya | 425288 | ba5564634b93a8f8ba57b48cd4f1ae7417d2b4656fbac779028679b00de3cf12 |
| Alegreya-Italic.ttf | Alegreya | 425852 | fa915eec76227935dc5fb678953c94b71287c360928013cfdb441dfe52f5a391 |
| GreatVibes-Regular.ttf | Great Vibes | 457588 | 8d509802186f1b51572531ecf313e8098f9a5bfdfaca93f0c9b34467f9982d15 |

Both cover Vietnamese (Great Vibes: latin, latin-ext, vietnamese; Alegreya adds
Greek and Cyrillic). `FONT_REVISION` stays unchanged — `ensure_fonts` installs
missing assets into the existing revision directory incrementally.

## Vendored droplet package

`src-tauri/src/project_import/chapter_editor/droplet/` holds the seven files of
`@preview/droplet:0.3.1` (typst.toml, LICENSE, src/lib.typ, src/droplet.typ,
src/extract.typ, src/split.typ, src/util.typ), `include_str!`-embedded and
written by `prepare_typst_workspace` into
`<workspace>/packages/preview/droplet/0.3.1/`. The compile command (and the
smoke test) gains `--package-path <workspace>/packages`, so the import
`@preview/droplet:0.3.1` resolves locally and never touches the network.

## Typst source changes (all in `typst_preamble` / `prepare_typst_workspace`)

- Latin branch adds a heading family list `("Alegreya", "EB Garamond",
  "Cormorant Garamond Gnosis")` and emits
  `#show heading: set text(font: (…))`.
- `gnosis-title` sets that family list, wraps the title in `upper()`, and adds
  `tracking: 0.08em`.
- Latin branch defines `gnosis-dropcap` on top of droplet's `dropcap`:
  `height: 3` lines (measured against the Vellum sample — two reads too small
  for a script face), Great Vibes leading the letter's font list with the body
  families behind it (a letter Great Vibes lacks falls back to body serif
  rather than tofu).
- Title spacing revised against the Vellum sample: the flourish sits one
  line below the title (`#v(1.2em, weak: true)`) and the float clearance is
  `4.6em`, giving the wide gap before the body text. Flourish width 0.66in.
- `prepare_typst_workspace` wraps exactly one block in `#gnosis-dropcap[…]`:
  the first content block in emission order (after title promotion) — only if
  it is a plain paragraph (not heading/quote/centered/indented), the export is
  Latin-script, and its first visible character is alphabetic. Otherwise no
  drop cap, matching Vellum.

## Image size optimization (follow-up in the same change)

A 7-page HNHH chapter exported at 24 MB: PDF has no WebP support, so Typst
decodes WebP to raw pixels and embeds them losslessly deflated (JPEG is the
only pass-through format). Reproduced exactly (24.3 MB) with the chapter's
three images. `optimize_pdf_image_bytes` (hooked into the image worker loop,
`image` crate dependency) now:

- flattens WebP onto white (alpha discarded by user decision) and re-encodes
  as JPEG quality 95;
- downscales any raster above print resolution (300 DPI over the letter text
  area: 2040×2820 px), never upscaling;
- keeps PNG as PNG (line art stays crisp) and passes print-sized JPEG bytes
  through untouched; oversized JPEGs carrying EXIF also pass through, since
  re-encoding would drop the orientation tag;
- returns original bytes on any decode/encode failure — worst case is a large
  PDF, never a failed export;
- leaves SVG alone: Typst already embeds it as vector paths (verified: a
  flourish-only PDF contains zero raster image objects).

Result with the real HNHH chapter-1 images: 24.3 MB → 4.7 MB.

## Verification

- Unit tests updated (`typst_font_selection…`, preamble title-rule pins) plus
  new coverage for the drop-cap block selection gates.
- `generated_typst_compiles_when_smoke_runtime_is_configured` re-run with the
  bundled binary and a font dir containing the new faces (its Vietnamese
  fixture starts with a plain paragraph, so it exercises the drop cap and the
  vendored package resolution).
- Visual sample compiled and inspected against the Vellum reference page.
