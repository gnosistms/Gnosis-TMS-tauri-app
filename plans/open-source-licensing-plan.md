# Open-source licensing transition

Decision: 2026-09-05. Hans selected GPLv3 for the desktop app and AGPLv3 for
the GitHub App broker. Use `GPL-3.0-only` and `AGPL-3.0-only`, respectively;
future license versions are not automatically authorized.

Contributor policy update: the [DCO transition](dco-contribution-policy-plan.md)
retires the CLA requirement for new contributions. References below to retaining
CLA agreements concern historical records, not a new signing requirement.

## Plan

1. Replace both interim licenses with the complete standard license texts and
   add clear project copyright/license notices and package metadata.
2. Update contribution guidance, supersede the previous commercial licensing
   rollout, and correct dependency-policy documentation. Retain existing CLA
   agreements and third-party licenses. Bundle the desktop license with releases.
3. Verify standard license text integrity, package/config metadata, dependency
   checks where available, and focused diffs in both repositories.

## Scope and evidence

- Commercial use is permitted under each public license without a separate paid
  commercial license. The previous license-token/pricing rollout is superseded.
- The 2026-06-11 rollout records Joshua's contributor permission as resolved.
  `CLA.md` expressly grants relicensing rights and covers both repositories.
  Signed agreements and the original contributor email are not stored here;
  this change relies on the maintainer's recorded resolution, not a new legal audit.
- Third-party components keep their licenses. Existing dependency allowlists
  remain conservative; new dependency licenses require compatibility review.
- Broker operators must offer the corresponding source for modified versions
  to remote users under AGPLv3 section 13; document that deployment obligation.
- Preserve unrelated work already present in the desktop checkout.

## Verification

- Complete license texts copied unchanged from SPDX's `license-list-data`
  repository (`text/GPL-3.0-only.txt` and `text/AGPL-3.0-only.txt`) after the GNU
  download endpoint timed out. Verified byte-for-byte against the downloads.
- Desktop npm, lockfile, both Rust manifests, and Tauri bundle license metadata
  agree. `cargo metadata --no-deps --offline` reads GPL-3.0-only.
- Tauri config validates against the installed CLI schema; license and README
  resource mappings resolve to existing files.
- Broker npm and lockfile metadata agree on AGPL-3.0-only.
- `npm run check:licenses:npm` passes (eight MIT production packages).
- `git diff --check` passes in both repositories.
- Rust dependency checking was not run: `cargo-deny` is not installed locally.
  Existing CI runs this check. Dependency allowlists were not changed.
- No runtime behavior changed; no app build or runtime test suite was needed.

## Publication status

Hans requested publication of the licensing changes to GitHub on 2026-09-05.
Publish focused licensing commits to both default branches, using an isolated
checkout of the latest desktop branch to preserve unrelated local work. Verify
GitHub's detected license in each repository and the broker deployment status.
