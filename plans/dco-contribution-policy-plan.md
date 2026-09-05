# DCO contribution policy

Decision: 2026-09-05. Replace the CLA requirement for new contributions to the
desktop app and broker with Developer Certificate of Origin 1.1 sign-offs.

## Implementation

1. Update contributor guidance in both repositories: contributors retain their
   copyright and submit under GPL-3.0-only (desktop) or AGPL-3.0-only (broker).
   Include DCO 1.1 and explain `git commit --signoff`.
2. Mark the existing CLA template as historical without changing its original
   terms or removing previously signed agreement records.
3. Inspect GitHub enforcement, retire any CLA-specific automation without
   deleting signature records, and enable GitHub's web-commit sign-off setting.
   Keep other repository settings unchanged. This setting covers web commits;
   command-line contributors must add sign-offs themselves.
4. Publish focused commits, verify contributor documents/settings on GitHub,
   and confirm the broker deployment uses the published commit.

## Initial findings

Neither repository has repository webhooks, rulesets, or required status checks
on main. There is no checked-in CLA workflow. Check installed GitHub Apps before
concluding there is no active CLA bot to disable.

## Verification

- Both DCO.txt files reproduce the canonical preformatted text downloaded from
  https://developercertificate.org/ without changes.
- The historical CLA template's original contents are byte-for-byte preserved
  below the retirement notice. No signature records were deleted or modified.
- Contributor documents use the receiving repository's license, explain sign-off
  and amendment commands, and state that command-line sign-offs are checked by
  maintainers. No automatic PR-wide DCO gate is claimed or configured.
- GitHub's `web_commit_signoff_required` setting is enabled for both repositories.
- `git diff --check` passes in both repositories; documentation links resolve.
- Organization-level GitHub App inventory could not be inspected: the CLI token
  lacks `admin:org` scope, and the available browser is signed out. Repository
  webhooks, rulesets, and required checks contain no CLA enforcement; whether a
  separate organization-level CLA App is installed remains unverified.
