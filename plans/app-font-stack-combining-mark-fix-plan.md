# App Font Stack Combining Mark Fix Plan

## Problem

The app currently loads its primary UI font through subsetted `@font-face` entries with `unicode-range`. Valid decomposed Unicode text can split base characters and combining marks across different font face records. Vietnamese exposed the issue clearly, but the same failure mode can affect Latin transliteration, Greek, Cyrillic, and any pasted text that uses combining marks.

## Recommendation

Treat this as a font loading problem first, not a glossary-specific data problem. The app should render valid decomposed Unicode correctly even before stored text is normalized.

Use a non-subsetted primary UI WOFF2 font face for Latin-script UI text, and keep the existing script-specific Noto stacks as fallbacks for CJK, Arabic, Korean, and broader coverage. Keep NFC normalization as a secondary data hygiene layer for text the app owns, but do not rely on normalization for rendering correctness.

## Implementation Plan

1. Install a non-subsetted Inter UI face.
   - Download the official Inter release WOFF2 variable font.
   - Register it as a new family name, `Inter App`, so the app does not confuse it with the subsetted `Inter Variable` faces.
   - Keep the existing subsetted variable fonts available as fallbacks.

2. Update font stacks.
   - Put `Inter App` first in `--font-sans`.
   - Put `Inter App` before script-specific sans fallbacks in language stacks, so Latin text with combining marks uses the safe face while CJK/Arabic/Korean glyphs still fall through to the script fonts.
   - Prefer system serif faces before subsetted Noto Serif for `--font-serif`, reducing the same base/mark split risk in editor-style serif content.

3. Preserve existing script coverage.
   - Leave the Noto variable font imports in place.
   - Keep script-specific font families in the stack for glyph coverage beyond Inter.

4. Add regression coverage.
   - Add a source-level test that verifies `Inter App` is defined with the full local WOFF2 file and is first in the sans stacks.
   - Verify `--font-serif` does not start with a subsetted Noto Serif face.

5. Verify behavior.
   - Run the focused Node test suite.
   - Run the Vite build.
   - Manually verify a decomposed Vietnamese fixture in the app where practical.

## Follow-Up

NFC normalization should still be added at app data boundaries for glossary and project text, but that should be a separate data-integrity change. It complements the font fix; it does not replace it.
