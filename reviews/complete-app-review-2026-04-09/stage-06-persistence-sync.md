# Stage 6 Review: Persistence, Offline Behavior, Sync Orchestration, and Recovery

## Findings

### P1. Generic 403/404 responses are classified as “resource access lost,” which can remove a team locally and kick the user out of the current resource for the wrong reason

- `classifySyncError()` maps every `403` and `404` to `resource_access_lost` in [sync-error.js:48](/Users/hans/Desktop/GnosisTMS/src-ui/app/sync-error.js#L48) through [sync-error.js:49](/Users/hans/Desktop/GnosisTMS/src-ui/app/sync-error.js#L49).
- `handleSyncFailure()` then responds to that classification by removing the team record from storage and, for current-resource flows, clearing project/user state and navigating back to Teams in [sync-recovery.js:31](/Users/hans/Desktop/GnosisTMS/src-ui/app/sync-recovery.js#L31) through [sync-recovery.js:53](/Users/hans/Desktop/GnosisTMS/src-ui/app/sync-recovery.js#L53).

Impact:
- Any 403/404 that is actually caused by an endpoint mismatch, a subresource lookup failure, a backend bug, or an unsupported route can trigger destructive “you no longer have access to this team” recovery.
- That is too aggressive for a generic classifier and can cause local data loss or misleading navigation.

Recommendation:
- Narrow `resource_access_lost` to explicitly recognized backend cases.
- Keep generic 403/404 responses as normal errors unless the backend provides a structured signal that the team/org access itself is gone.

### P2. Editor font-size persistence bypasses the persistent-store migration path, so migrated desktop users can lose their saved font size

- `initializePersistentStorage()` migrates legacy `gnosis-tms-*` localStorage keys into the Tauri store and then clears them from localStorage in [persistent-store.js:119](/Users/hans/Desktop/GnosisTMS/src-ui/app/persistent-store.js#L119) through [persistent-store.js:127](/Users/hans/Desktop/GnosisTMS/src-ui/app/persistent-store.js#L127).
- But the editor font-size preference still reads and writes raw `window.localStorage` directly in [editor-preferences.js:88](/Users/hans/Desktop/GnosisTMS/src-ui/app/editor-preferences.js#L88) through [editor-preferences.js:121](/Users/hans/Desktop/GnosisTMS/src-ui/app/editor-preferences.js#L121), instead of using the shared persistent-store abstraction.

Impact:
- On the first Tauri-store migration, an existing saved editor font size is moved into `app-state.json` and removed from localStorage.
- After that migration, `loadStoredEditorFontSizePx()` no longer sees the saved value, so the app falls back to the default font size until the user changes it again.
- More generally, editor preferences are now split across two persistence systems with different migration and validation behavior.

Recommendation:
- Move editor font-size persistence onto the same `readPersistentValue` / `writePersistentValue` abstraction used for editor location and other app-scoped state.

## Residual Risk

- Offline, cache, and sync-recovery behavior is spread across multiple independently evolving modules: team storage, project cache, sync classification, and resource-specific loaders. The architecture is workable, but it is at the point where any new recovery policy should be introduced with explicit end-to-end scenarios rather than one-off conditionals in each flow.
