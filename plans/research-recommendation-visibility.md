# Hide recommendations after a decision

Apply the existing step 2a behavior to every optional research operation. Show
run/skip advice while the user is deciding; hide it during research and when
reviewing, resuming, or revisiting work already run or skipped. Keep saved advice
for logs and cache reuse. Waiting-only work plans are not evidence of a decision.

- Share the research-started predicate across all recommendation steps.
- Use it in rendering and recommendation requests, retaining the active
  recommendation loading state before a choice.
- Check all optional steps across running, paused, completed and skipped states.

Validation: 225 studio/renderer unit tests passed. New coverage checks every
recommendation step before a choice, while advice loads, during research, and
after pause, completion, skip or reset. Targeted ESLint and whitespace checks pass.
