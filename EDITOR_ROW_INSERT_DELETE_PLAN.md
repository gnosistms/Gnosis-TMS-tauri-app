# Editor Row Insert/Delete Plan

## Confirmed Facts

- Rows are not position-indexed.
- The editor loads `rows/*.json` and sorts rows in memory by:
  1. `structure.order_key`
  2. `row_id` as a tie-breaker
- This is implemented in `src-tauri/src/project_import/chapter_editor.rs`.
- This is also specified in `PROJECT_STORAGE_SPEC.md`.
- Row delete/restore will use row-level `lifecycle.state`, not tombstones.
- Row writes for insert / soft-delete / restore / hard-delete should always be followed by a local git commit.

## Working Assumptions

- `Insert` and active-row soft `Delete` are available to anyone who can edit the chapter.
- Hard delete is owner/admin only.
- `Restore` on deleted rows is available to translators too.
- Order keys stay fixed-width 32-character hex strings.
- New spacing policy: `2^104`.
- No local rebalance. If a gap has no space left, insertion fails with a clear error telling the user to insert nearby instead.

## Implementation Plan

### 1. Backend Row Schema

Add row-level lifecycle metadata to row files:

- `lifecycle.state = "active"` by default
- support `"deleted"` for soft-deleted rows

Extend backend editor row payloads to expose:

- `lifecycleState`
- `orderKey`

This lets the UI derive deleted-row grouping and stable insertion positions without guessing from file order.

### 2. Order-Key Allocator

Add a Rust helper such as:

```rust
fn allocate_order_key_between(previous: Option<&str>, next: Option<&str>) -> Result<String, String>
```

Rules:

- if `previous` and `next` both exist, allocate a strict midpoint
- if only `previous` exists, allocate just after it
- if only `next` exists, allocate just before it
- if there is no integer space left, return an error
- do not rebalance nearby rows

Also update import-time spacing in `src-tauri/src/project_import/chapter_import.rs` from `2^64` to `2^104`.

### 3. Backend Row Commands

Add Tauri commands for:

- insert row before
- insert row after
- soft-delete row
- restore row
- permanently delete row

Each command should:

- resolve the local project repo and chapter path
- update or remove the row JSON file
- stage the touched files with git
- commit immediately as the signed-in user

Follow the existing chapter lifecycle and row-update patterns already used in:

- `src-tauri/src/project_import/chapter_lifecycle.rs`
- `src-tauri/src/project_import/chapter_editor.rs`

### 4. Inserted Row Contents

When inserting a row, create:

- a new UUIDv7 `row_id`
- `lifecycle.state = "active"`
- a fresh `order_key`
- empty text fields for all chapter languages
- default editor flags
- minimal valid status/origin/guidance structure

Return the created row to the UI so the editor can update state without a full reload.

### 5. Row Lifecycle Semantics

Soft delete:

- set row lifecycle to `deleted`
- commit

Restore:

- set row lifecycle back to `active`
- commit

Permanent delete:

- allowed only when the row is already soft-deleted
- remove the row file from disk
- commit

### 6. Frontend Editor State

Extend editor UI state with:

- deleted-row group expansion state
- insert-row modal state
- row permanent-delete modal state

Keep this state in `state.editorChapter` so it survives normal rerenders and chapter refreshes.

### 7. Derived Editor Display Model

Build a display list from raw rows that includes:

- active row cards
- deleted-row separators
- deleted row cards when expanded

Contiguous soft-deleted rows must collapse into a single deleted section.

This grouping should be done in the editor view-model/render layer, not by direct DOM patching.

### 8. Shared Deleted Separator

Reuse the existing shared separator styling and markup via `sectionSeparator()` in `src-ui/lib/ui.js`.

Row deleted sections should behave exactly like deleted projects / glossaries / chapters:

- same CSS
- same chevron
- same open/closed behavior

Label:

- `Deleted rows`

### 9. Row Card Actions

Active row:

- `Insert | Delete`

Deleted row:

- `Restore | Delete` for owner/admin
- `Restore` only for translator

Deleted section:

- one separator for each contiguous deleted run
- expanding the separator reveals all deleted rows in that run

### 10. Insert Modal

Add a modal using the shared modal styling:

- Eyebrow: `INSERT NEW ROW`
- Title: `Before or after?`
- Message: `Do you want to insert the new row before or after this row?`
- Buttons: `Cancel | Before | After`

Choosing `Before` or `After` calls the new backend insert command with the correct neighbor keys.

### 11. Permanent Delete Modal

Add a row permanent-delete modal using the same shared modal CSS as existing permanent-delete dialogs, but without the confirmation text field.

Content:

- Eyebrow: `PERMANENT DELETE`
- Title: `Permanently delete row?`
- Message: `To permanently delete this row, click Delete. This action cannot be undone.`
- Buttons: `Cancel | Delete`

### 12. Permission Rules

Apply these UI rules:

- hard delete visible only to owner/admin
- deleted-row `Restore` visible to translators too
- active-row `Insert` and soft `Delete` available to chapter editors under the working assumption above

Use the existing team capability model rather than adding a new permission system.

### 13. Translate Actions and Flow

Extend translate actions/flow to handle:

- open insert modal
- confirm insert before
- confirm insert after
- soft-delete row
- restore row
- open permanent-delete modal
- confirm permanent delete
- toggle deleted-row section open/closed

This belongs with the existing translate action and editor state flow in:

- `src-ui/app/actions/translate-actions.js`
- `src-ui/app/translate-flow.js`

### 14. Scroll and Virtualization Updates

Structural row operations change row positions, deleted grouping, and row heights.

After insert / soft-delete / restore / hard-delete / show deleted / hide deleted:

- capture the current visible anchor
- invalidate the virtualization row-height cache for the current editor layout
- rerender
- restore the anchor after next paint

This should build on the current systems in:

- `src-ui/app/editor-virtualization.js`
- `src-ui/app/scroll-state.js`

### 15. Tests

Rust tests:

- order-key allocation between two neighbors
- order-key allocation with `previous = null`
- order-key allocation with `next = null`
- explicit no-space error
- insert / soft-delete / restore / hard-delete command behavior
- hard delete requires soft-deleted state

UI tests:

- contiguous deleted rows collapse into one deleted section
- deleted section expand/collapse behavior
- permission-based action visibility
- insert modal rendering and actions
- permanent-delete modal rendering and actions
- scroll anchor / virtualization stability after structural row changes

## Implementation Order

1. backend row schema and payload changes
2. order-key allocator with `2^104` spacing policy
3. backend insert / soft-delete / restore / hard-delete commands
4. frontend editor state and derived deleted-row grouping
5. row actions and modals
6. virtualization / scroll-anchor invalidation after structural changes
7. tests
