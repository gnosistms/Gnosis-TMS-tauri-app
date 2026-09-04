# Glossary footnote popover insertion

## Goal

Show glossary footnote popovers only for footnoted target-language terms in a
closed editable editor field, and let the user insert that glossary footnote at
the hovered term with Ctrl+F.

## Implementation

1. Centralize popover/insertion eligibility around the active glossary mark:
   target payload, non-empty footnote, closed editable field, and row/language
   coordinates.
2. Update the popover structure and styling with the `Footnote:` label and a
   two-sided footer containing the edit and insertion tips.
3. Route Ctrl+F through the existing translate action and footnote persistence
   flow, inserting a newly allocated marker at the glossary term's end with no
   intervening space and seeding the footnote text from the glossary.
4. Add focused unit coverage for hover eligibility, shortcut priority, and
   seeded insertion, then run the relevant frontend tests.
5. Convert glossary mark offsets from rendered visible-text coordinates to raw
   inline-markup insertion coordinates, closing any formatting/ruby wrapper
   that ends with the hovered term before placing the marker.
6. Treat target spellings backed by multiple distinct glossary footnotes as
   ambiguous: keep the information popover, but do not advertise or perform
   Ctrl+F insertion.
7. Keep glossary marks on the editor's normal text cursor and verify the hover
   controller moves the popover across every source/target occurrence in a row.

## Verification

- Source-language terms and target terms without footnotes do not open a
  popover.
- Open editor fields do not expose the footnote popover or insertion shortcut.
- Ctrl+F on an eligible hovered mark inserts `[n]` immediately after the term
  and creates the corresponding footnote content.
- Ctrl/Cmd+F retains its existing page-search behavior when no eligible mark is
  hovered.
