# AGENTS.md

## priorities
- Preserve smooth scrolling and stable virtualization behavior above all else.
- Prefer minimal, local refactors over broad rewrites.
- Keep changes easy to review and easy to revert.

## editor and virtualization rules
- Do not use full translate-body rerenders for ordinary row-level updates.
- Treat virtualization as the source of truth for row layout and spacer math.
- Any row-level DOM patch must notify virtualization so affected row heights are remeasured and reconciled.
- Keep structural changes conservative for now. Do not auto-apply inserted or reordered rows unless explicitly requested.
- Do not auto-overwrite rows that are focused, locally dirty, staleDirty, or in conflict.
- Prefer patching visible rows only. Offscreen rows may be updated in state and rendered naturally when they enter the viewport.

## implementation rules
- Reuse existing row rendering paths where possible instead of creating parallel render logic.
- Do not rewrite virtualization math from scratch unless explicitly requested.
- Keep public APIs small and explicit.
- Batch DOM measurement and reconciliation work into animation frames when possible.
- Avoid adding new dependencies unless clearly justified.

## verification
- When touching virtualization or row patching, verify:
  - smooth scrolling remains intact
  - no visible blank gaps appear
  - spacer heights stay correct
  - focus is preserved for the active editor row
  - textarea and image-driven height changes still reconcile correctly

## workflow
- For complex refactors or multi-step features, follow `PLANS.md` if present.
- Before implementing, explain the current flow and identify the narrowest safe change surface.
- After implementing, summarize:
  - files changed
  - behavior changed
  - risks deferred
  - how the change was verified