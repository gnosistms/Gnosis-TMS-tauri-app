# AI Assistant composer scroll stability

## Problem
Typing resizes the live composer through `height: auto`, temporarily expanding the
transcript viewport and clamping its scroll position. The input handler also
unconditionally schedules a scroll to the bottom on every keystroke.

## Plan
1. [x] Reproduce transcript movement with a capped composer in the editor browser fixture.
2. [x] Measure assistant composer content outside the visible layout and remove typing's
   forced bottom scroll; retain scrolling for tab entry and new messages.
3. [x] Verify typing at the bottom and while reading older messages, plus composer
   growth/shrink behavior, with browser regressions and the relevant existing checks.

## Validation
- Original-code browser overrides reproduce both regressions: a temporary 137px
  transcript viewport expansion while typing at the bottom, and forced scrolling
  away from older messages. Both pass with the fix in Chromium.
- Four focused browser checks pass in both Chromium and macOS WebKit, covering capped-composer typing at
  bottom/middle, shrinking after deletion, persisted transcript rendering, and
  applying an assistant draft.
- All 2,170 frontend unit tests and 23 workflow tests pass. Workflow tests require
  the runtime's fallback Git (system Git is blocked by the Xcode license) and
  permission to open local test-server ports.
- Targeted ESLint and `git diff --check` pass.
- The existing transcript-selection browser regression also fails with original
  source overrides; left unchanged. The unused-code audit reports only unrelated
  existing files/imports and `ensureEditorFootnoteEntry`.
- Windows native verification is unavailable on this host.

## Review follow-up
1. [x] Preserve fractional composer width during offscreen measurement so wrapping
   cannot underestimate the required height; measure without the current scrollbar
   so deleting text can remove it when the content fits again.
2. [x] Follow the transcript bottom synchronously only when the composer changes
   height and the transcript was already at the bottom before sizing.
3. [x] Add browser coverage for fractional wrapping, growth/shrink at bottom and
   middle, and zero scroll writes while typing at the height cap. Verify in
   Chromium and macOS WebKit alongside the original jump regressions.

Follow-up validation: both review regressions failed before the changes. All five
focused browser checks now pass in Chromium and macOS WebKit, including zero
programmatic transcript scroll writes at the height cap and correct shrinking
after overflow with a 16px scrollbar. All 2,178 current frontend unit tests and
23 workflow tests pass. Targeted ESLint and whitespace checks pass; the unused-code
audit retains the same unrelated findings listed above. Native Windows testing
remains unavailable.
