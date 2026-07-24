# OpenAI GPT-5.6 model picker support

Status: implemented 2026-07-23 (uncommitted). Rust 437 tests pass, JS 1716 tests
pass, `audit:unused` clean.

## Problem

The GPT-5.6 family (released to the OpenAI API 2026-07-09) does not appear in the AI
settings model picker. The recommended-model shortlist in
`src-tauri/src/ai/providers/openai.rs` only recognizes ids shaped like `gpt-X.Y`,
`gpt-X.Y-mini`, `gpt-X.Y-nano`. GPT-5.6 uses new tier names — `gpt-5.6-sol`
(flagship), `gpt-5.6-terra` (balanced), `gpt-5.6-luna` (fast) — so all three are
dropped, and because older matching models exist the shortlist replaces the raw
list entirely.

## Decisions (Hans, 2026-07-23)

1. Never automatically upgrade a saved model selection when a new model is released.
2. Show only the two most recent GPT versions in the picker (currently 5.5 and 5.6).
3. Recognize Sol/Terra/Luna as families, picker order sol → terra → luna.

## Changes

### `src-tauri/src/ai/providers/openai.rs`

- Extend `OpenAiModelFamily` with `Sol`, `Terra`, `Luna` (suffixes `-sol`, `-terra`,
  `-luna`). Picker ranks: General 0, Sol 1, Terra 2, Luna 3, Mini 4, Nano 5, so a
  bare version alias (e.g. `gpt-5.6`) sorts before the tier ids and the old
  mini/nano ordering is preserved for 5.5-era versions.
- In `shortlist_recommended_models`, after the existing sort (version desc, rank,
  label), keep only models belonging to the two highest distinct versions. The
  ≥5.4 floor and the empty-shortlist → full-list fallback stay as they are.
- Update the two shortlist tests, add coverage for Sol/Terra/Luna parsing, the
  two-version cap, and dated-snapshot exclusion of the new suffixes.

### `src-ui/app/ai-action-config.js`

- Extend the model-id regex to `(pro|mini|nano|sol|terra|luna)`; sol/terra/luna are
  their own kinds in `resolveOpenAiFallbackKind` (no cross-scheme mapping — an old
  saved `gpt-5.5` is never treated as upgradeable to `gpt-5.6-sol`).
- Generalize the no-fallback default pick to capability groups so a fresh pick lands
  on the newest flagship: flagship (general, sol) → mid (mini, terra) → small
  (nano, luna). Same-version tie prefers the bare alias over the tier id.
- Export a helper identifying the provider default model id (`gpt-5.4`), used by the
  sync rule below.
- `DEFAULT_MODEL_ID_BY_PROVIDER.openai` stays `gpt-5.4`. It acts as the
  "never configured" sentinel; bumping it is a separate decision.

### `src-ui/app/ai-settings-flow.js`

- `syncAiActionModelSelectionsForProvider`: for OpenAI, a non-empty saved model id
  that is no longer in the fetched list is kept as-is (no remap) — unless it equals
  the default sentinel `gpt-5.4`, which was materialized into preferences for users
  who never chose a model and repicks to the newest flagship. Gemini keeps its
  existing re-resolve behavior (preview ids rotate and are actually delisted).

### `src-ui/screens/ai-key.js`

- `renderModelSelectOptions`: if the selected model id is not among the fetched
  options, append it at the bottom of the select so the true saved selection stays
  visible and selected. Switching away from such a legacy entry removes it from the
  list (returning to it requires it to be listed again).

## Consequences to be aware of

- A user who explicitly picked `gpt-5.4` (rather than never configuring) is
  indistinguishable from the materialized default and will be repicked to the newest
  flagship once. All other explicit selections never move.
- Requests keep using the saved model id directly, so a kept-but-unlisted model
  continues to work as long as OpenAI serves it.

## Out of scope (follow-ups if wanted)

- Applying the two-most-recent-versions rule to Gemini/Claude/DeepSeek pickers.
- Bumping the fresh-install default model id.

## Test plan

- `cargo test` (openai provider tests) in `src-tauri/`.
- `npm test` — update sync/remap expectations that changed by design; add
  sol/terra/luna cases.
- `npm run audit:unused`.
