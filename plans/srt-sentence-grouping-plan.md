# SRT sentence grouping

## Requirements

- Add Standard / Group fragments at the top of the scrolling editor body for SRT files; default to Standard.
- Group consecutive active, conflict-free cues using source-language sentence-ending punctuation or a gap of at least 500 ms between the previous cue's end and the next cue's start. Never split an original cue; deleted and conflicting rows stay individual and interrupt groups.
- Use identical groups in every language. Keep cue identities, timings, storage, export, and background sync at their original row granularity.
- Show numbered inline fragment boundaries; allow users to edit freely, including deleting markers. Restore missing markers on save using the rules below; allow empty fragments and moving text between fragments. Hide timings in grouped cards.
- Reviewed means all fragments reviewed; Please check means any fragment flagged; Target empty means every target fragment empty. Viewing a group never changes stored statuses. Explicit row actions affect every fragment. Comments belong to the first fragment only.
- Build groups before applying filters; retain whole groups for matches. Evaluate glossary checks on combined text, including terms spanning cue boundaries. Deleted rows and conflicts are never grouped.
- Preserve blank SRT cue export, already supported by the exporter.
- Accept blank cues in Add translation so partially translated SRT exports can be imported again. Empty individual fragments remain untranslated; the grouped Target empty filter matches only when all target fragments are empty.
- Merge is unavailable in Group fragments view. Users must switch to Standard to use the existing cue-level Merge action.

## Agreed filter behavior

Build groups from the full ordered file before filtering. Keep each matching group intact. Language-specific filters retain the existing selected-target-language scope.

| Filter | Grouped behavior |
| --- | --- |
| Show all | Show every active group; preserve existing access to deleted rows. |
| Deleted rows | Show deleted rows individually with their existing restore controls. |
| Reviewed | All fragments reviewed in the selected target language. |
| Not reviewed | At least one fragment unreviewed in the selected target language. |
| Please check | Any fragment flagged in the selected target language. |
| Target empty | All target fragments empty, ignoring formatting and boundary markers. |
| Has image | Any target fragment has an image; retain the image in the displayed group. |
| Has footnote | Any target fragment has a footnote; retain the footnote in the displayed group. |
| Has comments | First fragment only. |
| Has unread comments | First fragment only; hidden comments retain their unread state. |
| Changed after my last edit | Any fragment matches; preserve existing baseline snapshot behavior. |
| Has conflict | Matching conflicting rows remain individual and interrupt groups. |
| Has glossary error | Evaluate the combined sentence in each language, allowing terms to span fragment boundaries. |
| Has timing error | Any fragment has a timing error under the existing timing rules; timings remain hidden in grouped view and can be edited in Standard. |

Search retains the whole group when a fragment matches. Preserve visible-language and case-sensitivity behavior. Permit phrase matches across boundaries without treating boundary markers as searchable content.

## Clarification history

- The all-fragments-reviewed rule supersedes the initial first-fragment status rule. Please check uses any fragment; Target empty uses all fragments. These same rules drive both visible marks and filters.
- Comments remain attached to the first original row only in grouped view. Other comments are preserved but neither displayed nor counted by comment filters for the group.
- Do not group deleted or conflicting rows. A conflicting row becomes eligible for normal automatic grouping once its conflict is resolved.
- Blank Add translation cues and combined-sentence glossary checks were explicitly confirmed.
- A gap of at least 500 ms supersedes the original strictly-greater-than-750-ms threshold. Exactly 500 ms splits groups; shorter gaps do not split on timing alone. This is an initial heuristic to validate against representative SRT files.
- Merge is explicitly excluded from grouped actions. Do not expose a grouped Merge entry point or automatically switch modes on its behalf; the user switches to Standard first.
- Save-time marker restoration supersedes the earlier protected-marker design. Do not prevent marker deletion or repair markers on each keystroke. Missing boundaries leave the later fragments empty; duplicate or reordered markers require correction before saving.

## Architecture and implementation decisions

### Canonical rows and display groups

Keep `state.editorChapter.rows` as the canonical collection of original subtitle rows. Group objects belong to the editor display model, not to persisted content or the canonical row collection. No repository migration, grouping metadata, or changes to cue identities are required. Existing SRT files work immediately.

Introduce a pure `src-ui/app/editor-srt-grouping.js` module that produces ordered display units and lookup maps:

- A unit contains `id`, `memberRowIds`, `firstRowId`, and per-language aggregate state. Individual deleted, conflicted, or non-SRT rows remain singleton units.
- A group identifier derives from its ordered member IDs. Provide `rowId -> displayUnitId` and `displayUnitId -> memberRowIds` maps. Never pass a display ID to a Tauri command expecting a real row ID.
- Preserve original lexicographic row order. Group the full file before applying filters; a filter cannot join previously separate groups.
- Preserve real row IDs for saves, review states, comments, history, search results, AI responses, and conflicts. UI selection additionally identifies the active display unit and the fragment containing the caret.
- Cache projections by grouping inputs, not DOM references. A target text or status change can update a group's data without recomputing source boundaries.

The resulting pipeline is:

```text
canonical cue rows + source language + source timings
  -> ordered display units and member maps
  -> per-language text projections and aggregate diagnostics
  -> filters/search
  -> display cards and virtual list

group edit/action
  -> explicit original row IDs
  -> existing dirty-row state and permission/write queue
  -> Rust row writes
```

### Boundary detection

Use the selected source language for both text and effective timing, including its timing override with fallback to imported SRT timing. Target language punctuation or timing changes must not change membership.

Walk the full ordered row list once. Before adding a cue to a pending group, start a new group if the previous cue ends a sentence or `next.startMs - previous.endMs >= 500`. A gap of 499 ms does not split; exactly 500 ms does. Overlaps and adjacent cues do not create a timing boundary by themselves.

- Use inline-markup base text for sentence detection, excluding ruby readings and tag syntax. Trim trailing whitespace and allow closing quotes/brackets after terminal punctuation.
- Recognize `.`, `?`, `!`, and language-appropriate equivalents, including `。`, `？`, `！`, and `…`. Commas, colons, semicolons, and internal line breaks do not independently split a group.
- Keep the detector separate and fixture-tested. Use source-language sentence segmentation where available, with deterministic fallback rules for trailing abbreviations, initials, decimals, and ellipses. Avoid treating `Dr.` as a sentence end merely because it ends a cue. Record expected behavior for ambiguous cases rather than adding an AI dependency.
- Never split text inside one cue, even if it contains multiple sentences. Only a terminal boundary at the end of that cue affects the following cue.
- Deleted rows, unresolved conflicts, remotely deleted rows, and rows without usable SRT timing end a pending group and display individually. Do not group across them. Invalid/reversed timings also remain individual rather than producing misleading pause calculations.
- A final unfinished sentence remains a group. Do not invent a maximum group length that silently changes the agreed sentence behavior; large unpunctuated runs must remain performant.

### View state and stable edits

Add a chapter-session `srtViewMode` with values `standard` and `group-fragments`. Initialize new chapter sessions to Standard, retain the selection across same-chapter refresh/sync, and do not persist it to shared chapter metadata. This is a local view choice and remains available to read-only users.

Group membership must stay stable while a field is being edited. Capture the ordered member IDs, expected numbered markers, and per-fragment base revision/text in a group edit session before opening the combined field. Keep the freely edited combined draft in that session; do not reinterpret its member identities or replace it with a newly inferred group on each keystroke. Keep the group's current source boundaries until the edit is safely committed or cancelled; then recompute membership. Source-language changes, switching modes, leaving the file, and structural actions flush or retain drafts through the existing close/save guards. If markers are duplicated or reordered, retain the draft and require correction before a save-dependent transition can finish.

Background sync can update unaffected fragments through the current merge flow. If an edited member becomes conflicted, use the same restoration rules to map a valid combined draft to the captured member IDs, preserve those drafts and selections, and display the conflicting fragment individually. If duplicate/reordered markers prevent assignment, retain the complete combined draft for correction rather than guessing or discarding text; display the conflicting canonical row individually. Never apply the combined string to a different set of cues. Conflicts override deferred regrouping; after resolution the row becomes eligible for automatic grouping.

### Combined text and save-time marker restoration

Introduce `src-ui/app/editor-srt-group-text.js` for pure compose/split/offset transforms and `src-ui/app/editor-srt-group-edit-flow.js` for DOM/session orchestration. Retain the editor's existing textarea editing surface and native undo behavior.

- Each saved/display-normalized language field contains the member texts in order with a visually distinct numbered boundary between adjacent fragments. An N-fragment group has N-1 expected boundaries, including when the first, middle, or final fragment is empty. The editable draft may temporarily contain missing, duplicated, or reordered markers.
- Marker identities belong to the edit session and are independent of the actual stored text. Generate tokens that cannot collide with literal cue content. Marker glyphs, numbering, and display padding never reach row files, word counts, exported content, or AI text payloads.
- Maintain maps between combined editor offsets, combined linguistic text offsets, and original `(rowId, rawOffset/baseOffset/visibleOffset)` positions. Do not flatten markup/ruby coordinates into a single string index.
- Let Backspace/Delete, selection replacement, cut, paste, drag/drop, spellcheck replacements, IME composition, and undo/redo edit the draft normally, including its markers. Do not add marker-specific cancellation in `beforeinput` or keydown handlers.
- Keep native clipboard behavior. Pasted copies of current-session markers are subject to the same duplicate/order checks on save; marker-like literal content must not become a different cue identity.
- Keep live edits in place without assigning `textarea.value`, remounting the field, or reinserting markers on normal input. Retain native undo/redo and IME behavior. Do not normalize an unfinished IME composition; defer its save until composition has completed.
- Apply inline-formatting actions using the current draft and marker map; on normalization, preserve valid standalone markup for every resulting cue. Ruby/link operations retain existing selection constraints. Neither formatting nor marker removal may silently drop text or produce invalid per-cue markup.

#### Agreed restoration rules

Normalize only when a save is requested, including existing blur/autosave, mode-switch, navigation, and close flush paths. The normalizer receives the raw draft plus the session's fixed ordered member IDs and expected numbered tokens; it returns per-fragment text and a restored combined display draft, or a correctable validation error.

1. **Valid markers:** assign text between boundaries to the corresponding original fragments.
2. **Missing marker:** retain the combined text in the earlier fragment and leave the later fragment empty. Restore the missing marker immediately before the next surviving marker, or at the end if no later marker survives. Apply the same rule to consecutive missing markers, leaving each corresponding later fragment empty.
3. **All markers deleted:** put the entire draft text in the first fragment, leave every remaining fragment empty, and append the expected markers in order. An entirely deleted draft becomes the original number of empty fragments.
4. **Malformed brackets:** close an opening bracket after its adjacent complete number, or add an opening bracket before a closing bracket's preceding complete number. Delete stray brackets without adjacent numbers while retaining ordinary text. Validate every resulting marker's identity, uniqueness, order, and the absence of extra delimiters. Preserve original literal cue brackets through the session's collision prefix.
5. **Duplicated, reordered, or unexpected markers:** do not save any part of the group. Retain the repaired draft, show the requested correction modal and inline error, and require manual correction. If there is no usable expected marker, append the first expected marker for copying.
6. **Review every repair:** missing-marker restoration and bracket repairs are unsaved proposals. Show the user's automatic-repair modal if the resulting set is valid; otherwise show the manual-correction modal. Both have a single Ok button that only dismisses the dialog. Keep the corrected field open and require an explicit Save sentence draft action. Blur, autosave, and navigation cannot silently accept a proposal. See [srt-marker-repair-dialogs.md](srt-marker-repair-dialogs.md) for the follow-up implementation.

For implementation, recognize only the exact tokens belonging to this session. First validate uniqueness and increasing marker order, then process each run between surviving markers. Assign that run's text to the earliest original fragment in the run and leave the remaining fragments in the run empty. This preserves all text and the original cue count without estimating old character positions or inferring sentence boundaries again. Keep UI padding separate from content so untouched compose/normalize operations round-trip exactly.

Examples for a three-fragment group:

```text
Original:       Hello ⟦1⟧ beautiful ⟦2⟧ world
Edited:         Hello beautiful ⟦2⟧ world
Saved display:  Hello beautiful ⟦1⟧ ⟦2⟧ world
Saved fields:   ["Hello beautiful", "", "world"]

Edited:         Hello beautiful world
Saved display:  Hello beautiful world ⟦1⟧ ⟦2⟧
Saved fields:   ["Hello beautiful world", "", ""]

Edited:         (empty)
Saved display:  ⟦1⟧ ⟦2⟧
Saved fields:   ["", "", ""]
```

Show restored markers in the unsaved draft before the user reviews and explicitly saves it. After a successful save, apply the display update only if the session draft version still matches the saved snapshot; newer typing must not be overwritten by a delayed save response. Failed saves retain the draft for retry. Undo can remove a restored marker again; a subsequent save proposes the same restoration rules for review.

Save only the normalized per-fragment text maps, never the combined draft or UI tokens. Marker validation happens before queued writes, with the captured member IDs retained for concurrency checks. Keep raw session drafts in dirty/close-guard accounting even when invalid markers prevent conversion into canonical row edits. Live combined glossary checks can inspect marker-free draft text without forcing restoration or assigning uncertain fragment ownership.

For linguistic text, join fragment base texts using a language-aware separator: normally a space for space-delimited languages, no artificial space between CJK graphemes where inappropriate. Preserve original fragment whitespace and line breaks in stored content; joins are a display/matching projection only.

## Implementation phases

### 1. Pure grouping and text projection

Add `editor-srt-grouping.js` and `editor-srt-group-text.js`, with matching unit tests. Implement boundary detection, source timing selection, conflict/deleted barriers, ordered unit maps, per-language aggregate states, marker serialization, save-time restoration/validation, and normalized offset mapping.

Acceptance: composing an untouched group and normalizing it returns the exact original texts, including empty fragments, formatting, multiline text, Unicode, and text resembling a marker. Missing markers follow the agreed earlier-fragment/empty-later-fragment rules; duplicate or reordered markers return errors without altering the draft. Grouping does not mutate input rows or flags.

### 2. View control and rendering

Update:

- `src-ui/app/state.js`, `editor-state-flow.js`, and `editor-chapter-load-flow.js` for session state and same-chapter preservation.
- `src-ui/screens/translate.js` and `src-ui/styles/translate.css` for an accessible segmented Standard / Group fragments control inside `.translate-main`, above the file rows and outside the virtualized list. It scrolls naturally, with no sticky positioning, and appears only for SRT-sourced chapters in editor mode.
- `src-ui/app/actions/translate-actions.js` and `translate-flow.js` for mode changes through the existing action and save paths.
- `src-ui/app/editor-screen-model.js` and `editor-row-render.js` for display units and combined language fields. Reuse individual row rendering for deleted/conflicted/non-SRT units.

Hide timing inputs throughout Group fragments mode, including singleton units; Standard remains the way to inspect/edit timings. Do not hide timing-error diagnostics from filter calculations.

Keep every fragment's images, captions, and footnotes visible with its original identity. Footnote numbers are scoped to their original fragment; do not rewrite stored numbering merely to display a group. Auxiliary edit controls must carry the owning row ID, preventing edits to a later fragment from overwriting the first fragment's metadata.

Acceptance: existing files open Standard, the control scrolls away, all languages show identical boundaries, and switching modes issues no content/status writes when there are no dirty edits.

### 3. Editing, saving, and concurrency

Connect the group edit session to `editor-row-input.js`, `input-handlers.js`, `translate-editor-dom-events.js`, `translate-flow.js`, and `editor-persistence-flow.js`.

- Track raw combined edits as dirty session drafts without repairing markers during input. On save, normalize/restore missing markers, validate duplicate/order errors, then stage original member text updates and mark only changed rows/languages dirty. Changes to one fragment must not mark its neighbors edited or clear their statuses unless the existing explicit text-edit rules require it; restoration that empties a later fragment is an explicit text change to that fragment.
- Treat the focused group as the active edit scope for dirty scans, blur, close, source selection, and sync. A scan cannot save one member prematurely while another is still part of the focused edit session.
- Save all changed members from one group edit through one queued batch operation and commit, keeping existing permission checks, repo serialization, failure notices, retry behavior, and row-level history bookkeeping.
- Run the same normalizer for every grouped save entry point. Duplicate/order errors block that group's save and any transition requiring it, while retaining the draft. Display restored markers after successful saves without overwriting edits made while a save was in flight.
- The existing `update_gtms_editor_row_fields_batch_sync` loads current rows and applies fields without the single-row optimistic concurrency contract. Do not assume it is safe for grouped manual edits. Extend its input with optional per-row expected revision/base values, or add a narrowly scoped grouped-save command using the same concurrency helpers as single-row saves.
- Under the repository lock, validate every member before writing any files. Auto-merge disjoint changes using existing semantics. Return overlapping conflicts per original row, retain all local drafts, and commit no partial redistribution if any member fails validation. Rebuild the queued request from current drafts without silently rebasing over a newer overlapping change.
- Use `invokeEditorWriteCommand` / queued write helpers; never invoke saves directly from DOM handlers. Long work stays in the existing Rust blocking-worker pattern.

Backend files: `src-tauri/src/project_import/chapter_editor/mod.rs` for request/response types and `row_fields.rs` for batch preparation/concurrency. Touch `project_import.rs` and `lib.rs` only if a new command is necessary. Preserve backward compatibility for existing AI/batch callers.

Acceptance: moving text across a marker, deleting any subset of markers, or emptying a fragment saves according to the restoration rules and survives leaving/reopening. Duplicate/reordered markers preserve the draft and save nothing. Saving cannot overwrite overlapping remote edits, overwrite newer typing with restored display text, or leave half a redistribution committed.

### 4. Group actions and sidebar ownership

Add `src-ui/app/editor-srt-group-actions.js` as the narrow resolver for group action scope. It expands a display unit into validated canonical member IDs and delegates to existing domain flows. Do not duplicate permission or write queues.

- Reviewed: calculate `nextEnabled = !members.every(reviewed)` once, then assign that same value to every member. Never toggle each member independently.
- Please check: calculate `nextEnabled = !members.some(pleaseCheck)` once, then assign it to every member.
- Group Delete soft-deletes every member in one logical operation; verify the full selection before writing. Deleted rows remain individually restorable. Text style changes apply to every member while switching views never normalizes mixed styles.
- Group Insert means before the first or after the last member, using existing insertion behavior and timing assignment. Do not insert invisibly inside a group.
- Comments target only `firstRowId`; hidden comments do not get loaded or marked read merely because their group was displayed.
- Keep history entries at real-row granularity. In a group, expose fragment-labeled history entries; restoring an entry changes only the explicit owning fragment. History inspection/restoration must never pretend that a first-row revision contains the entire group.
- Preserve existing image, caption, and footnote action ownership. These are fragment-specific attachments, not metadata to duplicate onto all members.

Add/extend batch flag and lifecycle write helpers where needed so explicit group actions use one validated member set and a single commit. Reuse current storage, access checks, and row serialization. Failed group actions retain recoverable state and report the affected member rather than silently normalizing the rest.

Do not render Merge in grouped mode, and guard action dispatch/keyboard entry points against calling it there. Users switch to Standard to use the existing cue-level Merge workflow. Automatic grouping itself must never call the persistent merge command.

### 5. Filters, search, replacement, and glossary checks

Update `editor-filters.js` and `editor-screen-model.js` to filter display units using the agreed table above. Compute timing and changed-since-edit matches on canonical members, then lift matches into units. Keep existing conflict filter locking, with every conflicting row shown individually.

For text search and replacement, update `editor-search-flow.js`, `editor-search-highlighting.js`, and `editor-replace.js`:

- Search marker-free combined linguistic text in visible languages; retain case sensitivity and existing searchable footnote/caption content. Matches can cross a fragment boundary.
- Highlight each contributing fragment range and keep next/previous search navigation anchored to a real member row. UI markers cannot match a query.
- Selecting a group for replacement selects its real members, without expanding scope to filtered-out groups. Existing within-fragment replacement behavior remains unchanged.
- For a match spanning fragments, insert replacement text at the match's starting fragment and remove the matched portions from subsequent fragments; keep intervening boundaries. Present the resulting fragments in the existing review/undo workflow and save them together. Unmatched context stays unchanged.
- Count displayed groups separately from matching original fragments where both counts are shown; do not mislabel group counts as original subtitle counts.

Update `editor-glossary-highlight-cache.js` and `editor-glossary-flow.js` to evaluate marker-free combined source/target texts using the existing `findLongestGlossaryMatches` path. Map selected highlight ranges back across fragment boundaries and rendered markup. Include ordered member IDs, relevant text, language pair, and matcher identity in cache keys. A change to any member invalidates the group's diagnostics/highlights without poisoning Standard-mode caches.

Do not change the generic glossary matcher's global selection policy or allow arbitrary cross-row matching throughout the app. Combined matching is scoped to an explicit sentence group. Apply the same group context to derived-glossary usage and AI glossary hints so terms spanning fragments are not lost outside the linked glossary path.

Acceptance: Reviewed, Not reviewed, Please check, and Target empty agree with visible group marks; hidden comments do not match; split glossary terms highlight correctly and produce the expected error/no-error results in both languages.

### 6. AI translation, review, and assistant application

Audit `editor-ai-translate-flow.js`, `editor-ai-review-flow.js`, their batch flows/request builders, `editor-ai-batch-request.js`, `editor-ai-assistant-flow.js`, and the review/sidebar renderers. A group-level AI action must cover all members, not accidentally operate only on the first row.

- Use existing structured subtitle batch requests/responses with original row IDs. Supply combined sentence context and glossary hints, while allowing target words to move between adjacent member cues and permitting empty returned fragments.
- Review grammar as a full sentence too; preserve per-cue assignment and per-fragment footnotes/captions in review results. Show member results within the selected group's review panel.
- Validate that a response contains the expected member identities exactly once. Reject duplicate/missing/unknown assignments and stale responses if any relevant source/target input changed. Apply accepted results as a group through the concurrency-safe batch path.
- Assistant drafts and Apply must use the same member-aware representation; do not save UI marker tokens or distribute an unstructured paragraph by guesswork.
- Translate All / Review All retain their current file/filter scopes and concurrency limits. Where grouped mode controls scope, expand whole matching units into canonical member IDs once, avoiding duplicate work. Bound provider request sizes; oversized groups can use bounded cue batches with complete sentence context and a coherent apply boundary.
- Keep the current provider/key configuration flow. This feature introduces no new provider, credential, or AI-dependent boundary detection.

Acceptance: row-level AI actions process every fragment of the selected group, results retain exact cue identities, missing/stale results apply nothing from the affected response, and Standard-mode AI behavior remains unchanged.

### 7. Virtualization, focus, and background sync

Update `editor-virtual-list.js`, `editor-virtualization.js`, `editor-row-scoped-render.js`, `editor-row-connection.js`, and relevant anchor consumers in `scroll-state.js` / `editor-location.js`.

- Virtualize display units. Expand each member row invalidation to its containing unit; a non-first member save/status update must refresh the mounted group.
- Include view mode and ordered membership in height-cache identity. Focus pinning and selection snapshots must resolve an edited member to its group's card.
- Keep scroll anchors in original row coordinates, with member/field offsets as needed. Map member anchors into the current display unit on Standard/group transitions, filter restoration, context jumps, project-search navigation, and preview-to-editor jumps.
- Structural regrouping uses the existing anchored body render path. Ordinary group content/status updates use row-scoped patching, with the existing filter-active fallback. `editor-scroll-session.js` remains the sole viewport owner; do not add capture/restore pairs around renders.
- Preserve active selection, drafts, and scroll during sync. Unrelated updates must not remount the focused combined textarea. A resolved conflict or source/timing change recomputes affected groups when safe.
- Ensure the control above the list is included correctly in virtual-list offsets and does not become pinned by the virtualization implementation.

Acceptance: editing, saves, row-height changes, filters, and sync preserve the viewport and caret on virtualized files, including updates to members other than the first.

### 8. Blank cues in Add translation and export parity

Change `src-tauri/src/project_import/chapter_import/srt.rs::parse_translation_srt` to accept a valid cue number and timing line followed by zero text lines. Retain empty cues in order with `text = ""`; do not filter or collapse them. Preserve all existing encoding, size, cue-count, timestamp, and malformed-block validation.

Trace `chapter_editor/aligned_translation/subtitles.rs` and its shared application helpers end-to-end:

- Exact timestamp assignments preserve a matched blank target as empty text on its owning row.
- Blank overlap matches retain timing-based assignment; exclude blank targets from AI meaning-comparison samples because there is no translation meaning to validate. They still participate in timestamp matching and mismatch counts normally.
- Unmatched blank cues remain represented by their own timing-bearing insertion entries. Empty text must not cause them to disappear or shift subsequent assignments.
- Accept a structurally valid all-blank translation file; reject an actually empty/no-cue file. Do not broaden unrelated non-SRT import behavior.

Retain `chapter_editor/chapter_export.rs::render_srt_document` behavior: emit empty timed blocks and original per-language effective timings; do not export grouped text or markers. Add export/import round-trip coverage, including leading, consecutive, and trailing blank cues. Preview and every other export continue to consume canonical rows independently of the current grouping mode.

## Validation and completion criteria

### Focused automated coverage

| Area | Required cases |
| --- | --- |
| Grouping | Punctuation variants, closing quotes, abbreviations/initials/decimals/ellipses, multiline cues, multiple sentences inside one cue, 499/500/501 ms gaps, overlaps, final incomplete sentence, missing/invalid timing, mixed-format rows, source timing overrides, deleted/conflict barriers. |
| Projection/editing | Exact compose/normalize round trip; unrestricted marker deletion via Delete/Backspace, selection replacement, cut/paste, drag/drop, IME, and undo/redo; missing first/middle/last/consecutive/all markers; earlier-fragment assignment and empty later fragments; all text deleted; duplicate/reordered errors without draft loss; literal marker-like content; markup/ruby/link validity; no UI tokens in saved fields. |
| State/actions | All/any status aggregation, no writes on clean mode switch, uniform group flag updates, group delete, insertion at group edges, Merge unavailable through both UI and dispatch in grouped mode, first-row comments only, fragment-owned attachments/history, unchanged word counts when switching views. |
| Filtering/search/glossary | Every filter in the agreed table, group-before-filter boundaries, hidden comments stay unread, cross-fragment search/replacement, combined glossary phrases and target validation, derived glossary hints, CJK joining, cache invalidation from a non-first member. |
| Persistence/sync | One logical grouped save; normalization through blur/autosave, mode switch, navigation, and close; invalid raw drafts included in dirty guards; restoration visible after success; newer typing preserved during delayed saves; changes in multiple languages; queued-save rebasing; disjoint remote edits; overlapping conflicts; permission denial; write/commit failure; reload with drafts; conflict resolution and regrouping. |
| AI | Complete cue assignments, blank outputs, duplicate/missing IDs, stale response guards, combined grammar/context/glossary, group Apply, filtered batch scope, existing provider setup. |
| SRT round trip | Leading/consecutive/trailing/all-blank cues, multiline text, encoding variants, exact and overlap matching, unmatched blank insertion, malformed inputs, unchanged cue timings, no grouping data in export. |
| Browser/virtualization | Control scrolls away, Standard default, mode-switch anchor mapping, many short cues and very large groups, repeated virtual-window mounts, IME and undo, non-first member updates, sync while typing, conflict isolation, search/context/preview jumps. |

Add unit tests beside each new pure module. Extend the existing editor state, persistence, filter, glossary, search, row rendering, AI, and Add translation tests where their contracts change. Add a dedicated `tests/browser/editor-srt-grouping.spec.js` using the existing regression fixture and mocked command infrastructure, including new batch conflict responses.

Run focused tests as each phase lands, followed by `npm test`, `npm run build`, `npm run audit:unused`, relevant Rust import/editor tests, and the dedicated browser suite plus affected editor regressions. Record pre-existing failures separately and confirm no new unused-export findings. Follow the repository Rust build-cache guard when running Cargo.

Inspect representative fragmented SRT files, including unpunctuated captions, to validate the 500 ms heuristic against actual resulting groups. Exercise native macOS and Windows scroll/edit behavior; browser emulation alone is insufficient for the repository's Windows scroll requirement. Record unavailable platform verification explicitly rather than marking it passed.

Completion requires all agreed behaviors above to work together: editing plus saving plus sync plus filters plus glossary/AI consumers. A grouped rendering-only prototype is not feature completion.

## Proposed commit sequence

1. Pure grouping/text maps and fixtures.
2. Session mode, control, and display rendering.
3. Free textarea editing, save-time marker restoration/validation, and concurrency-safe grouped persistence.
4. Aggregate statuses, actions, comments, and attachment/history ownership.
5. Group filters, cross-fragment search/replacement, and glossary diagnostics.
6. Group-aware AI actions and result application.
7. Virtualization/focus/sync integration and browser regressions (integration work begins with rendering and editing; this commit closes remaining coverage).
8. Blank Add translation cues and export/import regressions; final integrated verification notes.

Each commit remains focused and includes the relevant tests. Coordinate with existing uncommitted edits in the workspace; do not reset or absorb unrelated work.

## Status

Implemented. Standard remains the default, Merge is Standard-only, and grouped fields permit ordinary marker deletion with save-time restoration. Duplicate and reordered markers preserve the draft and block saving.

### Implementation notes

- Canonical rows and stored cue identities remain unchanged. Display cards use the first real cue ID for existing editor selection/DOM contracts, plus an ordered `srtGroup.key` for membership and virtualizer identity. Member invalidations and viewport anchors resolve to the containing card; IPC always receives real cue IDs.
- Grouping uses deterministic terminal punctuation and abbreviation rules, effective source timings, and the inclusive 500 ms pause threshold. Group membership is captured during editing. Conflicts, deletions, and intervening structural changes isolate captured members and expose the preserved sentence draft for recovery, rather than attaching it to a smaller group.
- Raw textarea drafts participate in dirty/close guards. Saves restore missing markers, balance formatting that spans a boundary, and write original fields through the existing repository operation queue. Delayed saves retain newer typing and rebase its next save onto the committed values.
- The batch command now accepts optional expected text, footnote, and caption bases. Under the repository lock it checks every member, including imported conflicts, before preparing writes. A conflict aborts the entire batch. Group AI corrections, including footnote-only changes, use this same guarded batch; disjoint remote source changes are retained and adopted in the editor.
- Status aggregation, filters, search/replacement, combined glossary matching, and group AI requests operate on complete groups. AI assignments must contain every requested real cue ID exactly once; stale or malformed responses apply nothing. Oversized requests are bounded and include complete sentence context. Ordinary unstructured assistant drafts follow the agreed missing-marker rule when applied: text goes to the first cue and remaining cues are empty.
- Footnotes, images, captions, and history retain their original cue ownership. A new footnote uses the fragment containing the cursor. Comments remain first-cue-only in grouped view. The view and fragment-history controls use the existing segmented-control styling.
- Add translation accepts blank SRT cues, including all-blank files, through both frontend validation and native timestamp import. Empty TXT/non-SRT inputs remain invalid. Blank targets are excluded from meaning comparison, and export/import tests preserve blank cue positions and timings.

### Verification (2026-10-23)

| Check | Result |
| --- | --- |
| `npm test` | 2,960 frontend tests and 25 workflow tests passed. |
| `npm run build` | Passed; existing bundle-size advisory remains. |
| Rust library suite, after the build-cache guard | 892 passed, 11 intentionally ignored (including paid AI evaluations). |
| Dedicated SRT browser suite in installed Chrome | All 21 passed, including native undo, marker restoration, conflict recovery, delayed saves, group flags/deletion, filtering, replacement, virtualization, mocked AI translation/review/Apply, footnote-only batch saves, and disjoint source changes. |
| Affected existing editor browser regressions | 25 passed on the main run; the remaining footnote/history test lost its first typed character during focus handoff under concurrent suites and passed in isolation. All 26 selected cases passed across those runs. |
| Targeted ESLint / whitespace checks | No errors; existing unused-argument warnings remain. |
| `npm run audit:unused` | Output unchanged from the earlier workspace audit; no findings in the new SRT modules. |
| Visual inspection | Grouped editor, scrolling control, marker display, and fragment-history selector inspected in Chrome. |

Native macOS WebView/IME and Windows scrolling/editing still require manual platform verification. Browser tests use mocked native commands and mocked AI responses; no paid provider calls were made. No representative real SRT files were present in the repository, so the 500 ms heuristic is covered by fixtures and still needs validation against user files.
