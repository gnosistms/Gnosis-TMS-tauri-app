# AI Review And AI Key Plan

## Goal

Add an `AI Review` section to the editor review tab and add an `AI Key` settings page so users can save an OpenAI API key locally and use AI-powered grammar/spelling review. The design should be modular so later support for Gemini, Claude, DeepSeek, and other providers can be added without reworking the feature.

## Scope

This plan covers:

- Review-tab AI revision suggestions
- Manual AI review triggered only by `Review now`
- Manual `Review now` fallback when the editor text is dirty
- `Apply` flow to overwrite the editor text with the AI suggestion and save it
- Missing-key warning modal
- New `AI Key` page linked from the Teams page
- Encrypted local secret storage for AI provider keys
- Provider abstraction for future multi-provider support

## Current constraints in this codebase

1. The editor sidebar already supports multiple tabs and collapsible review/history sections.
2. The review tab currently contains a `Last update` section and already reuses the history diff renderer.
3. The app has a plain persistent store in `src-ui/app/persistent-store.js`, but no encrypted secret store for API keys yet.
4. Screen routing is centralized in `src-ui/main.js` and `src-ui/app/navigation.js`.
5. Tauri currently includes `tauri-plugin-store`, but not a secret-management plugin.
6. The editor save flow already has a clean persistence hook in `src-ui/app/editor-persistence-flow.js`, which is the right place to handle `Apply` saves and any future AI-related persistence rules.

## Architecture

### 1. Introduce a provider-agnostic AI layer in Tauri

Add a backend AI module tree under `src-tauri/src/ai/`.

Suggested structure:

- `src-tauri/src/ai/mod.rs`
- `src-tauri/src/ai/types.rs`
- `src-tauri/src/ai/providers/mod.rs`
- `src-tauri/src/ai/providers/openai.rs`
- `src-tauri/src/ai_secret_storage.rs`

Core backend task contract:

- `AiProviderId` enum, starting with `OpenAi`
- `AiReviewRequest`
  - `provider_id`
  - `text`
  - `language_code`
- `AiReviewResponse`
  - `suggested_text`

Keep this task-based instead of provider-API-based. The editor should ask for “review this text”, not “call OpenAI directly”.

### 2. Store AI keys in encrypted local storage

Requirement 15 calls for encrypted local Tauri storage. The current app does not have that yet, so this should use Tauri Stronghold instead of the plain store plugin.

Implementation direction:

- Add the Tauri Stronghold plugin
- Wrap it in `src-tauri/src/ai_secret_storage.rs`
- Store secrets by provider id, for example:
  - `ai-provider/openai/api-key`
  - later `ai-provider/gemini/api-key`

Do not store the API key in:

- the existing plain Tauri store
- repo-backed project files
- frontend-only memory as the source of truth

### 3. Use the current OpenAI Responses API through a provider adapter

Implement the first provider in `src-tauri/src/ai/providers/openai.rs`.

Prompt:

`Check spelling and grammar on the following text. Ouput only your suggested revised version of the text. Do not explain what you changed and why. Text to review: [current editor text]`

Behavior:

- send plain text input
- return only the model’s suggested revised text
- normalize empty/invalid responses into clear app errors
- keep the chosen model centralized inside the adapter or provider config

Do not hard-code provider-specific details into the editor UI.

## Frontend state model

### 4. Add editor AI review state

Extend `createEditorChapterState()` in `src-ui/app/state.js` with an `aiReview` state object.

Suggested shape:

- `status`: `idle | loading | ready | error | applying`
- `error`
- `rowId`
- `languageCode`
- `requestKey`
- `sourceText`
- `suggestedText`
- `expandedSectionKeys`

Also preserve/reconcile it in `src-ui/app/editor-state-flow.js` the same way the app already preserves:

- history state
- comments state
- review section expansion state

### 5. Add frontend AI settings state

Add an `aiSettings` state bucket for the new page.

Suggested shape:

- `status`: `idle | loading | saving | ready | error`
- `error`
- `providerId`: `"openai"`
- `apiKey`
- `hasLoaded`

This should be modeled as provider-based state, not a bare `openAiKey` string, so future providers slot in cleanly.

## Editor review-tab changes

### 6. Add a second collapsible section in the Review tab

Extend `src-ui/screens/translate-sidebar.js`.

The Review tab should render:

1. `Last update`
2. `AI Review`

The `AI Review` section should:

- be collapsible
- use the same chevron/header pattern as the existing History and `Last update` review section
- preserve expanded/collapsed state across rerenders

### 7. Render AI suggestions with diff markings

When an AI suggestion exists, render it with diff markings against the current editor text using the existing diff renderer:

- reuse `renderHistoryContent()` from `src-ui/screens/translate-history-pane.js`

The comparison should be:

- current editor text as baseline
- AI suggestion as revised text

This makes the AI changes visually consistent with the rest of the app.

### 8. Show `Review now` when the text is dirty and no current review exists

If the active editor text has changed since the last completed AI review, do not show a stale suggestion.

Instead show:

- button: `Review now`

The stale suggestion should be suppressed whenever:

- the field is dirty
- or the saved suggestion was produced from older source text

## AI review flows

### 9. Add manual `Review now`

Add an action and flow for manual AI review from the editor sidebar.

Behavior:

- if key exists, review the current editor text immediately
- if key does not exist, open the missing-key warning modal
- do not trigger AI review automatically after save

Because this feature costs money, `Review now` is the only way to initiate an AI review.

### 10. Add `Apply`

Below the suggested AI revision, render:

- button label: `Apply`
- tooltip: `Update the translation to match this AI suggested revision`

When clicked:

- replace the active editor field text with the suggested text
- save the row using the existing save path
- do not automatically run AI review again after that save

After `Apply`, the editor should save the suggestion and return to a normal manual-review state for any later edits.

## Missing-key flow

### 12. Add the missing-key warning modal

When the user clicks `Review now` with no saved OpenAI key, open a modal with:

- Eyebrow: `NEEDS API KEY`
- Title: `You have not saved an AI API key yet`
- Message: `In order to use this AI feature, you must enter an AI API key. Click below to do that.`
- Buttons: `Cancel | Enter key`

Behavior:

- `Cancel` closes the modal
- `Enter key` navigates to the new `AI Key` page

This modal should only appear on explicit review attempts.

## AI Key page

### 13. Add a new screen and route

Add a new `aiKey` page to:

- `src-ui/main.js`
- `src-ui/app/navigation.js`
- `src-ui/app/state.js`

Create:

- `src-ui/screens/ai-key.js`

Update document titles and screen renderer maps accordingly.

### 14. Add the `AI Key` button on Teams

On the Teams page, next to `Logout`, add an `AI Key` button that navigates to the new page.

This should be done in:

- `src-ui/screens/teams/index.js`
- possibly `src-ui/lib/ui.js` if nav composition needs a small helper adjustment

### 15. Build the AI Key page using modal-card styling without a backdrop

The page title should be:

- `AI Key`

The page body should center a dialog-like card styled with the app’s modal styles, but without a real modal backdrop.

Dialog contents:

- Eyebrow: `OPENAI KEY`
- Title: `Enter your Open AI`
- Message:
  - `An Open AI key provides access to AI features in this app. Without it, the app will still work but there will be no AI translation and no AI review functions.`
  - `To get an Open AI key, sign up for an Open AI account at platform.openai.com. Then open this page and click "+ Create new secret key".`
- Text box:
  - empty if no key is saved
  - populated with the saved key if present
- Button:
  - `Save`

Use a normal page layout, not a modal overlay.

### 16. Add page load/save flows for the AI key

Frontend flow tasks:

- load saved provider secret presence/value when entering the page
- update state on text input
- save through Tauri command on `Save`
- show inline error if save/load fails

Also update input focus preservation in `src-ui/main.js` so rerenders do not knock the cursor out of the new field.

## Event and action wiring

### 17. Add new editor actions

Add action handlers for:

- `review-editor-text-now`
- `apply-editor-ai-review`
- `toggle-editor-review-section:ai-review`
- possibly `toggle-editor-review-section:last-update` if review sections stay generalized

Wire these through:

- `src-ui/app/actions/translate-actions.js`
- `src-ui/app/translate-flow.js`

### 18. Add AI key page actions and inputs

Add:

- navigation to `aiKey`
- AI key input handling
- save action

Update:

- `src-ui/app/input-handlers.js`
- any page-specific action module if needed

## Backend commands

### 19. Add Tauri commands

Add commands in `src-tauri/src/lib.rs`:

- `load_ai_provider_secret`
- `save_ai_provider_secret`
- `clear_ai_provider_secret`
- `run_ai_review`

If the frontend only needs to know whether a key exists vs loading the literal key, split those commands accordingly. The user requirement says the saved key should be shown in the input box, so loading the current saved value is required for now.

### 20. Normalize AI errors

Return human-readable errors from the backend for cases like:

- no key saved
- invalid key
- upstream authentication error
- rate limiting
- network failure
- malformed AI response

The frontend should show these inline inside the `AI Review` section or the `AI Key` page rather than as raw backend traces.

## Testing

### 21. Rust tests

Add backend coverage for:

- encrypted secret storage round-trip
- OpenAI response parsing
- AI review response normalization

### 22. Frontend unit tests

Add JS tests for:

- AI review section state transitions
- dirty text suppressing stale suggestion
- `Apply` saving the suggestion without triggering another review
- missing-key modal gating
- AI key page load/save state
- review-section collapse state preservation

### 23. Integration verification

Verify manually or with browser tests:

1. Save a translation -> AI Review remains manual until `Review now` is clicked
2. AI suggestion shows diff markings
3. Click `Apply` -> editor updates -> row saves -> no immediate second AI review
4. Edit text without saving -> AI suggestion disappears -> `Review now` appears
5. Click `Review now` without key -> modal opens -> `Enter key` navigates to AI Key page
6. Save key -> return to editor -> review works

## Recommended implementation order

1. Add backend AI provider abstraction
2. Add encrypted secret storage
3. Add OpenAI review adapter and Tauri commands
4. Add `AI Key` screen and frontend save/load flows
5. Add editor AI review state
6. Add `AI Review` section UI
7. Add manual `Review now` flow
8. Add `Apply` flow
9. Add missing-key modal
10. Add tests and polish

## Notes on extensibility

To support Gemini, Claude, DeepSeek, and others later:

- keep provider selection and provider secrets keyed by provider id
- keep editor code task-based (`review text`) instead of provider-based (`call OpenAI`)
- keep provider adapters behind a shared backend interface
- avoid baking provider names into generic editor state

That lets future providers be added as:

- new provider adapter
- new provider config card on the `AI Key` page
- optional model selection UI later

## References

- OpenAI Responses API: https://developers.openai.com/api/reference/resources/responses/methods/create
- Tauri Stronghold plugin: https://v2.tauri.app/plugin/stronghold/
