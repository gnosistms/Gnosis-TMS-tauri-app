# Editor Comments Plan

## Goal

Add row-level comments created inside the editor view.

The feature should:

- show a comments indicator button on the target-language panel of each row
- open a `Comments` tab in the right sidebar for the selected row
- store the actual comments in the row JSON file
- support add and delete
- support unread/read state locally per signed-in user

This is a different concept from `guidance.comments`, which are imported source-side notes.

## Naming

Use this terminology consistently:

- `guidance.comments`: imported/source guidance comments
- `editor comments`: comments created from the translation editor UI
- visible UI tab label: `Comments`

Recommended row-file field names:

- `editor_comments`
- `editor_comments_revision`

## Storage Model

Do **not** reuse `guidance.comments`.

Reason:

- that field already belongs to imported source guidance
- it is not an editor discussion thread
- overloading it would blur two different concepts and make future behavior harder to reason about

Recommended row-file additions:

```json
"editor_comments_revision": 0,
"editor_comments": [
  {
    "comment_id": "uuid-v7",
    "author_login": "octocat",
    "author_name": "The Octocat",
    "body": "Please verify this wording.",
    "created_at": "2026-04-13T09:12:33Z"
  }
]
```

Rules:

- comments are row-level, not language-level
- `editor_comments_revision` increments on every add or delete
- comments may be stored oldest-first or newest-first in JSON; the UI should render newest first
- delete physically removes the comment from the array
- git history is the audit trail; no soft-delete field is needed for comments

## Unread Model

Unread state should be **local-only**, not written into the row file.

Recommended local storage:

- scoped per signed-in GitHub login
- keyed by chapter id and row id
- value is the last seen comment revision for that row

Recommended shape:

```json
{
  "chapter-id": {
    "row-id": 7
  }
}
```

Unread rule:

- a row is unread when `editor_comments_revision > lastSeenCommentsRevision`

Read rule:

- when the user opens the `Comments` tab for a row, store that row’s current revision locally as seen

After local write operations:

- when the local user saves a comment, immediately mark the new revision as seen locally
- when the local user deletes a comment, immediately mark the new revision as seen locally

Why this model:

- one integer per row locally
- one integer compare per row for the button state
- no per-comment read tracking
- no git writes just for reading comments
- add/delete are both handled correctly

## Insertions / Deletions / Row Lifecycle

This is the intended behavior for row structure changes:

- insert new row:
  - initialize `editor_comments_revision` to `0`
  - initialize `editor_comments` to `[]`
  - no local read entry is needed
- soft-delete row:
  - keep comments and revision unchanged
  - local seen revision remains associated with the same `rowId`
- restore row:
  - keep comments and revision unchanged
- permanently delete row:
  - remove the row file as usual
  - prune any matching local seen-revision entry when the chapter next loads
- reordering or insertion above/below the row:
  - no special handling needed, because tracking is by `rowId`, not row position

## UI Specification

### Row button

Add a third marker-style button before `reviewed` and `please check`.

Rules:

- only shown on the target-language panel
- same size, spacing, and general chrome as the existing marker buttons
- icon style matches the current marker family
- symbol is `!`
- tooltip: `View / edit comments`

States:

- off:
  - same off-state color family as reviewed / please-check
- on/read:
  - blue outline/icon state
- on/unread:
  - blue filled state with the `!` cut out of the center

Click behavior:

- set the active row if needed
- switch the right sidebar to the `Comments` tab
- load comments for that row if they are not already loaded
- after successful load, mark the row’s comment revision as seen locally

### Sidebar

The right sidebar should become a tabbed sidebar rather than a history-only sidebar.

Tabs:

- `History`
- `Comments`
- `Duplicates`

Comments tab behavior:

- linked to the active row
- newest comments first
- use the same visual structure as history where practical:
  - author
  - content
  - time/date
  - action row
- in place of `Restore`, show `Delete`
- `Delete` is shown only for the comment author
- at the bottom:
  - multiline comment text box
  - `Save comment` button
  - `Save comment` disabled when trimmed text is empty

Empty states:

- no active row:
  - `Select a translation to view comments.`
- no comments on the active row:
  - `No comments yet for this row.`

## Backend Plan

### Step 1: Extend row serde types

Files:

- `src-tauri/src/project_import/chapter_editor.rs`

Changes:

- extend `StoredRowFile` with:
  - `editor_comments_revision`
  - `editor_comments`
- default missing values cleanly for old row files:
  - revision defaults to `0`
  - comments defaults to `[]`
- extend inserted-row creation to include those defaults

### Step 2: Extend chapter editor load payload

Files:

- `src-tauri/src/project_import/chapter_editor.rs`

Changes:

- extend `EditorRow` / load response so each row includes comment summary data needed for the button:
  - `comment_count`
  - `comments_revision`

Optional:

- `latest_comment_author_login` if later needed for small UI polish

This avoids loading the full comment thread for every row during chapter open.

### Step 3: Add row comment commands

Files:

- `src-tauri/src/project_import/chapter_editor.rs`
- `src-tauri/src/project_import.rs`
- `src-tauri/src/lib.rs`

Commands:

- `load_gtms_editor_row_comments`
- `save_gtms_editor_row_comment`
- `delete_gtms_editor_row_comment`

Recommended response behavior:

- `load_gtms_editor_row_comments`
  - returns full comments for a single row plus its `commentsRevision`
- `save_gtms_editor_row_comment`
  - appends a new comment
  - increments `editor_comments_revision`
  - commits once
  - returns updated comment list plus row summary
- `delete_gtms_editor_row_comment`
  - removes the targeted comment
  - verifies author ownership
  - increments `editor_comments_revision`
  - commits once
  - returns updated comment list plus row summary

Authoring rules:

- author login and display name come from the signed-in GitHub user
- backend enforces delete ownership even if the UI hides the delete button

Suggested commit messages:

- `Add comment to row <row_id>`
- `Delete comment from row <row_id>`

Suggested commit metadata operation:

- `editor-comment`

## Frontend Plan

### Step 4: Add editor comments state

Files:

- `src-ui/app/state.js`

Add to `editorChapter`:

- `sidebarTab`, likely one of:
  - `"history"`
  - `"comments"`
  - `"duplicates"`
- `comments`, separate from `history`

Recommended `comments` state shape:

```js
{
  status: "idle" | "loading" | "saving" | "deleting" | "error",
  error: "",
  rowId: null,
  requestKey: null,
  commentsRevision: 0,
  entries: [],
  draft: "",
  deletingCommentId: null,
}
```

### Step 5: Add local read-revision helpers

Files:

- `src-ui/app/editor-preferences.js`

Add helpers such as:

- `loadStoredEditorCommentSeenRevisions`
- `saveStoredEditorCommentSeenRevision`
- `pruneStoredEditorCommentSeenRevisions`

Behavior:

- scoped by signed-in login
- chapter id -> row id -> last seen revision
- prune row ids that no longer exist in the loaded chapter

### Step 6: Add pure comment state and flow modules

Recommended new modules:

- `src-ui/app/editor-comments-state.js`
- `src-ui/app/editor-comments-flow.js`
- `src-ui/app/editor-comments.js`

Responsibilities:

- `editor-comments-state.js`
  - pure state transitions
  - tab switching
  - comment load/save/delete success/failure
  - draft changes
  - row summary updates
  - unread/read reconciliation
- `editor-comments-flow.js`
  - invoke backend commands
  - apply the pure state helpers
  - write local seen revision when appropriate
- `editor-comments.js`
  - selectors and helpers
  - row button state
  - unread computation from `commentsRevision` vs local seen revision

Keep `editor-history-flow.js` focused on history only.

### Step 7: Wire comments into the existing editor action/input seams

Files:

- `src-ui/app/translate-flow.js`
- `src-ui/app/actions/translate-actions.js`
- `src-ui/app/input-handlers.js`

Actions to add:

- open comments from row button
- switch sidebar tabs
- save comment
- delete comment

Input handlers to add:

- comment draft textarea changes

### Step 8: Add comment summary fields to the row view model

Files:

- `src-ui/app/editor-screen-model.js`

Changes:

- carry through per-row:
  - `commentCount`
  - `commentsRevision`
- compute per target-language section:
  - `showCommentsButton`
  - `hasComments`
  - `hasUnreadComments`

Unread computation should use:

- row’s `commentsRevision`
- locally stored seen revision for that row

### Step 9: Add the comments button to row rendering

Files:

- `src-ui/app/editor-row-render.js`
- `src-ui/styles/translate.css`

Changes:

- add a comment marker icon renderer
- render the button before reviewed / please-check
- target language only
- tooltip: `View / edit comments`
- add styles for:
  - off
  - read
  - unread

### Step 10: Split the sidebar renderer

Files:

- `src-ui/screens/translate.js`
- `src-ui/screens/translate-history-sidebar.js`

Recommended split:

- `src-ui/screens/translate-sidebar.js`
- `src-ui/screens/translate-history-pane.js`
- `src-ui/screens/translate-comments-pane.js`

Reason:

- comments are a separate pane with their own composer and actions
- this keeps the sidebar code readable
- it avoids building a new concentrated bug-risk file

### Step 11: Keep row summaries and local seen state in sync

Files:

- `src-ui/app/editor-state-flow.js`
- `src-ui/app/editor-chapter-load-flow.js`
- `src-ui/app/editor-regression-fixture.js`

Changes:

- preserve row comment summaries during same-chapter refreshes
- when save/delete returns updated row summary:
  - update sidebar state
  - update the row button state
- prune stale local seen-revision entries for rows that no longer exist

## Tests

### Rust tests

Add tests in `chapter_editor.rs` for:

- loading old rows that do not yet have `editor_comments`
- loading rows with comments and revisions
- inserted rows start with empty comments and revision `0`
- saving a comment appends and increments revision
- deleting a comment removes it and increments revision
- delete rejects non-author attempts
- chapter load exposes row comment summary data

### JS unit tests

Add tests for:

- comments state transitions
- unread computation from revision vs local seen revision
- row button state computation
- save button enabled/disabled behavior
- marking row revisions seen
- pruning stale seen-revision entries

### Browser regressions

Add Playwright coverage for:

- comment button appears only on target language
- clicking it switches sidebar to `Comments`
- rows with comments show blue button state
- unread rows show filled blue button state
- opening the comments tab marks that row revision read locally
- saving a comment appends it and leaves the row read for the author
- deleting a comment updates the sidebar and row button
- delete button appears only for the author
- switching rows while the `Comments` tab is active follows the correct row

## Completion Criteria

The feature is complete when:

1. target-language rows show the comments button
2. the button correctly distinguishes no-comments / read-comments / unread-comments
3. clicking the button opens the `Comments` tab for the correct row
4. the sidebar shows row comments newest first
5. the user can save a comment
6. only the author can delete a comment
7. unread state is persisted locally per signed-in user, per row revision
8. row files store editor comments cleanly without reusing `guidance.comments`
9. row insert/delete/restore behavior keeps comment state coherent
10. `npm test` passes
11. `npm run build` passes
12. `npm run test:browser` passes

## Recommended Implementation Order

1. backend row schema defaults and commands
2. chapter load summary fields
3. frontend editor comments state modules
4. local seen-revision storage
5. sidebar split and comments pane
6. row comments button and styling
7. unit tests and browser regressions
