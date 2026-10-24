# Shared author-reference evidence — 2026-10-16

## Objective

Compute term-independent references to fuente authors and titles during corpus
maintenance, publish reviewed evidence in GlossaryGen, and remove repeated
author-reference AI checks from Gnosis TMS. Corpus maintenance is performed in
Codex/Claude Code; this feature must require no provider API key or paid API runner.

## Implementation

1. Extend GlossaryGen's author metadata compiler with stable author identities,
   per-witness content fingerprints, full supporting context/citations, explicit
   genuine/rejected/unresolved review judgments, and separate distinct-paragraph,
   copy and occurrence counts. Reuse unaffected judgments across corpus updates;
   invalidate changed evidence, author identity/title interpretation or review rules.
2. Add a deterministic corpus-maintenance command which builds a review queue,
   imports validated Codex/Claude Code judgments, and checks publication readiness.
   New authors/title aliases search all indexed Samael books and lectures; new or
   corrected corpus text updates all affected authors. Review only new/changed
   evidence. Preserve prior receipts and import applicable desktop cached reviews
   with explicit provenance rather than paying to repeat them.
3. Document this required step in the corpus-update workflow and publishing gate.
   Persist reviewed evidence in the search database shipped to DigitalOcean.
   Publish explicit unresolved findings without pretending they are zero matches.
4. Change Studio step 4.4.1 to retrieve and validate shared metadata, display reuse
   and uncertainty, and perform only term-specific source comparisons. Missing or
   stale shared metadata is a service-maintenance error, never a trigger for local
   author-reference AI calls. Preserve old study reports/caches.
5. Verify incremental invalidation, agent-review import, publication gating, API
   schema, Studio no-author-call behavior and existing research regressions.
6. Prepare a focused service commit while preserving unrelated dirty work, rebuild
   and publish corpus artifacts, deploy to DigitalOcean, and verify live metadata
   coverage and representative Studio consumption. Keep paid acceptance research
   paused. Deployment is explicitly authorized by the user.

## Status

Implementation, deployment and live verification complete.
Credential-gated API verification was rejected as an unnecessary assumption;
no new credentials or provider calls are part of this implementation.

## Implementation and verification

- Service changes were developed in `/private/tmp/gnosis-author-references-service`
  from the latest remote `97df5c3ca`, rather than the older dirty primary checkout.
  The feature was also ported into the primary GlossaryGen folder, retaining
  unrelated edits. Its persistent `author-reference-review/` directory holds the
  rebuild ledger and immutable import receipts. Original desktop receipts remain.
- Started with the exact published `20261016-180000` search/glossary/reader artifacts;
  verified all three SHA256 checksums before adding metadata tables. Corpus text,
  glossary records and reader archive remain the published versions. Existing
  source-registry publication checks pass: 60 finished/searchable books, 21 other
  explicitly documented statuses, no silently stalled books.
- Reused 2,348 prior desktop judgments with identical author, text and neighboring
  context. Codex reviewed the remaining 831 witnesses (505 positive, 323 negative,
  three unresolved), then 12 observed spelling-variant witnesses. The final index
  has 29 author/work identities, 60 fuente books, 3,188 current witnesses and
  judgments, zero unreviewed witnesses and 18 explicitly unresolved judgments.
  Older fingerprints remain in the review ledger/table. Anonymous works are
  identified by work, and references never establish a specific edition.
- Service verification: 163 tests run successfully (161 passed, two existing source-artifact skips);
  eight search-UI tests pass. The primary GlossaryGen feature tests also pass
  (13). Local real-data HTTP verification confirms a compact 63KB summary and
  complete per-author evidence; Gurdjieff has 78 confirmed paragraphs, 78 copies
  and 111 name/title occurrences. Metadata-only build/publication checks pass.
- Studio: 2,452 frontend tests pass; all 40 Studio browser cases pass, including
  zero author-verification calls. Final targeted coverage also checks malformed
  shared counts and refreshing a cached catalog on Retry. Source/original-term
  requests carry the corpus fingerprint, preserving old receipts without using
  older corpus results in a refreshed bibliography attempt. Build/lint pass;
  unused-code findings remain at the existing baseline.
- Service commits pushed to main: `1146f85ea` (feature/workflow) and `2c3c08902`
  (data version). Uploaded data `20261016-101609`. DigitalOcean app
  `14d041c3-b787-43df-900a-ac70a52d1902` accepted the update with existing live app
  settings preserved; deployment `6fd9916d-e51f-4c6b-933f-d7dea3de54c3` is ACTIVE.
- Live public API verification confirms schema 2, ready=true, zero unreviewed
  witnesses, all 60 fuente books and 29 author/work identities. A full Gurdjieff
  response matches its summary fingerprint and contains every saved judgment.
  Actual Studio stage code tested against production for `hooltanpanas`: four
  read-only corpus requests, Gurdjieff's 78 saved reference paragraphs retrieved,
  zero author-verification calls and zero paid AI calls (the term-specific
  comparison was explicitly stubbed). The real acceptance study remains paused.
  The primary GlossaryGen deployment spec also records the live data version.
