# JS Review Strategy — src-ui/

**Total**: ~87,000 source lines · ~43,000 test lines · ~250 source files (~155 test files)  
**Sessions**: ~34  
**Review order**: Security-sensitive first, then infrastructure, domain by domain, screens last

Test files (`.test.js`) are not listed in batch file tables below — read each test file alongside
its paired source file. Tests document expected behavior and expose the invariants a reviewer
needs to evaluate the source.

---

## Batch 1 — Auth, Security & Telemetry ★
*~1,100 lines · 1 session*

```
app/auth-flow.js                    (255)
app/auth-storage.js                  (52)
app/github-app-permissions.js        (61)
app/team-ai-crypto.js               (162)
app/telemetry.js                    (230)
app/telemetry-scrub.js              (199)
app/telemetry-consent.js             (64)
app/telemetry-disclosure-flow.js     (53)
```

Review first. `auth-flow.js` owns the GitHub OAuth dance and token hand-off to the broker.
`telemetry-scrub.js` is the gatekeeper that strips PII before any event leaves the app —
a failure here leaks content data to Sentry. `team-ai-crypto.js` wraps key derivation for
AI provider secret storage. `github-app-permissions.js` gates installation write-access on
the frontend.

Focus on: token handling, scrubbing completeness, crypto correctness, consent gate bypass.

---

## Batch 2 — Bootstrap & Runtime
*~2,800 lines · 1 session*

```
src-ui/main.js                      (905)
app/state.js                      (1,257)
app/runtime.js                      (292)
app/query-client.js                  (75)
app/dev-runtime-flags.js             (73)
app/constants.js                      (2)
app/events.js                       (217)
app/event-target.js                  (15)
```

`state.js` defines the authoritative application state shape and the single query-cache
observer path. `runtime.js` wraps every `invoke()` call and is the one place all Tauri
command rejections are routed to telemetry. `main.js` is the entry point and wires all
top-level observers.

Focus on: state initialisation order, query cache observer setup, `invoke()` wrapper
completeness, `dev-runtime-flags.js` guard (must be dead code in release builds).

---

## Batch 3 — Navigation, Permissions & Offline
*~1,400 lines · 1 session*

```
app/navigation.js                   (463)
app/navigation-loading.js            (33)
app/navigation-leave-loading.js      (21)
app/permissions.js                  (130)
app/user-actions.js                 (127)
app/offline-connectivity.js          (80)
app/offline-policy.js                (76)
app/offline-ui.js                     (5)
app/connection-failure.js            (83)
app/status-feedback.js              (105)
app/error-display.js                 (44)
app/autosize.js                     (116)
app/action-dispatcher.js             (79)
app/action-helpers.js                (17)
```

`permissions.js` derives named capabilities from `membershipRole` — verify no raw role
strings leak into call sites and no boolean flag shortcuts exist. `offline-policy.js`
decides which operations are blocked when offline; check it is consistent with the
AGENTS.md rule that sync state must not disable user-facing actions.

---

## Batch 4 — Resource Framework
*~2,100 lines · 1 session*

```
app/repo-resource/query-controller.js  (462)
app/repo-resource/cache.js              (86)
app/resource-lifecycle-engine.js       (264)
app/resource-page-controller.js        (283)
app/resource-resolution.js             (200)
app/resource-write-policy.js           (214)
app/resource-capabilities.js            (82)
app/resource-entity-modal.js           (167)
app/resource-top-level-controller.js    (27)
app/resource-create-flow.js             (42)
app/optimistic-collection.js            (35)
app/write-intent-coordinator.js        (257)
```

The nascent shared framework that glossary and QA lists both build on. `optimistic-collection.js`
applies pending mutations to every incoming snapshot — the correctness of every rename/delete/create
across background syncs depends on it. `write-intent-coordinator.js` sequences write intents
and must not reorder or drop them.

Focus on: mutation ordering, snapshot application idempotency, pending-intent lifecycle
(creation → apply → resolve/abandon).

---

## Batch 5 — Sync & Write Infrastructure
*~1,700 lines · 1 session*

```
app/sync-error.js                   (134)
app/sync-recovery.js                 (79)
app/sync-state.js                     (6)
app/page-sync.js                    (138)
app/local-hard-delete-store.js      (193)
app/repo-write-queue.js             (646)
app/repo-transport-eligibility.js   (120)
app/repo-names.js                    (23)
app/persistent-store.js             (135)
app/updater-flow.js                 (209)
```

`repo-write-queue.js` serialises all repo-write operations from the frontend. Correctness
here affects every resource sync. `local-hard-delete-store.js` is the tombstone registry —
verify deletions are durable across restarts. `updater-flow.js` checks for and applies
in-app updates; verify it does not silently swallow update errors.

---

## Batch 6 — Team Core
*~2,800 lines · 1 session*

```
app/team-flow/actions.js            (656)
app/team-flow/shared.js             (232)
app/team-flow/setup.js              (215)
app/team-flow/sync.js                (88)
app/team-flow/team-records.js        (46)
app/team-flow/auto-open.js           (11)
app/team-metadata-flow.js           (726)
app/team-query.js                   (311)
app/team-storage.js                 (270)
app/team-cache.js                    (48)
app/team-write-coordinator.js       (191)
app/team-setup-flow.js               (27)
```

`team-metadata-flow.js` is the most complex file here — it manages the metadata-first
mutation lifecycle documented in AGENTS.md. `team-flow/actions.js` is the action surface
for team operations. Verify `team-write-coordinator.js` correctly sequences writes and that
`team-query.js` does not write state outside the query cache.

---

## Batch 7 — Team Members, Migration & Team AI
*~2,700 lines · 1 session*

```
app/team-members-flow.js            (782)
app/team-resource-migration-flow.js (428)
app/invite-user-flow.js             (217)
app/member-query.js                 (203)
app/member-write-coordinator.js     (150)
app/member-cache.js                 (101)
app/member-shared.js                 (93)
app/team-ai-flow.js                 (649)
app/team-ai-storage.js               (79)
```

`team-ai-flow.js` manages AI provider settings per team and interacts with the encrypted
secret storage reviewed in Batch 1. `team-resource-migration-flow.js` handles the migration
path for teams moving between repo layouts — a correctness-critical flow. Verify invite
operations do not expose internal team state to the invited user before acceptance.

---

## Batch 8 — AI Settings & Provider Configuration
*~1,900 lines · 1 session*

```
app/ai-settings-flow.js           (1,212)
app/ai-settings-preferences.js      (36)
app/ai-provider-config.js            (85)
app/ai-action-config.js             (427)
app/ai-action-preferences.js         (99)
```

`ai-settings-flow.js` is the primary AI configuration surface — it reads and writes provider
keys (routed through the encrypted store reviewed in Batch 1). `ai-action-config.js` defines
per-action AI behaviour and prompt templates. Check that no provider key or user content is
included in action config telemetry.

---

## Batch 9 — Project Core
*~3,100 lines · 1 session*

```
app/project-flow.js               (1,249)
app/project-query.js                (886)
app/project-cache.js                (252)
app/project-lifecycle-flow.js       (135)
app/project-context.js               (46)
app/project-top-level-state.js       (58)
app/project-page-write-state.js      (54)
app/project-write-coordinator.js    (403)
app/project-glossary-flow.js         (31)
```

`project-flow.js` is the main entry point for all project operations. `project-query.js`
owns the query cache integration for projects — verify it is the only write path for
`state.projects`. `project-write-coordinator.js` sequences project writes; check for
race conditions between concurrent project operations.

---

## Batch 10 — Project Discovery, Sync & Search
*~2,300 lines · 1 session*

```
app/project-discovery.js            (271)
app/project-discovery-flow.js     (1,271)
app/project-repo-sync-flow.js       (304)
app/project-repo-sync-shared.js      (99)
app/project-search-flow.js          (268)
app/project-search-state.js          (24)
app/project-search-highlighting.js   (27)
```

`project-discovery-flow.js` (1,271 lines) is the largest file in this batch and runs the
initial repo scan. Verify it publishes state exclusively through the injected query-layer
callbacks — no direct `state.*` writes. `project-repo-sync-flow.js` coordinates the
frontend side of the sync loop started by the Rust backend.

---

## Batch 11 — Project Chapter, Import & Export
*~3,900 lines · 2 sessions*

### 11a: Chapter & Import (~3,120 lines)

```
app/project-chapter-flow.js       (1,787)
app/project-import-flow.js        (1,333)
```

### 11b: Translation, Export & Local Files (~800 lines)

```
app/project-add-translation-flow.js (414)
app/project-export-flow.js          (248)
app/import-file-limit.js             (16)
app/local-file-picker.js             (54)
```

`project-chapter-flow.js` and `project-import-flow.js` are the two largest project files.
The import flow calls the backend HTML/DOCX parser; verify it validates `invoke()` results
before writing chapter state. `project-add-translation-flow.js` adds a target language to
an existing chapter — check for race conditions when the editor is open.

---

## Batch 12 — Glossary Core & Sync
*~3,600 lines · 1 session*

```
app/glossary-flow.js                 (69)
app/glossary-query.js               (483)
app/glossary-discovery.js           (358)
app/glossary-discovery-flow.js      (233)
app/glossary-shared.js              (426)
app/glossary-default-flow.js        (104)
app/glossary-default-cache.js        (54)
app/glossary-cache.js                (32)
app/glossary-write-coordinator.js   (121)
app/glossary-lifecycle-flow.js      (493)
app/glossary-old-layout-discard-flow.js (141)
app/glossary-background-sync.js     (226)
app/glossary-repo-flow.js           (823)
```

Review this batch and Batch 13 together for parity. Any divergence in behaviour between
glossary and QA list core is a latent bug (AGENTS.md parity rule).

---

## Batch 13 — QA List Core & Sync
*~2,900 lines · 1 session*

```
app/qa-list-flow.js                  (64)
app/qa-list-query.js                (510)
app/qa-list-discovery-flow.js       (163)
app/qa-list-shared.js               (223)
app/qa-list-top-level-state.js      (218)
app/qa-list-default-flow.js         (107)
app/qa-list-default-cache.js         (61)
app/qa-list-cache.js                 (32)
app/qa-list-lifecycle-flow.js       (518)
app/qa-list-write-coordinator.js    (121)
app/qa-list-old-layout-discard-flow.js (141)
app/qa-list-repo-flow.js            (711)
```

Review parity with Batch 12. For every finding in Batch 12, check whether the same issue
exists here. For every QA finding here, check whether it was missed in Batch 12.

---

## Batch 14 — Glossary Terms & Editor
*~2,900 lines · 1 session*

```
app/glossary-term-draft.js          (688)
app/glossary-term-sync.js           (375)
app/glossary-term-write-coordinator.js (30)
app/glossary-term-inline-markup-flow.js (132)
app/glossary-ruby.js                (179)
app/glossary-editor-flow.js         (403)
app/glossary-editor-query.js         (70)
app/glossary-editor-navigation-source.js (11)
app/glossary-import-flow.js         (905)
app/glossary-export-flow.js          (66)
```

`glossary-term-draft.js` (688 lines) manages unsaved term edits — verify drafts are
correctly discarded on navigation and not accidentally persisted. `glossary-import-flow.js`
handles TMX import; it is a file-parsing surface and deserves scrutiny for malformed-input
handling (consistent with Rust Batch 7 finding on TMX parsing).

---

## Batch 15 — QA Terms & Editor
*~2,300 lines · 1 session*

```
app/qa-term-sync.js                 (366)
app/qa-term-draft.js                (331)
app/qa-term-write-coordinator.js     (45)
app/qa-term-inline-markup-flow.js   (111)
app/qa-list-editor-flow.js          (499)
app/qa-list-editor-query.js          (71)
app/qa-list-import-flow.js          (827)
app/qa-list-export-flow.js           (66)
```

Parity batch for Batch 14. Focus especially on `qa-term-draft.js` vs `glossary-term-draft.js`
and `qa-list-import-flow.js` vs `glossary-import-flow.js`.

---

## Batch 16 — Inline Markup Subsystem
*~1,800 lines · 1 session*

```
app/editor-inline-markup/parser.js     (262)
app/editor-inline-markup/serialize.js  (297)
app/editor-inline-markup/transforms.js (470)
app/editor-inline-markup/ranges.js     (272)
app/editor-inline-markup/highlights.js (256)
app/editor-inline-markup/ruby.js        (40)
app/editor-inline-markup.js             (27)
app/editor-inline-markup-flow.js       (128)
```

This subsystem has its own `AGENTS.md` with grammar invariants and round-trip rules. Read
it before starting this batch. The parser and serializer must produce a round-trip identity
for every valid inline markup string; any asymmetry is a data-loss bug. `transforms.js` is
algorithmically dense.

---

## Batch 17 — Editor State, Screen & Preferences
*~3,600 lines · 1 session*

```
app/editor-state-flow.js            (713)
app/editor-persistence-state.js     (675)
app/editor-screen-model.js          (551)
app/editor-write-permission.js      (355)
app/editor-preferences.js           (217)
app/editor-navigation-guards.js      (30)
app/editor-language-utils.js        (174)
app/editor-utils.js                 (194)
app/editor-regression-fixture.js    (709)
```

`editor-state-flow.js` and `editor-persistence-state.js` define the top-level editor state
shape and transition model. `editor-write-permission.js` gates all destructive editor operations
— verify no path bypasses it. `editor-regression-fixture.js` is a regression test fixture;
review it to understand the historical edge cases the editor must handle.

---

## Batch 18 — Editor Row Core
*~3,100 lines · 1 session*

```
app/editor-row-structure-state.js   (418)
app/editor-row-structure-flow.js    (513)
app/editor-row-render.js          (1,081)
app/editor-row-input.js              (47)
app/editor-row-text-style.js         (70)
app/editor-row-patch.js             (218)
app/editor-row-merge.js             (256)
app/editor-row-persistence-model.js (138)
app/editor-row-sync-flow.js         (331)
```

`editor-row-render.js` (1,081 lines) is the row rendering engine. `editor-row-merge.js`
handles merge of concurrent edits and is algorithmically sensitive. `editor-row-patch.js`
applies incremental patches to row content — verify patches are applied in order and that
out-of-order delivery is handled.

---

## Batch 19 — Editor Persistence & Background Sync
*~3,700 lines · 2 sessions*

### 19a: Persistence Core (~2,600 lines)

```
app/editor-persistence-flow.js    (2,105)
app/editor-operation-queue.js       (408)
app/editor-dirty-row-state.js        (62)
```

### 19b: Background Sync (~1,100 lines)

```
app/editor-background-sync.js       (857)
app/editor-queued-write.js          (179)
app/editor-structural-change-flow.js (65)
```

`editor-persistence-flow.js` (2,105 lines) is the largest editor source file. It orchestrates
the write pipeline from user edit to IPC command. Check that the operation queue (`editor-operation-queue.js`)
correctly serialises concurrent writes and that background sync (`editor-background-sync.js`)
does not drop in-flight operations when the editor is closed.

---

## Batch 20 — Editor History, Conflicts & Chapter
*~2,800 lines · 1 session*

```
app/editor-history-flow.js          (514)
app/editor-history-state.js         (509)
app/editor-history.js               (353)
app/editor-conflict-resolution-flow.js (474)
app/editor-conflict-resolution-model.js (127)
app/editor-conflicts.js              (69)
app/editor-deleted-rows.js          (232)
app/editor-chapter-load-flow.js     (501)
app/editor-chapter-reload.js         (20)
```

The conflict resolution system is the JS counterpart to `git_conflicts.rs` reviewed in Rust
Batch 10. Verify that the JS model and Rust model agree on what constitutes a conflict and
that the resolution UI correctly reflects all conflict states. History state must survive
chapter reload (`editor-chapter-reload.js`).

---

## Batch 21 — Editor Virtualization, Scroll & Search
*~3,700 lines · 2 sessions*

### 21a: Virtualization & Scroll (~1,900 lines)

```
app/editor-virtual-list.js          (815)
app/editor-virtualization.js        (247)
app/editor-virtualization-shared.js (195)
app/scroll-state.js                 (619)
app/translate-viewport.js            (99)
app/editor-selection-flow.js        (181)
```

### 21b: Location, Filters & Search (~1,800 lines)

```
app/editor-location.js              (206)
app/editor-show-context.js           (25)
app/editor-filters.js               (357)
app/editor-replace.js               (211)
app/editor-search-flow.js           (634)
app/editor-search-highlighting.js    (98)
app/editor-visible-glossary-sync.js  (57)
```

`editor-virtual-list.js` implements TanStack Virtual integration for the row list — scroll
bugs on Windows differ from macOS (AGENTS.md). `editor-search-flow.js` and `editor-replace.js`
touch all rows; verify they do not trigger unnecessary re-renders or re-syncs of unchanged rows.

---

## Batch 22 — Editor Glossary Integration
*~3,700 lines · 2 sessions*

### 22a: Derivation (~1,700 lines)

```
app/editor-derive-glossaries-flow.js (570)
app/editor-derived-glossary-flow.js  (478)
app/editor-derived-glossary-state.js (428)
app/editor-derived-glossary-cache.js (172)
```

### 22b: Highlighting (~2,000 lines)

```
app/editor-glossary-flow.js         (307)
app/editor-glossary-highlighting.js (1,248)
app/editor-glossary-highlight-cache.js (156)
app/editor-glossary-alignment-debug.js (336)
```

`editor-glossary-highlighting.js` (1,248 lines) computes highlight spans for every visible
row — a performance-sensitive path. Verify highlights are computed incrementally (not full
recompute on each keystroke) and that the cache (`editor-glossary-highlight-cache.js`)
correctly invalidates on glossary changes.

---

## Batch 23 — Editor AI
*~5,700 lines · 2 sessions*

### 23a: Translate & Review (~2,500 lines)

```
app/editor-ai-translate-flow.js     (953)
app/editor-ai-translate-all-flow.js (489)
app/editor-ai-translate-state.js    (184)
app/editor-ai-translate-target.js    (59)
app/editor-ai-review-flow.js        (429)
app/editor-ai-review-all-flow.js    (569)
app/editor-ai-review-state.js       (237)
app/editor-ai-review-request.js     (236)
app/editor-review-state.js           (83)
```

### 23b: Assistant (~2,400 lines)

```
app/editor-ai-assistant-flow.js   (1,817)
app/editor-ai-assistant-state.js    (505)
app/editor-ai-assistant-cache.js    (115)
```

Check that no document content, translation text, or glossary terms are included in
telemetry or error logs. Verify streaming response handling correctly terminates on error
and does not leave partial AI output in the editor state. Batch operations (`*-all-flow.js`)
must be cancellable and must not corrupt row state on partial completion.

---

## Batch 24 — Editor Image, Comments, Footnotes & Preview
*~4,000 lines · 2 sessions*

### 24a: Images (~1,800 lines)

```
app/editor-image-flow.js          (1,328)
app/editor-images.js                (107)
app/editor-image-debug.js           (255)
app/editor-image-preview-size.js    (128)
```

### 24b: Comments, Footnotes & Preview (~2,200 lines)

```
app/editor-comments-flow.js         (526)
app/editor-comments-state.js        (322)
app/editor-comments.js               (79)
app/editor-comment-preferences.js   (167)
app/editor-footnotes.js             (188)
app/editor-static-footnote-markers.js (34)
app/editor-preview.js               (623)
app/editor-preview-flow.js          (246)
```

`editor-image-flow.js` (1,328 lines) handles image embed, upload, and drag-drop. Verify
file type and size validation occur before the backend `invoke()` call, not just in the
UI. `editor-preview.js` renders a read-only preview of the translation — verify it cannot
execute injected script content from untrusted chapter data.

---

## Batch 25 — Translate Flow & Input
*~3,300 lines · 1 session*

```
app/translate-flow.js             (1,013)
app/translate-editor-dom-events.js  (585)
app/translate-open-chapter-flow.js    (1)
app/input-handlers.js               (967)
app/editor-target-language-manager-flow.js (396)
app/language-picker-alphabet-index.js (65)
app/focused-input-state.js          (152)
app/chapter-workflow-status.js       (38)
app/actions/translate-actions.js    (745)
```

`input-handlers.js` (967 lines) handles all raw DOM input events for the translation
editor — a critical path for correctness and responsiveness. `translate-editor-dom-events.js`
wires browser events to flow modules. Check that `translate-flow.js` does not perform
direct state mutations outside the query cache.

---

## Batch 26 — Actions, Events & Lib
*~3,800 lines · 1 session*

```
app/actions/project-actions.js      (421)
app/actions/glossary-actions.js     (260)
app/actions/qa-actions.js           (186)
app/actions/navigation-actions.js   (160)
app/actions/team-actions.js         (121)
app/actions/ai-actions.js            (44)
app/actions/auth-actions.js          (30)
app/actions/telemetry-actions.js     (15)
app/actions/updater-actions.js       (12)
app/events/glossary-tooltip.js      (501)
app/events/native-drops.js          (376)
app/events/glossary-term-variant-drag.js (239)
app/events/target-language-drag.js  (211)
app/events/keyboard-shortcuts.js    (141)
lib/ui.js                           (569)
lib/language-options.js             (202)
lib/alphabet-index-scroll.js        (268)
```

Action files (`actions/`) are thin dispatch layers — they should contain no business logic
and no state writes; check for any that violate this. `events/native-drops.js` handles
OS-level file drops, which are an untrusted input surface — verify it validates file types
before forwarding to import flows.

---

## Batch 27 — Screens: Translate, Projects & Editor Modals
*~5,200 lines · 2 sessions*

### 27a: Translate & Projects (~3,300 lines)

```
screens/translate.js                (346)
screens/translate-sidebar.js        (782)
screens/translate-toolbar.js        (490)
screens/translate-review-pane.js    (387)
screens/translate-history-shared.js (275)
screens/translate-history-pane.js   (225)
screens/translate-comments-pane.js  (136)
screens/projects.js                 (376)
screens/project-import-modal.js     (321)
screens/project-chapter-list-render.js (177)
screens/project-list-render.js      (127)
screens/project-add-translation-modal.js (262)
screens/project-deleted-section.js  (109)
screens/project-glossary-selector.js (77)
screens/start.js                     (96)
screens/app-update-modal.js         (105)
screens/navigation-loading-modal.js  (23)
screens/connection-failure-modal.js  (40)
```

### 27b: Project & Editor Modals (~1,900 lines)

```
screens/project-export-modal.js     (171)
screens/project-creation-modal.js    (52)
screens/project-rename-modal.js      (52)
screens/project-permanent-deletion-modal.js (64)
screens/project-clear-deleted-files-modal.js (64)
screens/project-old-layout-discard-modal.js  (42)
screens/chapter-permanent-deletion-modal.js  (64)
screens/chapter-rename-modal.js      (55)
screens/repo-old-layout-discard-modal.js     (46)
screens/project-icons.js             (35)
screens/project-chapter-status-badge.js      (32)
screens/editor-conflict-resolution-modal.js  (168)
screens/editor-clear-translations-modal.js   (137)
screens/editor-ai-review-all-modal.js (192)
screens/editor-ai-translate-all-modal.js (144)
screens/editor-derive-glossaries-modal.js (120)
screens/editor-batch-progress.js     (77)
screens/editor-row-insert-modal.js   (44)
screens/editor-row-permanent-deletion-modal.js (40)
screens/editor-replace-undo-modal.js  (40)
screens/editor-unreview-all-modal.js  (40)
screens/editor-image-invalid-file-modal.js (22)
screens/editor-image-preview-overlay.js    (17)
```

Screen files are rendering-only — they should contain no business logic. Flag any direct
`invoke()` call, state mutation, or business rule in a screen file.

---

## Batch 28 — Screens: Glossary, QA, Teams, Users & AI
*~4,000 lines · 1-2 sessions*

```
screens/glossaries.js               (301)
screens/glossary-editor.js          (148)
screens/glossary-term-editor-modal.js (291)
screens/glossary-creation-modal.js   (90)
screens/glossary-rename-modal.js     (52)
screens/glossary-import-modal.js     (43)
screens/glossary-permanent-deletion-modal.js (64)
screens/glossary-old-layout-discard-modal.js  (10)
screens/qa.js                       (297)
screens/qa-list-editor.js           (140)
screens/qa-term-editor-modal.js      (82)
screens/qa-list-creation-modal.js    (73)
screens/qa-list-rename-modal.js      (48)
screens/qa-list-import-modal.js      (43)
screens/qa-list-permanent-deletion-modal.js (65)
screens/qa-list-old-layout-discard-modal.js  (10)
screens/users.js                    (198)
screens/invite-user-modal.js        (183)
screens/teams/index.js               (62)
screens/teams/team-list.js          (159)
screens/teams/setup-modal.js        (182)
screens/teams/rename-modal.js        (55)
screens/teams/permanent-delete-modal.js (64)
screens/teams/leave-modal.js         (42)
screens/team-member-owner-modal.js   (42)
screens/team-member-owner-demotion-modal.js (63)
screens/team-member-remove-modal.js  (71)
screens/team-resource-migration-modal.js (24)
screens/target-language-manager-modal.js (187)
screens/telemetry-disclosure-modal.js (40)
screens/ai-key.js                   (451)
screens/ai-review-missing-key-modal.js (39)
```

`ai-key.js` (451 lines) is the largest screen here and presents AI provider key input —
verify keys are not echoed to the DOM in a copy-able form and are not included in any
rendered error message. `telemetry-disclosure-modal.js` presents the consent gate — verify
it cannot be bypassed by navigation.

---

## Every Batch Review

Each JS review batch must include passes over the following cross-cutting concerns.

### Error-handling sweep

Scan for bare or swallowed errors:

- `invoke(...)` with no `.catch()` or `try/catch`  
- `.then(...)` chains with no `.catch()`  
- `async` functions whose return value is never awaited by the caller  
- `catch (e) {}` or `.catch(() => {})` that silently discard failures  

Classify each site as one of:

- **Expected silence**: user cancellation, offline state, validation failure the UI already reflects  
- **Reported elsewhere**: the `invoke()` rejection is already caught by `runtime.js` and routed to telemetry — a duplicate catch here is noise  
- **Non-fatal defect signal**: the user-facing operation continued but developers need visibility

For non-fatal defect signals, recommend a small telemetry event via `telemetry.js` carrying
only a stable operation name and a pre-scrubbed error string. Never include command payloads,
document text, translation content, glossary/QA terms, API keys, session tokens, GitHub
identity, or full file paths. Do not recommend telemetry for expected control flow.

### Query cache bypass sweep

Flag any direct assignment to top-level state collections outside `queryClient.setQueryData`
or `queryClient.invalidateQueries`:

```
state.projects = ...
state.glossaries.push(...)
state.qaLists[id] = ...
```

State written around the side of the query cache creates stuck-state bugs (AGENTS.md).
The only valid write path for `state.projects`, `state.glossaries`, and `state.qaLists`
is through the query cache observer defined in `project-query.js`, `glossary-query.js`,
and `qa-list-query.js` respectively.

### Telemetry content sweep

Verify no telemetry event or error log includes:

- Document text, translation content, source language content  
- Glossary terms, QA terms, or any user-authored content  
- AI prompts, AI responses  
- API keys, session tokens, or bearer tokens  
- GitHub repository names, organisation names, or user identities  
- Absolute local file paths  

Only stable operation names (e.g. `"editor.persist.chapter"`) and scrubbed error
strings (e.g. `"INVOKE_TIMEOUT"`, not the raw error message) are permitted.

### Main-thread blocking sweep

For event handlers and functions called directly from DOM events, verify they do not:

- Traverse large content arrays (>500 rows) synchronously without pagination  
- Compute highlight spans or glossary matches for the full document on every keystroke  
- Block on a synchronous `invoke()` simulation  

This is the JS analogue to the Rust Standard V (blocking the IPC path).

---

## Naming Convention

Review files are saved as `reviews/YYYY-MM-DD-review.md`. The first review session on a
given date uses the date-only name (e.g. `reviews/2026-06-04-review.md`). Additional
sessions on the same date append a batch number starting at 2 to avoid collisions
(e.g. `reviews/2026-06-04-batch-2-review.md`).

---

## Summary

| Batch | Domain | Lines | Sessions | Status |
|---|---|---|---|---|
| 1 | Auth, Security & Telemetry ★ | ~1,100 | 1 | ✅ [2026-06-04](2026-06-04-review.md) |
| 2 | Bootstrap & Runtime | ~2,800 | 1 | — |
| 3 | Navigation, Permissions & Offline | ~1,400 | 1 | — |
| 4 | Resource Framework | ~2,100 | 1 | — |
| 5 | Sync & Write Infrastructure | ~1,700 | 1 | — |
| 6 | Team Core | ~2,800 | 1 | — |
| 7 | Team Members, Migration & AI | ~2,700 | 1 | — |
| 8 | AI Settings & Provider Configuration | ~1,900 | 1 | — |
| 9 | Project Core | ~3,100 | 1 | — |
| 10 | Project Discovery, Sync & Search | ~2,300 | 1 | — |
| 11 | Project Chapter, Import & Export | ~3,900 | 2 | — |
| 12 | Glossary Core & Sync | ~3,600 | 1 | — |
| 13 | QA List Core & Sync | ~2,900 | 1 | — |
| 14 | Glossary Terms & Editor | ~2,900 | 1 | — |
| 15 | QA Terms & Editor | ~2,300 | 1 | — |
| 16 | Inline Markup Subsystem | ~1,800 | 1 | — |
| 17 | Editor State, Screen & Preferences | ~3,600 | 1 | — |
| 18 | Editor Row Core | ~3,100 | 1 | — |
| 19 | Editor Persistence & Background Sync | ~3,700 | 2 | — |
| 20 | Editor History, Conflicts & Chapter | ~2,800 | 1 | — |
| 21 | Editor Virtualization, Scroll & Search | ~3,700 | 2 | — |
| 22 | Editor Glossary Integration | ~3,700 | 2 | — |
| 23 | Editor AI | ~5,700 | 2 | — |
| 24 | Editor Image, Comments, Footnotes & Preview | ~4,000 | 2 | — |
| 25 | Translate Flow & Input | ~3,300 | 1 | — |
| 26 | Actions, Events & Lib | ~3,800 | 1 | — |
| 27 | Screens: Translate, Projects & Editor Modals | ~5,200 | 2 | — |
| 28 | Screens: Glossary, QA, Teams, Users & AI | ~4,000 | 1-2 | — |
| **Total** | | **~87,000** | **~34** | |
