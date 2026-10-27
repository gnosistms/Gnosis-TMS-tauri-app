# Multi-site WordPress Export Connections

## Summary

Replace the single app-wide WordPress.com credential with an encrypted,
per-Gnosis-login collection of WordPress.com, Jetpack-connected, and self-hosted
sites. Each chapter remembers its last successful WordPress site and post.

## Implementation

- Store versioned site collections in Stronghold, keyed by normalized Gnosis login.
  Migrate the legacy `wordpress/connection` entry on first access.
- Route list, authentication, search, export, reconnect, and forget operations through
  an explicit `storageLogin` and stable `siteId`.
- Extend the WordPress client descriptor to support WordPress.com bearer tokens and
  self-hosted Basic authentication against a discovered REST root.
- Persist `{siteId, siteKind, siteUrl, postId, postTitle}` per chapter only after a
  successful export. Disconnect unlinks one chapter; forgetting a site removes its
  credentials and unlinks all chapters for that login.
- Render a site picker for unlinked chapters, with URL-first add-site discovery,
  WordPress.com OAuth, self-hosted credentials, insecure-HTTP confirmation, and
  explicit reconnect UI after an authentication failure.
- Pass the requested WordPress.com blog through the broker OAuth flow and reject a
  reconnect callback that authorizes a different blog.

## Verification

- Rust tests: storage isolation/migration/upsert/removal, site routing and auth modes,
  discovery validation, reconnect classification, and editor links.
- Frontend tests: per-chapter persistence, picker rendering/actions, disconnect,
  forget-all unlinking, add-site selection, and reauthentication state preservation.
- Broker tests: requested blog survives the signed OAuth redirect flow.
- Run focused Node and Cargo tests in both repositories, followed by the full suites.

## Defaults

- Connections are local and isolated by Gnosis/GitHub login.
- There is one saved credential per canonical site.
- Self-hosted Basic auth accepts an Application Password or a server-supported normal
  password; Application Passwords remain the recommended choice.
- HTTP requires explicit acknowledgement and credentials are never forwarded to an
  unconfirmed origin.
- Credential failures do not erase the saved site or post, and failed exports are not
  retried automatically after reconnecting.
