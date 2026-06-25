# Preserve WordPress Export Defaults

## Problem

After a successful WordPress export, the chapter-local export default stores the
WordPress option and selected post. A later non-WordPress export, such as Vellum
copy, saves a new default with only `{ optionId }`, replacing the whole chapter
entry and losing the remembered WordPress post.

## Approach

1. Preserve any valid stored WordPress post metadata when saving a non-WordPress
   export default for the same chapter.
2. Keep reopening behavior unchanged: the last successful export option still wins,
   but choosing WordPress later can restore the remembered overwrite target.
3. Add regression coverage for the exact sequence: WordPress export, Vellum copy,
   reopen/select WordPress.

## Verification

- `npm test`
- `npm run format:rust:check`
