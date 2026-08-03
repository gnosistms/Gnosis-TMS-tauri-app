# Chinese Glossary Highlighting Fix

## Goal

Restore glossary underlines for Chinese script-tag language codes when glossary
records and chapter columns use different BCP 47 casing, such as `zh-hant` and
`zh-Hant`.

## Implementation

1. Compare glossary and editor language codes case-insensitively while retaining
   the editor column's original code as the highlight-map key.
2. Apply the same semantic comparison when building glossary highlight cache keys
   and resolving direct-versus-derived target highlights.
3. Canonicalize newly stored glossary language codes so Chinese script subtags are
   written as `zh-Hans` and `zh-Hant`.
4. Add regression tests for existing lowercase Traditional Chinese data, Simplified
   Chinese matching, cache invalidation, and backend language-code canonicalization.

## Verification

- Run the focused glossary highlighting and cache tests.
- Run the focused Rust glossary storage tests.

