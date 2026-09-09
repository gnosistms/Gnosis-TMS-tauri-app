# Glossary term save repository context

## Problem

The term-save preflight spreads a nullable repository descriptor into the IPC input.
If the collection summary is missing or lacks `fullName`, this sends only the
installation ID and Rust rejects the command with `missing field repoName`.

## Plan

1. Verify the Rust editor-sync input contract and audit glossary/QA callers.
2. Capture complete repository context from the selected summary and matching editor
   before queuing a glossary save. Use that same snapshot for preflight
   and post-save sync, and preserve the draft if context cannot be resolved.
3. Add regression coverage for creating/editing with incomplete collection data,
   verify missing-context handling, and run relevant tests and unused-export audit.

## Parity

QA editor sync already checks for a null descriptor before invoking. Its background
sync validates repository fields too. This fixes a glossary save regression and
does not introduce a new resource capability.

## Completed

- Captured repository identity before queueing, including matching editor metadata.
  Both sync steps use it. Do not construct a remote path from the organization:
  backend sync can rewrite `origin`, so missing or conflicting identity must block.
- Added a guard that keeps the draft open if repository identity is unavailable.
- Regression cases cover incomplete summaries, unavailable repository identity,
  and conflicting summary/editor identity.
- All 2,134 frontend tests passed after the identity safety review; all 23 workflow tests passed across the initial
  run and a rerun of four launcher tests outside the localhost-restricted sandbox.
- The isolated Rust deserialization test passed for glossary and QA input aliases.
- Changed-file ESLint, Rust formatting, and whitespace checks passed. The unused
  audit reported only unchanged files/imports/exports outside this fix.

## Safety review

Missing `fullName` in a local summary is expected because the backend summary type
does not include that field. It does not indicate malformed term content. However,
constructing a remote path from names did not independently verify the destination,
so that fallback was removed. Saves now stop before any IPC when available glossary
IDs, repository names, full names, or numeric repository IDs disagree. Missing full
names also stop the save even when the team's organization name is available. The
draft remains open in both cases. Existing term validation and conflict handling
remain in place.
