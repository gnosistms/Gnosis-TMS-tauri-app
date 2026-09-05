# Contributing to Gnosis TMS

Thank you for considering a contribution. Before you start, please read the
licensing terms and development guidance below.

## Licensing

Gnosis TMS is open-source software under the GNU General Public License,
version 3 only (`GPL-3.0-only`; see [LICENSE](LICENSE)). Commercial and
noncommercial use are permitted without a separate paid commercial license.
By submitting a contribution, you agree to license it under GPL-3.0-only.
You retain copyright in your contributions. No additional relicensing grant or
Contributor License Agreement is required for new contributions.

The separate GitHub App broker is licensed under the GNU Affero General Public
License, version 3 only (`AGPL-3.0-only`). Third-party components retain their own
licenses and notices.

## Developer Certificate of Origin

Sign off each contribution commit to certify that you have the right to submit
the work under the project's license. Read the [Developer Certificate of Origin
1.1](DCO.txt) before adding your sign-off.

With your name and email configured in Git, use:

```bash
git commit --signoff -m "Describe your change"
```

This adds a `Signed-off-by: Your Name <your.email@example.com>` trailer. Sign-off
is a certification of the DCO, not a cryptographic commit signature. Only add it
if you can make that certification. GitHub's web editor also requires sign-off.

If you forgot to sign off your latest commit, you can amend it:

```bash
git commit --amend --no-edit --signoff
```

Amending changes the commit ID; coordinate before rewriting shared history.
Command-line contributors must supply their sign-offs themselves; GitHub's web
sign-off setting does not validate commits pushed from a local checkout.
Maintainers should check contribution sign-offs before merging pull requests.

The previous [CLA template](CLA.md) is retained for historical reference. New
contributors do not sign it. Previously executed agreements and their records
are preserved; this policy change does not rewrite their terms.

## Development setup

Prerequisites: Node (see `engines.node` in [package.json](package.json)) and a
Rust toolchain for the Tauri backend.

```bash
npm install

# Frontend dev server (hot-reload, no native backend)
npm run dev

# Full app with native backend (recommended for feature work)
npm run tauri:dev

# Unit tests (Node, no browser or Tauri required)
npm test

# Browser-based integration tests
npm run test:browser
```

## Project conventions

- **Read the guides.** [AGENTS.md](AGENTS.md) at the repo root and in each major
  directory documents the architecture, module ownership patterns, and known
  pitfalls. The same rules apply to humans and AI agents.
- **Plan first.** Changes touching more than two files or three steps get a short
  markdown plan in `plans/` before implementation. Single-file fixes go direct.
- **Scope discipline.** Only modify files related to your change. Note unrelated
  issues in the PR description instead of fixing them in passing.
- **Parity.** A capability added to glossaries must also be added to QA lists, and
  vice versa — they share a domain model.
- **Commit hygiene.** Small, focused commits; one logical change per commit.
- **Cross-platform.** The app ships on macOS and Windows. Path handling and
  editor scroll behavior differ between them; say in your PR which platform(s)
  you tested on.

## What contributions are welcome

Bug fixes, features you need for your own translation work, documentation, and
test coverage are all welcome. For anything larger than a bug fix, open an issue
first to check the direction before investing your time.
