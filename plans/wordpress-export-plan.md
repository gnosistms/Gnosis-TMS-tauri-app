# WordPress Export Plan (Editor Export Menu — Phase 3)

Parent plan: `plans/editor-export-menu-plan.md` (Phases 1–2 shipped in v0.8.33).
This plan covers the `link:wordpress` option only.

## Status (2026-06-11)

- Research items resolved (see below). Implementation in progress on
  `feature/wordpress-export` (app repo) and broker `main`.

## Resolved Research

- **`meta.footnotes` on the WordPress.com wp/v2 proxy: ACCEPTED.** Verified
  2026-06-11 via `OPTIONS https://public-api.wordpress.com/wp/v2/sites/<site>/posts`:
  the posts schema registers `meta.footnotes` as `{ "type": "string", context:
  [view, edit] }`, and live posts return a `footnotes` key in `meta`. Core
  footnotes (WP ≥ 6.3) store the footnote bodies as a JSON-encoded string in
  that meta field: `[{"id":"<uuid>","content":"<inline html>"}]`, where each
  `id` matches the `data-fn`/anchor ids that `serializeEditorPreviewHtml`
  already emits for `<sup data-fn="…" class="fn">` refs. So the export sends
  block markup as `content` plus `meta.footnotes` (JSON string). Final
  end-to-end confirmation happens at first manual export; any rejection
  surfaces through normal command error display.
- **Auth**: WordPress.com Authorization Code flow via the broker (client
  secret never ships in the app). Implicit flow (deprecated, 2-week tokens)
  and password grant are not used. No `scope` parameter is sent, so the token
  is default-scoped to the single blog the user authorizes.

## Architecture

### Broker (gnosis-tms-github-app-broker, deploys from pushed main)

New `wordpress-auth.js` + `wordpress-auth-routes.js`, registered in
`server.js`, mirroring the GitHub flow in `broker-auth.js`/`auth-routes.js`:

- `GET /auth/wordpress/start?state=<csrf>&desktop_redirect_uri=<local>` —
  validates the redirect URI against `ALLOWED_DESKTOP_CALLBACK_PREFIXES`,
  encodes `{desktopRedirectUri, desktopState}` into the signed install-state
  blob, and renders the redirect page to
  `https://public-api.wordpress.com/oauth2/authorize?client_id=…&redirect_uri=<broker>/auth/wordpress/callback&response_type=code&state=…`.
- `GET /auth/wordpress/callback?code=&state=` — decodes the signed state,
  exchanges the code at `https://public-api.wordpress.com/oauth2/token`
  (form-encoded: client_id, client_secret, redirect_uri, code,
  `grant_type=authorization_code`), then redirects to the desktop callback
  with `state`, `wp_access_token`, `blog_id`, `blog_url`. The broker does not
  persist the token; it passes it through exactly like `broker_session_token`
  in the GitHub flow.
- Config: `WORDPRESS_CLIENT_ID` / `WORDPRESS_CLIENT_SECRET` are **optional**
  env vars (app registered at developer.wordpress.com/apps with the broker
  callback as redirect URL). When unset, the routes respond with a clear
  "WordPress export is not configured" error so deploying ahead of app
  releases stays safe.

### Desktop backend (`src-tauri/src/wordpress/`)

All WordPress HTTP lives here; the frontend never sees the token.

- `storage.rs` — persists the connection as JSON
  (`{accessToken, blogId, blogUrl}`) under key `wordpress/connection` in the
  existing Stronghold snapshot via the (now `pub(crate)`) generic helpers in
  `ai_secret_storage.rs`. No OS keychain (F-VIII stands).
- `auth.rs` — `begin_wordpress_auth` command (csrf token into
  `AuthState.pending_wordpress_auth`, returns the broker start URL);
  callback handler invoked from `callbacks.rs` for the new local path
  `/wordpress/auth/callback` (port 45873 listener), which validates csrf,
  saves the connection, and emits `wordpress-auth-callback`
  (`{status, message, connection: {blogId, blogUrl}}` — never the token).
- `client.rs` — site-descriptor design for later self-hosted support:
  `WordPressSite { api_base, auth }` where auth is
  `Bearer(token)` today and `ApplicationPassword{...}` later. WordPress.com
  descriptor: `api_base = https://public-api.wordpress.com/wp/v2/sites/<blog_id>`.
  Blocking reqwest (same style as `broker.rs`), always inside
  `spawn_blocking`.
- `export.rs` + commands:
  - `get_wordpress_connection` → `Option<{blogId, blogUrl}>` (storage read).
  - `disconnect_wordpress` → clears the stored connection.
  - `search_wordpress_posts { search }` → `GET posts?search=…&per_page=20&
    status=publish,future,draft,pending,private&context=edit&_fields=…` →
    `[{id, title, status, link, modified}]`.
  - `export_chapter_to_wordpress { input }` → validates input, **returns a
    job id immediately**, and runs the export in a spawned task that emits
    `wordpress-export-progress` events
    (`{jobId, status: progress|success|error, message, current?, total?,
    postLink?}`). Steps: scan `content` for `<img src>` values that are not
    http(s)/data URLs, resolve each against the project repo
    (`resolve_project_git_repo_path`, canonical-path traversal guard), upload
    to `POST …/media` (multipart), rewrite `src` to the returned
    `source_url`; then `POST …/posts` (create: title + content +
    `status=draft` + `meta.footnotes`) or `POST …/posts/<id>` (overwrite:
    content + `meta.footnotes` only — title and status untouched).
  - A 401 from WordPress maps to a "connection expired — reconnect" message.
- `constants.rs`: `WORDPRESS_AUTH_CALLBACK_PATH`, event names.

Created posts are always **drafts** — publishing stays a deliberate action in
WP admin. Overwrite never changes post status.

### Frontend

- `editor-preview.js`: new `serializeEditorPreviewWordPress(blocks)` →
  `{ content, footnotes: [{id, content}] }`. Same block serialization as
  `serializeEditorPreviewHtml` but without the `<meta charset>` clipboard
  prefix; footnote bodies rendered with the existing inline-markup
  serializer. Uploaded images keep their repo-relative `path` as `src` for
  the Rust media-upload pass.
- `editor-export-wordpress-flow.js` (new) — owns the wordpress pane state
  inside `state.editorChapter.exportModal.wordpress`:
  `{connectionStatus, connection, mode: create|overwrite, title, searchQuery,
  searchStatus, searchResults, selectedPostId, exportStage}`. Reducers for
  connect/disconnect, mode, search, post selection; submit path invoked from
  `submitEditorExport` for `kind === "link" && format === "wordpress"`;
  listeners for `wordpress-auth-callback` and `wordpress-export-progress`
  (registered from `main.js`).
- `editor-export-flow.js`: flip `link:wordpress` to `available: true`;
  delegate submit.
- `screens/editor-export-modal.js`: wordpress pane — Connect
  WordPress.com button (disconnected), connected header with blog URL +
  Disconnect, create-new-draft vs overwrite-existing radios, title input
  (create), search input + button + result picker (overwrite), explicit
  overwrite warning text, progress line while exporting, submit button
  labeled "Export draft" / "Overwrite post".
- `input-handlers.js` + `focused-input-state.js`: `data-wordpress-title-input`
  and `data-wordpress-search-input`.
- `styles/modals.css`: pane styles (radio rows, result list, warning).

## Testing

- Broker: `wordpress-auth-url.test.js` style tests for start-URL building,
  state round-trip, unconfigured error.
- Rust: unit tests for content image-src extraction/rewrite, traversal
  guard, footnotes meta JSON building, storage round-trip.
- JS: flow tests (reducers, submit with injected invoke/listen, event
  handling, unavailable→available catalog), modal render tests (disconnected,
  connected create, connected overwrite + warning, exporting), preview
  serializer tests (footnotes meta ids match refs, no charset prefix).
- Manual (release build): full OAuth round trip, draft create with images +
  footnotes, overwrite, revoked-token reconnect, Windows + macOS.

## Out of Scope (later)

- Self-hosted Application Passwords transport (client.rs descriptor is the
  seam; add an auth mode + base URL form).
- Updating `wp:image` block attrs with returned media ids (src rewrite is
  sufficient for valid rendering).
- Token refresh — WordPress.com code-flow tokens do not expire; revocation is
  handled by reconnecting.
