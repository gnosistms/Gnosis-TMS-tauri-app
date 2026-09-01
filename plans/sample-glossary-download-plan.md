# Sample Glossary Download Plan

## Goal

Offer a downloadable Spanish-to-English TMX glossary sample from the glossary
import dialog. The sample must round-trip through Gnosis TMS and demonstrate the
supported glossary term shapes and note types.

## Implementation

1. Add a static 10-unit TMX sample under `src-ui/public/`, using the same TMX
   elements and Gnosis properties as the glossary parser and serializer.
2. Add a native download link immediately after the supported-format text in the
   glossary import modal, with focused styling that remains readable against the
   muted hint copy.
3. Extend frontend rendering tests and the Rust TMX parser tests to verify the
   link contract and the sample's term count, language direction, variants,
   footnotes, global notes, and omission-only entry.
4. Run targeted frontend and Rust tests, then build the frontend to confirm the
   public sample is packaged in the distribution.
