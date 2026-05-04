# Assistant Target-Language History Plan

## Goal

Replace the AI Assistant prompt's ambiguous `Current target` block with an explicit target-language edit history. The assistant should understand that the current target text may come from an import, an AI translation, the current user, or another human editor, and should reason from that provenance only when it is relevant to the user's prompt.

## Data Model

Add `targetLanguageHistory` to the assistant row context payload. Each history entry should include:

- `revisionNumber`
- `sourceType`: `file_import`, `ai_model`, `current_user`, `other_user`, or `unknown`
- `sourceLabel`: display label such as `file_import`, `current_user`, `other_user`, or a model label
- `authorType`: `current_user`, `other_user`, or `unknown`
- `authorName`
- `authorLogin`
- `authorEmail`
- `operationType`
- `aiModel`
- `committedAt`
- `text`

Keep `targetText` as a current snapshot and fallback, but prefer `targetLanguageHistory` when available.

## Author Classification

Classify text provenance from operation metadata before author metadata:

- `operationType === "import"` => `file_import`
- `aiModel` exists or `operationType` starts with `ai-` => `ai_model`
- author login/name matches the signed-in GitHub login => `current_user`
- non-empty author metadata that does not match the signed-in user => `other_user`
- otherwise => `unknown`

Important: AI-generated commits are still Git commits authored by a human account. If an AI commit was committed by the current user, classify the text source as `ai_model` and separately record `authorType: current_user`.

For current-user detection:

- Prefer explicit `authorLogin` if available.
- Otherwise parse GitHub noreply emails such as `login@users.noreply.github.com` or `123+login@users.noreply.github.com`.
- Fall back to normalized `authorName`, because local Gnosis TMS commits currently use the GitHub login as the author name.

## History Loading

Before calling `run_ai_assistant_turn`, load the active row's field history for the current target language using the existing `load_gtms_editor_field_history` command.

The returned history is newest-first. Convert it to oldest-first, classify each revision's provenance, then collapse contiguous revisions with the same provenance identity so only the last edit in each uninterrupted group is sent to the model. A current-user run is interrupted by `other_user`, `ai_model`, `file_import`, or `unknown` revisions; `other_user` runs are also split by author identity; AI runs are split by model identity. Always keep the current visible editor text. If the visible editor text differs from the latest committed history entry, treat it as a synthetic `current_user` working-draft revision before collapsing, so it replaces an immediately preceding current-user revision instead of adding a redundant extra entry.

If history loading fails or the project context is unavailable, do not block AI Assistant. Fall back to one `unknown` entry containing the current editor text.

## Prompt Format

Replace `Current target` with `target_language_history`.

The prompt should explain:

- the history is sorted oldest first
- the final revision is the current target-language draft in the editor
- `current_user` edits are strong evidence of the user's preferences and intentional translation choices
- `other_user` edits may also be intentional
- `ai_model` revisions are prior suggestions, not authoritative
- `file_import` is the original imported text of unknown authorship
- the model should use the history only when relevant to the user's request

## Tests

Frontend tests:

- import commit classifies as `file_import`
- AI commit classifies as `ai_model` even if authored by the current user
- matching signed-in GitHub author classifies as `current_user`
- different human author classifies as `other_user`
- unsaved visible target text appends a final `current_user` working draft
- assistant request includes loaded target history

Backend tests:

- assistant prompt includes `target_language_history`
- final revision is described as current draft
- `Current target` no longer appears when target history is provided
- AI model provenance and committing author are both represented
