# Simplify secondary UI actions

## Scope and request history

- Preserve the orange update pill. In the archived task “Locate Codex update
  button” (01a06c40-f310-7f90-8cb2-f78a03583962), Hans explicitly requested its
  style, placement beside the team name, and persistent visibility.
- Preserve search access to weaker results, but present the assistant-proposed
  control as a small Show more results / Show fewer results link below results.
  The task “Mockup project search trees” requested relevance improvements; the
  prominent secondary button was an implementation choice.
- Preserve the requested WordPress fallback route and its discovery conditions,
  but present it as a text link above the setup action row. In “Clarify WordPress
  credential storage”, Hans requested automatic detection before offering a
  fallback, not an additional full-size footer button.
- Keep error-recovery buttons and sample-download links unchanged. Edit text was
  already removed. The WordPress refresh-button removal from this task remains.

## Implementation

1. Move the search toggle below results; simplify its label and styling.
2. Restyle both WordPress fallback appearances as contextual text links.
3. Update affected existing expectations; run frontend tests, unused-code audit,
   and a visual check of both changed surfaces.

## Verification

Completed. All 2,124 frontend tests passed. The 19 other workflow tests passed;
the four launcher tests passed after rerunning with localhost access outside the
sandbox. The unused-code audit retains its nine existing findings with no new
ones. Headless Chrome screenshots confirmed the search link appears below the
tree and both WordPress fallback states use text links outside the action row;
the changed controls remain keyboard-focusable. `git diff --check` passed.
