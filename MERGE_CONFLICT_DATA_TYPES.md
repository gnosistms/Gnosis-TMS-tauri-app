# Merge Conflict Data Types And Suggested Resolution Rules

This file lists shared, Git-backed app data that can enter a merge-conflict state and suggests an automatic resolution rule for each type.

## Guiding Principle

- Resolve everything automatically except actual row text in the editor.
- The only manual conflict class should be `fields[language].plain_text` on rows.
- Prefer non-destructive outcomes when a delete conflicts with an edit.
- Prefer recomputing derived values instead of merging them.
- Prefer canonical external data for GitHub-derived metadata.
- Treat stable IDs and language codes as immutable whenever possible.

## Rule Groups

### R1. Manual Text Merge

Use only for row `fields[language].plain_text`.

- If only one side changed the text, keep that change.
- If both sides changed the text but normalize to the same final string, keep it automatically.
- If both sides changed the text and the normalized values differ, stop and require user resolution.

### R2. Scalar Last-Writer-Wins

Use for human-authored scalar metadata and free-text fields that are not row translation text.

- Winner = side with later semantic timestamp such as `updatedAt` when available.
- Fallback = later commit timestamp.
- Fallback after that = incoming rebased/local change.

### R3. Immutable Identity Keep Base

Use for stable identifiers and codes that should not drift.

- If one side kept base and the other changed it, keep the changed value.
- If both sides changed it differently, keep the base/original value.

### R4. Remote Canonical

Use for GitHub-derived metadata.

- Re-fetch canonical values from GitHub or the broker.
- If the remote lookup fails, prefer the non-null later value.

### R5. Keyed Union

Use for collections keyed by stable IDs or keys.

- Union by stable key.
- Preserve all unique members.
- If both sides define the same key, resolve that member field-by-field using its assigned rule.

### R6. Ordered Unique Union

Use for ordered lists of string values such as glossary term variants.

- Trim and deduplicate values.
- Keep base order for shared values.
- Append side-added values in the order they were added.
- If both sides reorder the same existing values, prefer the later reorder.

### R7. Conservative Boolean Or Status Merge

Use for review-style flags and similar caution-bearing state.

- On disagreement, choose the safer value.
- For `reviewed`, `false` wins over `true`.
- For `please_check`, `true` wins over `false`.
- For status enums, prefer the more cautious status when there is a clear ordering; otherwise fall back to `R2`.

### R8. Non-Destructive Lifecycle Merge

Use for create/delete/restore/permanent-delete conflicts.

- Create vs create with different IDs: union.
- Edit vs soft delete: keep the entity active and keep the edits.
- Restore vs soft delete: keep active.
- Edit vs permanent delete: permanent delete wins and the entity is hard-deleted.
- Delete wins only when the other side made no non-lifecycle changes.
- If both sides delete, keep the more destructive result.

### R9. Recompute Derived Data

Use for counters, summaries, and other derived values.

- Ignore both conflicting stored values.
- Recompute from the resolved canonical data after merge.

### R10. Audit Field Merge

Use for `created*`, `updated*`, and `deleted*` fields.

- `createdAt`: earliest non-null value wins.
- `updatedAt`: latest non-null value wins.
- `createdBy`: value associated with the winning `createdAt`; fallback first non-null.
- `updatedBy`: value associated with the winning `updatedAt`; fallback winner-side value.
- `deletedAt` and `deletedBy`: keep only if the resolved lifecycle is deleted; otherwise clear.

### R11. Mirror From Metadata

Use for shadow copies stored in content repos when team metadata should be treated as authoritative.

- Resolve the team-metadata field first.
- Overwrite the mirrored content-repo field from the resolved metadata value.
- Fallback to `R2` if metadata is unavailable.

### R12. Order Merge With Renormalization

Use for row ordering via `structure.order_key`.

- Treat row order as an ordered list of row IDs.
- If both sides moved different rows, keep both moves.
- If both sides moved the same row, later move wins.
- After resolving order, rewrite fresh normalized `order_key` values for the entire chapter.

### R13. Comment OR-Set With Tombstones

Use for row comments.

- Additions union by `comment_id`.
- If a comment was deleted on either side after base, deletion wins for that `comment_id`.
- Remaining comments keep their original immutable payload.
- Sort final comments by canonical comment order.
- Recompute the comment revision counter after resolution.

### R14. Derived `untranslated` Flag

Use for glossary term `untranslated`.

- If resolved target terms differ from resolved source terms, set `untranslated = false`.
- If resolved target terms equal resolved source terms and either side set `untranslated = true`, set `untranslated = true`.
- If resolved target terms equal resolved source terms and neither side set it true, keep `false`.

## Team Metadata Repo

### Project Metadata Records

- project title: `R2`
- project repo name: `R2`, and append the losing repo name into `previousRepoNames` using `R5`
- project previous repo names: `R5`
- project GitHub identity fields:
  - `githubRepoId`: `R4`
  - `githubNodeId`: `R4`
  - `fullName`: `R4`
  - `defaultBranch`: `R4`
- project lifecycle fields:
  - `lifecycleState`: `R8`
  - `remoteState`: `R4` when it reflects GitHub state, otherwise `R2`
  - `recordState`: `R8` when it reflects deletion/tombstone state, otherwise `R2`
  - `deletedAt`: `R10`
- project counts:
  - `chapterCount`: `R9`
- project audit fields:
  - `createdAt`: `R10`
  - `updatedAt`: `R10`
  - `createdBy`: `R10`
  - `updatedBy`: `R10`
  - `deletedBy`: `R10`

### Glossary Metadata Records

- glossary title: `R2`
- glossary repo name: `R2`, and append the losing repo name into `previousRepoNames` using `R5`
- glossary previous repo names: `R5`
- glossary GitHub identity fields:
  - `githubRepoId`: `R4`
  - `githubNodeId`: `R4`
  - `fullName`: `R4`
  - `defaultBranch`: `R4`
- glossary lifecycle fields:
  - `lifecycleState`: `R8`
  - `remoteState`: `R4` when it reflects GitHub state, otherwise `R2`
  - `recordState`: `R8` when it reflects deletion/tombstone state, otherwise `R2`
  - `deletedAt`: `R10`
- glossary language metadata in the record:
  - `sourceLanguage`: language code uses `R3`; display name uses `R2`
  - `targetLanguage`: language code uses `R3`; display name uses `R2`
- glossary counts:
  - `termCount`: `R9`
- glossary audit fields:
  - `createdAt`: `R10`
  - `updatedAt`: `R10`
  - `createdBy`: `R10`
  - `updatedBy`: `R10`
  - `deletedBy`: `R10`

## Project Content Repos

### Project Repo: Project-Level

- `project.json` title: `R11`

### Project Repo: Chapter-Level

- chapter existence itself:
  - create: `R5` by `chapter_id`
  - rename: `R2`
  - soft delete: `R8`
  - restore: `R8`
  - permanent delete: `R8`
- chapter title: `R2`
- chapter lifecycle state: `R8`
- chapter source-file metadata such as `path_hint`: `R2`
- chapter source locale metadata: `R2`
- chapter language list:
  - language membership by `code`: `R5`
  - language code: `R3`
  - language name: `R2`
  - language role: `R2`
  - language removal: only remove a language if no resolved row content remains for that language
- chapter linked glossary selection: `R2`, then validate against existing glossary metadata; clear if invalid
- chapter default source language: `R2`, then validate against resolved chapter languages; clear if invalid
- chapter default target language: `R2`, then validate against resolved chapter languages; clear if invalid
- chapter default preview language: `R2`, then validate against resolved chapter languages; clear if invalid
- chapter source word counts: `R9`

### Project Repo: Row-Level Structure

- row existence itself:
  - insert: `R5` by `row_id`
  - soft delete: `R8`
  - restore: `R8`
  - permanent delete: `R8`
- row ordering via `structure.order_key`: `R12`
- row external ID: `R2`
- row guidance description: `R2`
- row guidance context: `R2`
- row lifecycle state: `R8`
- row status `review_state`: `R7`
- row origin/source row number: `R3`

### Project Repo: Row Field Content

- translation/source text per language: `fields[language].plain_text`: `R1`
- per-language `reviewed`: `R7`, and if the resolved `plain_text` changed from base, force `reviewed = false`
- per-language `please_check`: `R7`

### Project Repo: Row Comments

- comment list membership on a row: `R13`
- comment ordering as a list: `R13`
- comment revision counter: `R9`
- individual comment body: `R13`
- individual comment deletion: `R13`
- individual comment metadata:
  - author login: `R13`
  - author name: `R13`
  - created timestamp: `R13`
  - comment ID: `R13`

## Glossary Content Repos

### Glossary Repo: Glossary-Level

- glossary existence itself:
  - create: `R5` by `glossary_id`
  - rename: `R2`
  - soft delete: `R8`
  - restore: `R8`
  - permanent delete: `R8`
- `glossary.json` title: `R2`
- glossary source language:
  - code: `R3`
  - name: `R2`
- glossary target language:
  - code: `R3`
  - name: `R2`
- glossary lifecycle state: `R8`

### Glossary Repo: Term-Level

- term existence itself:
  - add: `R5` by `term_id`
  - update: field-by-field using the rules below
  - delete: `R8`
- source term variants list: `R6`
- target term variants list: `R6`
- notes to translators: `R2`
- footnote: `R2`
- `untranslated` flag: `R14`
- term lifecycle state: `R8`

## Derived But Still Committed

These are still conflict-capable because they are stored in Git, even though they are derived rather than primary user-authored truth.

- chapter `source_word_counts`: `R9`
- metadata `chapterCount`: `R9`
- metadata `termCount`: `R9`
- comment revision counters: `R9`
