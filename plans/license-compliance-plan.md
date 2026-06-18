# License Compliance Automation Plan

## Why

Gnosis TMS is moving to a PolyForm Noncommercial + commercial dual-license model.
Strong copyleft (GPL/AGPL/LGPL-only) in the dependency tree is a hard blocker for
the commercial license, so compliance must be enforced automatically, not by
periodic manual audit.

## Current state (June 2026)

- **Rust**: the only copyleft crates in `src-tauri/Cargo.lock` are MPL-2.0
  (`cssparser`, `cssparser-macros`, `dtoa-short`, `option-ext`, `selectors`) and
  `r-efi` (tri-licensed `MIT OR Apache-2.0 OR LGPL-2.1-or-later` — we take MIT).
  MPL-2.0 is file-level copyleft and acceptable; we do not modify those crates.
- **npm**: 8 production packages (`@sentry/*`, `@tanstack/*`), all MIT. The root
  package `gnosis-tms` reports UNLICENSED and is `private: true`.
- **Vendored**: `src-ui/lib/vendor/diff-match-patch.js` is Apache-2.0 (not in any
  package manifest, so no scanner sees it).
- No license checks exist in CI and no third-party notices ship with the app.

## Allowlist (shared by both ecosystems)

MIT, Apache-2.0, ISC, BSD-2-Clause, BSD-3-Clause, Zlib, Unicode-3.0, CC0-1.0,
CDLA-Permissive-2.0, BSL-1.0, Unlicense, MIT-0, 0BSD, **plus MPL-2.0**.
Everything else — including GPL/AGPL/LGPL-only and unknown/unlicensed — fails.

## Changes

### 1. Rust: cargo-deny

- `src-tauri/deny.toml` with `[licenses]` allowlist above (cargo-deny v2 config:
  anything not allowed is an error, so GPL/unknown are denied implicitly).
- npm script `check:licenses:rust` → `cargo deny check licenses` against
  `src-tauri/Cargo.toml`.

### 2. npm: license-checker

- Add `license-checker` as a devDependency.
- npm script `check:licenses:npm` → `license-checker --production
  --excludePrivatePackages --onlyAllow "<allowlist>"`.
  `--excludePrivatePackages` skips the UNLICENSED root package without pinning a
  version string.

### 3. CI

- New `license-compliance` job in `.github/workflows/quality-check.yml`:
  installs cargo-deny (prebuilt via `taiki-e/install-action`), runs both npm
  scripts. Added to the `quality-summary` gate so a PR introducing a GPL
  dependency fails. No Tauri system deps needed — license checks read metadata
  only, no compilation.
- `scripts/local-ci.sh` mirrors both checks (rust check skipped with a hint if
  cargo-deny is not installed locally).

### 4. THIRD-PARTY-NOTICES

- `scripts/generate-third-party-notices.mjs` writes
  `src-tauri/resources/THIRD-PARTY-NOTICES.md` (gitignored, generated) from:
  - `cargo about generate` (config `src-tauri/about.toml`, template
    `src-tauri/about.hbs`) for crates;
  - `license-checker --production --json` license texts for npm packages;
  - a hardcoded section for the vendored Apache-2.0 `diff-match-patch.js`.
- npm script `licenses:notices` runs it standalone.
- `scripts/build-frontend-for-tauri.mjs` (the Tauri `beforeBuildCommand`) calls
  it, so `npm run tauri:build` always regenerates the file before bundling.
  Missing cargo-about fails the build with install instructions.
- `src-tauri/tauri.conf.json` `bundle.resources` maps the file into the app
  bundle.
- `.github/workflows/release-tauri.yml` installs cargo-about on all release
  runners before the tauri-action step.

## Risks / notes

- cargo-about may need `workarounds`/`clarify` entries for crates with
  non-standard license metadata (e.g. `ring`); resolve by running it against the
  real lockfile and iterating.
- `license-checker` is unmaintained but stable; the dependency surface it scans
  here is 8 MIT packages. Swap for a maintained fork later if needed.
- The allowlist intentionally lives in three places (deny.toml, package.json
  script, about.toml) because the tools cannot share config; keep them in sync
  when amending.

## Status

- [x] deny.toml + rust check verified locally (`licenses ok`; needed
      `Apache-2.0 WITH LLVM-exception` for target-lexicon and
      `private = { ignore = true }` + `publish = false` for our own crate)
- [x] npm check verified locally (8 MIT packages pass; narrowed allowlist
      confirmed to exit 1)
- [x] notices generation verified locally (~10.9k lines: crates + 8 npm
      packages + vendored diff-match-patch)
- [x] CI + release workflow wired (license-compliance job in quality gate;
      cargo-about installed on release runners)
