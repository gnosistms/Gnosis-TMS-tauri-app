# Keep project notices inside the card surface

1. Reproduce the gap between an expanded project header notice and its file rows
   using actual rendered DOM geometry, covering wrapping messages and warnings.
2. Contain notice margins within each flat project card segment without clipping
   content, altering notice spacing, or changing virtualized item measurement.
3. Run the browser regression before/after the CSS fix, inspect the rendered
   result, and run the relevant projects rendering tests and production build.

Finding: the last notice's bottom margin collapses outside the header segment,
leaving an unpainted band between adjacent segments of the same project card.

Completed:

- Added a browser regression using the production project renderer and stylesheet.
  Before the fix, the update-required notice produced an 18px gap between header
  and first file, matching the screenshot.
- Made each project card segment a flow root. Notice margins now remain within
  the painted and measured segment without clipping notices or their actions.
- All six browser cases pass: update-required errors, conflict warnings, and local
  change errors at 1024px and 1440px; each checks expanded, collapsed, and removed
  notices. Header/file seams stay within 1px and notice bottom spacing is retained.
- All 57 focused projects render/model/virtualization unit tests pass; production
  frontend build passes. Existing dev server applies the CSS through hot reload.
