# Contributing to Gnosis TMS

Thank you for considering a contribution. Before you start, please read the
licensing terms and development guidance below.

## Licensing

Gnosis TMS is open-source software under the GNU General Public License,
version 3 only (`GPL-3.0-only`; see [LICENSE](LICENSE)). Commercial and
noncommercial use are permitted without a separate paid commercial license.
Contributions to this repository are distributed under the same license.

The separate GitHub App broker is licensed under the GNU Affero General Public
License, version 3 only (`AGPL-3.0-only`). Third-party components retain their own
licenses and notices.

## Contributor License Agreement

All contributions require a signed CLA — see [CLA.md](CLA.md) for the full text.
In short: you keep ownership of your contribution and can use it however you like,
and you grant the maintainer the right to distribute and relicense it, including
under commercial or proprietary terms. The CLA is separate from the public
GPLv3 license and does not require users to buy a license.

Signing is automatic: when you open your first pull request, the CLA Assistant bot
posts a link, and you sign by authenticating with your GitHub account and
clicking agree. It takes under a minute and never has to be repeated. A pull
request cannot be merged until its author has signed (a Developer Certificate of
Origin `Signed-off-by` line is not a substitute).

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
