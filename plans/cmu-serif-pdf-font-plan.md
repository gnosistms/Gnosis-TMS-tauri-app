# CMU Serif PDF Font Plan

> Superseded by `eb-garamond-pdf-font-plan.md` after the literary-font visual comparison.

## Goal

Use CMU Serif for Latin-script PDF exports, including Vietnamese, while retaining
the existing Noto Serif CJK families and Noto Naskh Arabic for the scripts they
serve.

## Implementation

1. Add pinned CMU Serif OpenType assets for regular, bold, italic, and bold italic
   styles to the persistent PDF font cache manifest, with exact sizes and SHA-256
   hashes from the official CTAN `cm-unicode` distribution.
2. Select CMU Serif in generated Typst source for Latin-script documents and as the
   Latin fallback for Persian/Arabic, without changing the primary CJK or Arabic
   typefaces.
3. Update font-selection and Typst-source tests, and add CMU Serif to the generated
   third-party notice under the SIL Open Font License.
4. Run focused Rust tests, regenerate the notice, and render a Vietnamese Typst
   smoke PDF to verify all four font styles and diacritics.

## Cache Compatibility

Keep the existing cache directory revision so previously downloaded Noto CJK font
packs remain valid. CMU Serif is added as a new small base dependency; obsolete
Noto Serif base files may remain harmlessly in the persistent cache.
