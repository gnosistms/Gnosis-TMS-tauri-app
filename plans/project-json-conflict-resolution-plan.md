# Project JSON Conflict Resolution Plan

## Problem

Project-repo pull/rebase recovery only understands editor row files and chapter
`chapter.json`. A project transfer can therefore stop when the independently
initialized local and remote histories produce an add/add conflict in root
`project.json`, even when both files describe the same project title.

## Safe merge policy

- Accept only root `project.json` conflicts with present local and remote stages.
- Require every present stage to be a JSON object with a string `title`, matching
  the schema currently read by project import and written by project initialization.
- Merge every top-level field with three-way semantics:
  - preserve a one-sided change;
  - preserve an identical change on both sides;
  - for add/add files, union fields that occur on only one side;
  - reject divergent changes to the same field and report field names only.
- Never choose local or remote wholesale. Reject deletion conflicts, malformed
  JSON/schema shapes, and ambiguous overlapping edits so the existing rebase abort
  path leaves the repository recoverable.

## Implementation and verification

1. Add the root project metadata resolver beside the existing row/chapter semantic
   resolvers and expose it to project repo sync.
2. Route exactly `project.json` through that resolver when building the semantic
   conflict plan.
3. Add focused unit coverage for data preservation and safe refusal, plus a real Git
   add/add conflict test proving `build_semantic_conflict_resolution_plan` now accepts
   the transfer scenario.
4. Run Rust formatting, focused Rust tests, the full Rust test suite, and the
   repository's relevant frontend/full checks before committing only scoped files.
