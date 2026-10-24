# Quote block and Heading editor filters

## Changes
1. Add “Quote block” and “Heading” to the shared editor filter options and match
   the row's normalized style. Heading includes H1 and H2.
2. Preserve search intersection, deleted-row exclusion, row order, and conflict
   precedence through the existing filtering path.
3. Cover the two new modes with focused unit and browser regressions, including
   changing a row's style while a style filter is selected.

## Validation — complete
- 41 focused filter, screen-model, and toolbar tests pass. Re-ran the filter tests
  after test formatting; all pass.
- Chrome browser regression passes: selecting each option, H1/H2 membership,
  search intersection, changing a heading to a paragraph while filtered, and
  returning to Show all.
- Changed filter modules pass ESLint; scoped whitespace checks pass.
- Production build passes with the existing bundle-size warning.
