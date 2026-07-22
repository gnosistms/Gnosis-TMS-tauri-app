# Cormorant Garamond Vietnamese Accent Fix

## Problem

Cormorant Garamond draws every Vietnamese accent **twice**: a compact form used when
marks stack, and a tall display form used when the accent stands alone. Vietnamese
uses both forms constantly, so the two collide inside a single line. Measured in the
shipped `CormorantGaramond-Roman.ttf` at the default master:

| accent | standalone | stacked | points | action |
|---|---|---|---|---|
| circumflex | 161 × 259 | 233 × 105 | 13 → 13 | replace |
| grave | 110 × 260 | 144 × 107 | 10 → 15 | replace |
| acute | 111 × 260 | 142 × 107 | 10 → 15 | replace |
| hook | 126 × 191 | 109 × 144 | 28 → 26 | leave as drawn |
| tilde | 270 × 70 | 270 × 70 | — | already identical |

So `Tâm` renders with a tall spike while `Tầm` renders flat, on the same line, and a
standalone grave stands 2.4× taller than the one in `ầ`. The standalone circumflex is
also an outlier against other book serifs — its width/height of 0.62 is the only
value below 1.0 in a twelve-family comparison, where the rest sit between 1.12 and
1.89.

Left alone deliberately:

- **Hook**, upper and lower case. It does differ between the two forms, but the
  standalone shape reads correctly as drawn, so it stays untouched by choice rather
  than by oversight. The patched font must leave all 24 hook-bearing glyphs
  byte-identical to upstream.
- **Tilde**, in both cases — the two forms are already identical.
- **Uppercase circumflex** — already identical to the stacked form.
- **Uppercase grave and acute**. These are wider than their stacked counterparts
  (236 × 107 against 144 × 107) but exactly the same *height*, so they are a
  deliberate wide-mark-over-a-wide-capital design rather than the defect above.

## Fix

Replace each tall standalone accent with the font's own compact one, transplanted
contour by contour — 22 glyphs across three accents:

| accent | targets | donor |
|---|---|---|
| circumflex | `â ậ` / `ê ệ` / `ô ộ` | `ầ` / `ề` / `ồ` |
| grave | `à è ì ò ù ỳ ờ ừ` | `ầ` |
| acute | `á é í ó ú ý ớ ứ` | `ấ` |

Outlines are copied rather than scaled, so the result is the font's own accent, not a
squashed version of the tall one. Each donor contour is shifted by an integer offset
so its horizontal centre and its lowest point land where the replaced accent's did,
which keeps the gap above the letter unchanged and keeps every coordinate on the
integer grid.

Where the point count shifts (grave, acute, hook) the glyph's `gvar` deltas are
rebuilt by splicing the donor's deltas for the accent into the target's deltas for
the base letter and phantom points. The patch therefore holds across the whole
`wght` 300–700 axis rather than collapsing to one instance. Verified at all five
named instances — every patched standalone accent measures identical to its stacked
counterpart:

| weight | `à` / `ầ` | `á` / `ấ` | `â` / `ầ` circumflex |
|---|---|---|---|
| 300 | 144 × 107 | 142 × 107 | 233 × 105 |
| 400 | 148 × 110 | 147 × 110 | 233 × 110 |
| 500 | 153 × 113 | 154 × 113 | 233 × 116 |
| 600 | 159 × 116 | 162 × 117 | 233 × 122 |
| 700 | 165 × 120 | 169 × 121 | 233 × 129 |

The tall accents carry no variation deltas at all — the standalone circumflex stays
161 × 259 at every weight while the compact one thickens correctly from 105 to 129.
Further evidence the tall forms were left unfinished rather than designed that way.

Note that `gvar` decompiles lazily and reads point counts from `glyf`, so it must be
fully materialised before any outline changes length, or saving fails an assertion.

## Second fix: uppercase stacked accents sit too close

On `Ầ Ấ Ề Ế Ồ Ố` the tone mark touches the circumflex beneath it. The lowercase pair
does not, and both marks are drawn at *identical sizes* in the two cases — only their
relative placement differs. So the fix is to give the uppercase pair the same
circumflex-to-tone offset the lowercase pair already has.

Copying lowercase geometry wholesale would be wrong: the lowercase stack measures 236
units from letter-top to accent-top against 162 on uppercase, and uppercase has only
91 units of headroom left to the ascender. Matching the *offset* rather than the
absolute geometry raises the accent by 36 units (grave) and 24 (acute) and leaves
54–88 units of headroom across the axis, so tight leading is unaffected.

The horizontal offset already matched, so the correction is purely vertical. It is
not constant across the axis — 36 units at the default master against 24 at the
maximum — so the tone contour's `gvar` deltas absorb the difference, giving an exact
match at every weight rather than at one.

Hook and tilde stacked on an uppercase circumflex (`Ẩ Ẫ Ể Ễ Ổ Ỗ`) stay untouched by
request, alongside `Ậ Ệ Ộ`.

Italic is out of scope: `FONT_ASSETS` never downloads a Cormorant italic, so emphasis
inside a heading is already synthesised from the Roman and inherits the fixed
accents.

## Why the font must be bundled

`FONT_ASSETS` in `pdf_export.rs` downloads each font from a pinned Google Fonts raw
URL and verifies a sha256, into `app_data_dir()/pdf-fonts/<FONT_REVISION>/`. A
patched font cannot come from that URL, so it has to ship with the app.

## Steps — done

1. `scripts/patch-cormorant-vietnamese-accents.py` regenerates the font from the
   pinned upstream file. It opens with `recalcTimestamp=False`; without that,
   fontTools stamps `head.modified` on save and every run produces different bytes,
   which would break the pinned sha256.
2. Font committed at `src-tauri/resources/fonts/CormorantGaramondGnosis-Roman.ttf`
   (1,196,284 bytes, same size as upstream, still variable across `wght` 300–700).
3. Registered in `tauri.conf.json` under `resources` as `resources/fonts/`.
4. `FontAsset.url` became `FontAsset.source: FontSource`, either `Download(url)` or
   `Bundled(resource_path)`. `ensure_fonts` copies bundled assets out of the resource
   directory via `install_bundled_font`, which still verifies size and sha256 — a
   stale bundled file fails the same way a corrupt download does.
5. `FONT_REVISION` gained a `-cormorant-gnosis-1` suffix so existing caches do not
   keep serving the unpatched font.
6. `typst_preamble` names `Cormorant Garamond Gnosis` in the `#show heading` rule.
7. `scripts/generate-third-party-notices.mjs` now describes the font as modified and
   bundled, states what was changed, and points at the patch script. OFL 1.1
   obligations: the derivative stays under OFL and ships the license text.
   Cormorant's copyright string carries **no** Reserved Font Name clause, so the
   rename is good practice rather than a strict requirement.
8. Test assertions updated for the new family name.

Verified: `cargo fmt`, `cargo clippy --all-targets` clean, 423 lib tests pass, and a
Typst compile using the app's exact preamble resolves the family and renders
`Tâm vũ trụ`, `Ầ Ấ Ề Ế Ồ Ố`, italic and bold correctly.

## Decision taken

Ship the **patched variable font**, not a static instance. The transplant preserves
point counts, so every weight on the axis is fixed at once and the file stays the
same size as upstream (1.20 MB). Nothing is lost if the heading rule later moves off
weight 600.

## Verification

- For circumflex, grave and acute, assert every standalone glyph measures identical
  to its stacked counterpart at all five named weights.
- Assert all 24 hook-bearing and 20 tilde-bearing glyphs are byte-identical to
  upstream — same coordinates, flags and contour ends. This is what stops a later
  edit from quietly pulling the hook back in.
- Render `è ò à ê ô â é ó á ế ố ấ` before and after, plus the hook and tilde rows,
  which must be indistinguishable between the two.
- Confirm Typst resolves the family without synthetic emboldening.

One deviation is **pre-existing upstream**, not caused by the patch, and verified
against the unmodified font: `Ê` and `Ô` carry a circumflex one unit taller than `Â`
(106 against 105 at the default master). One part in a thousand of the em; invisible.
