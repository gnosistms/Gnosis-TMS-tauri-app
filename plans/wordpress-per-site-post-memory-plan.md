# Per-site WordPress Post Memory

## Goal

Let each chapter remember its last successfully exported post for every saved
WordPress site under the active Gnosis login. A user should be able to switch from
site A to site B and back to site A, with each site immediately restoring its own
overwrite target without another post search.

The memory remains local-only and scoped by normalized Gnosis login, matching the
existing editor export defaults.

## Current behavior

- `editor-export-defaults.js` stores one `wordpress` destination per chapter.
- A successful export replaces that one destination with the current
  `{siteId, siteKind, siteUrl, postId, postTitle}` tuple.
- Selecting another site resets the pane to create mode and clears the selected
  post.
- The current **Disconnect** action returns to the site picker but also deletes the
  chapter's remembered WordPress destination.

As a result, exporting the same chapter to site B replaces its association with
site A, and switching back to site A requires another search.

## Persisted model

Replace the single destination with one last-successful destination per canonical
`siteId`, plus the site used by the chapter's most recent successful WordPress
export. Use a normalized shape equivalent to:

```js
{
  optionId: "link:wordpress",
  wordpress: {
    lastSiteId: "wpcom:12345",
    destinations: [
      {
        siteId: "wpcom:12345",
        siteKind: "wordpressCom",
        siteUrl: "https://first.example",
        postId: 7,
        postTitle: "Chapter One",
      },
      {
        siteId: "selfhosted:...",
        siteKind: "selfHosted",
        siteUrl: "https://second.example",
        postId: 42,
        postTitle: "Chapter One",
      },
    ],
  },
}
```

Use an array rather than user-derived object keys, normalize and deduplicate entries
by `siteId`, and discard entries without a valid positive `postId` or stable
`siteId`.

### Compatibility and migration

- Continue reading the existing single-destination shape.
- If the old record has a `siteId`, normalize it into a one-entry `destinations`
  array and use that site as `lastSiteId`.
- Preserve the older unscoped `{postId, postTitle}` case long enough for the current
  single-connection migration path to attach it when exactly one saved connection
  exists. Do not guess when multiple connections exist.
- Write only the new shape after the next successful export or association cleanup;
  no eager storage rewrite is required.
- Preserve all WordPress destinations when a non-WordPress export becomes the
  chapter's latest export option.

## Interaction behavior

1. When the export modal opens, select `lastSiteId` and seed overwrite mode with
   that site's remembered post, as today for the single remembered destination.
2. When the user chooses another saved site:
   - restore overwrite mode, the synthetic selected-post result, and the warning if
     that site has a remembered destination for this chapter;
   - otherwise open that site in create mode with no selected post.
3. Switching A → B → A within one modal session must restore A's post each time.
4. Update persistence only after a successful create or overwrite response. Upsert
   the current site's destination without removing other sites, and set
   `lastSiteId` to the successful site.
5. Failed, cancelled, or merely selected exports must not alter persistent
   destinations or `lastSiteId`.
6. Change the current **Disconnect** control into a non-destructive **Switch site**
   action that returns to the picker without deleting post memories.
7. **Forget site** remains destructive for that saved connection: remove only that
   site's destination from every chapter for the active Gnosis login. Preserve all
   other sites' destinations. If the forgotten site was a chapter's `lastSiteId`,
   clear that default so the picker is shown rather than choosing another site
   arbitrarily.
8. Authentication failures and reconnects must retain all remembered destinations,
   consistent with current behavior.

## Implementation areas

### `src-ui/app/editor-export-defaults.js`

- Extend normalization for the per-site collection and legacy formats.
- Add focused helpers to read/upsert a chapter destination by `siteId`, while
  retaining the existing top-level export-option behavior.
- Replace whole-chapter unlinking used for site switching with non-destructive
  session reset behavior.
- Update site-forget cleanup to remove only the matching destination across all
  chapters and repair/clear `lastSiteId` when necessary.

### `src-ui/app/editor-export-wordpress-flow.js`

- Seed a remembered destination by selected `siteId`, not from a single global
  chapter destination.
- Restore a site's destination in `selectWordPressSite`; otherwise retain the
  existing create-mode reset.
- Make the picker transition non-destructive.
- On a successful export, upsert the returned post under the current stable
  `siteId` and make it the chapter's last successful WordPress site.
- Keep the legacy one-connection migration, adapted to the new persisted shape.

### `src-ui/screens/editor-export-modal.js`

- Rename the connected-site action from **Disconnect** to **Switch site** and use a
  correspondingly named action identifier so its non-destructive behavior is clear.

### Action routing and tests

- Update `src-ui/app/actions/translate-actions.js` and the flow facade/export names
  if the action/function is renamed.
- Update persistence, WordPress flow, action-routing, and modal-rendering tests.
- No Rust, WordPress API, credential storage, or broker change should be needed;
  this feature changes frontend-local export association state only.

## Verification

Add or update focused tests for:

- legacy single-site records normalizing without data loss;
- two destinations round-tripping for the same chapter and Gnosis login;
- destinations remaining isolated between Gnosis logins;
- a successful export to site B retaining site A and setting B as `lastSiteId`;
- reopening the modal restoring the last successful site and post;
- switching A → B → A restoring the correct post and overwrite warning for
  each site;
- selecting a site with no remembered post starting in create mode;
- switching sites without exporting leaving persistent memory unchanged;
- failed exports leaving all saved destinations unchanged;
- switching to the site picker preserving every remembered destination;
- forgetting site A removing A across chapters while preserving site B;
- forgetting the `lastSiteId` clearing the automatic site choice without deleting
  other sites' post memories;
- non-WordPress export defaults preserving the entire destination collection;
- the modal rendering **Switch site** and routing its action correctly.

Run the focused Node test files first:

```bash
node --test src-ui/app/editor-export-defaults.test.js
node --test src-ui/app/editor-export-wordpress-flow.test.js
node --test src-ui/screens/editor-export-modal.test.js
```

Then run the complete frontend unit suite:

```bash
npm test
```

## Non-goals

- Syncing post associations through GitHub or between devices.
- Sharing associations between different Gnosis logins.
- Remembering multiple historical posts for one site and chapter; only the last
  successful post per site is retained.
- Changing WordPress credentials, OAuth, post search, or export payload behavior.
