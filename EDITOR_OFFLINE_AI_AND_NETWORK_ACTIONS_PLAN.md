# Editor Offline AI and Network Actions Plan

## Objective

Disable or route editor actions that still appear enabled in offline mode but require AI provider access, network access, or immediate remote sync.

## Current Flow

Offline mode is enforced mostly at the action-dispatcher level through `isOfflineBlockedAction()` in `src-ui/app/offline-policy.js`, with additional local guards such as the early returns in `src-ui/app/editor-background-sync.js`.

The editor already supports local chapter loading and local row edits offline. However, several editor actions still render as available and can reach provider/network or sync-dependent code paths:

- row AI translate
- AI translate all
- AI review
- AI Assistant send
- derive glossaries
- target language manager submit
- editor-triggered AI config/model loading paths

## Narrow Safe Change Surface

Add explicit offline gates at the editor action/render layer first. Avoid touching virtualization, row rendering, row persistence internals, or local editor write paths.

## Non-Goals

- Do not change editor virtualization behavior.
- Do not block local row editing, local history, local comments, local image operations, or local chapter loading.
- Do not redesign remote sync or create a deferred sync queue in this first pass.
- Do not rewrite AI configuration storage.

## Plan

### 1. Centralize editor offline capability checks

Add small explicit helpers, likely in `src-ui/app/offline-policy.js`, for editor actions that require online/provider access.

Candidate helpers:

- `editorAiActionsAreOfflineBlocked()`
- `editorNetworkActionsAreOfflineBlocked()`

Keep the checks explicit rather than broad so local editor actions remain available.

### 2. Disable row-level AI actions in the sidebar

Update `src-ui/screens/translate-sidebar.js` so offline mode disables:

- row AI translate buttons
- AI Review `Review now`
- AI Assistant send path/composer affordance

Show a short tooltip or inline disabled message, for example:

> AI actions are unavailable offline.

Keep `Apply` for an already-created AI review suggestion enabled because applying an existing suggestion is a local row update.

### 3. Block AI actions at dispatch/flow level

Add offline blocks in `src-ui/app/offline-policy.js` so stale DOM, keyboard shortcuts, or direct dispatches cannot start online work.

Add exact actions:

- `review-editor-text-now`
- `run-editor-ai-assistant`
- `confirm-editor-ai-translate-all`
- `confirm-editor-derive-glossaries`

Add prefix blocks:

- `run-editor-ai-translate:`

Do not block `apply-editor-ai-review` unless the implementation proves it can start online work. Current expected behavior is local apply only.

### 4. Disable toolbar AI batch actions

Update `src-ui/screens/translate-toolbar.js` to disable while offline:

- `AI translate all`
- `Derive glossaries`

Keep `Unreview All` enabled because it is local.

If the relevant modal is already open when offline mode starts, disable its confirm action too:

- `src-ui/screens/editor-ai-translate-all-modal.js`
- `src-ui/screens/editor-derive-glossaries-modal.js`

### 5. Target language manager: disable short-term

Short-term safest behavior: disable target language add/remove while offline.

Gate:

- opening the manager through source/target `Add / Remove`
- `submit-target-language-manager`

Reason: backend `update_gtms_chapter_languages_sync` currently commits locally and then calls `sync_gtms_project_editor_repo_sync`. If offline sync fails, the backend rolls back the local language change. That is not a good offline workflow.

Future routed option: split this into local commit plus deferred sync, but that is a larger design change.

### 6. Quiet AI config/model loading while offline

Audit these paths:

- `ensureSharedAiActionConfigurationLoaded`
- `ensureAiProviderModelsLoaded`
- provider model probing

When offline:

- use cached/stored AI action preferences only
- skip remote model list/probe calls
- avoid showing provider/network errors during editor load

This should behave as a quiet no-op, not a modal or error banner.

### 7. Tests

Add or update focused tests for:

- `offline-policy.js` blocks AI translate, AI review, AI assistant, batch translate, and derive-glossary actions.
- `translate-sidebar.js` renders AI controls disabled offline.
- `translate-toolbar.js` disables `AI translate all` and `Derive glossaries` offline.
- `translate-toolbar.js` keeps `Unreview All` enabled offline.
- target language manager cannot submit offline.
- existing local editor functions remain enabled offline:
  - row edits
  - reviewed / please-check toggles
  - comments
  - history restore
  - local image changes

### 8. Manual Verification

In offline mode:

- local chapter opens
- row edits save locally
- background sync remains stopped
- AI translate is disabled/blocked
- AI review is disabled/blocked
- AI Assistant send is disabled/blocked
- AI translate all is disabled/blocked
- derive glossaries is disabled/blocked
- target language manager submit is disabled/blocked
- `Unreview All` still works
- no full editor body rerender or virtualization behavior is introduced by the change

## Risks Deferred

- A full local-only target-language manager workflow needs a separate design because it changes the sync contract.
- AI settings pages may need their own broader offline policy beyond the editor-specific behavior here.
- Existing stored AI suggestions/drafts should remain locally applicable; this plan preserves that unless implementation reveals hidden provider calls.
