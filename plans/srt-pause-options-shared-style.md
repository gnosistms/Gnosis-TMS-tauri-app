# Extend pause options and share existing control styling

1. Add 2.5 and 3 seconds to the shared pause-threshold list and extend boundary
   and dropdown coverage for both values.
2. Reuse the existing Replace checkbox style through one shared editor-checkbox
   CSS class on both native checkbox inputs, including checked/focus states.
   The user confirmed the checkbox, rather than the text field appearance.
3. Verify the new thresholds, rendered controls, shared styling, and scrolling
   with focused unit/browser checks and a production build.

Status: complete.

- Added 2500 ms and 3000 ms to the shared threshold list used by rendering,
  validation, and grouping. Strict boundary tests cover all seven choices.
- Both inputs use editor-checkbox, with one set of existing Replace checkbox
  declarations for normal, checked, checkmark, and focus states. Removed the
  pause checkbox's native styling override; label styling stays independent.
- All 10 grouping unit tests and 3 focused browser cases pass. Browser coverage
  verifies 2.5/3-second regrouping, matching checkbox/checkmark styles, and viewport
  coverage while scrolling with wrapped controls. Visually inspected both checked
  controls in the browser screenshot. Production build, scoped ESLint, and
  whitespace checks pass (existing build chunk-size warning remains).
