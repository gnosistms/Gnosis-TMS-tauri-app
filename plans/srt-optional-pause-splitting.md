# Optional pause splitting for subtitle groups

1. Replace the automatic 500 ms pause boundary with chapter-session view settings:
   pause splitting off by default, threshold 0.5 seconds by default, with choices
   0.5, 0.75, 1, 1.5, and 2 seconds. Split only at gaps longer than the selected
   threshold when enabled; punctuation and conflict/deletion boundaries remain.
   Preserve settings on refresh of the same chapter and reset for another chapter.
2. Add the checkbox and inline dropdown to the right of the segmented view control,
   visible only in Group fragments mode. Use the existing tooltip system below
   the label, checkbox, and dropdown with the requested text. Keep the dropdown
   usable while unchecked so users can choose a threshold before enabling it.
3. Flush pending edits before changing grouping, retain the old setting if saving
   fails, and invalidate group/height caches when options change. Settings affect
   the view only and do not write cue content or timing.
4. Verify boundary choices, cache invalidation, default/visibility, live regrouping,
   setting preservation, and saving/failure behavior with unit and browser tests.

Status: implemented and verified.

- All 2,963 frontend tests pass, including 34 focused grouping/state tests.
  All 25 workflow tests pass with the local socket access required by the
  launcher fixtures.
- All 24 subtitle grouping browser cases pass in installed Chrome against a
  fresh test server. New cases cover visibility/defaults, threshold selection
  while unchecked, immediate regrouping, view preference preservation, saving
  drafts, and rejecting changes when a draft has invalid markers.
- Visually checked the controls and tooltip in the browser screenshot at
  `/private/tmp/gnosis-pause-isolated-results/editor-srt-grouping-option-a3bee-and-preserves-view-settings/pause-splitting.png`.
- Production build passes. Scoped ESLint reports no errors (one existing state.js
  warning). The unused audit reports existing findings: 345 files, 5 unresolved
  imports, and 32 exports; no new pause-feature findings remain.
- No backend or repository-format changes. Native Windows verification remains
  unavailable; browser checks do not substitute for native platform checks.
