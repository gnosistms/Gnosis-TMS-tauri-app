# Spec: repo-flow metadata-reconciliation reconciliation (Tier 3, Phase A part 2)

Follows `frontend-tier3-mirror-merge-plan.md` (Stream 1, repo-flow) and PR #63 (Phase A part 1:
descriptor alignment + repair/rebuild port + tombstone alignment, merged). PR #63 deliberately
**did not** collapse the metadata-load divergence and flagged it for a ruling. This spec records the
ruling and specifies the reconciliation before the Phase B collapse.

**Product decision (confirmed):** full reconcile first, then collapse.

## Ruling

The `loadRepoBacked*ForTeam` metadata/repo reconciliation is **term-model-agnostic** (it operates on
repos and metadata records; nothing bilingual-vs-monolingual). The divergence is divergent evolution —
each side hardened against different failure modes — **not** justified domain separation. Glossary and
QA should converge on the **union** of consistency behaviors. The only term-model residue is the
language fields when building a metadata record (`sourceLanguage`/`targetLanguage` vs `language`),
which becomes a descriptor hook at collapse time.

## Capability inventory (5 complementary behaviors)

| # | Behavior | Has it | Lacks it | Safety class |
|---|---|---|---|---|
| RF1 | Repair metadata after a **remote rename** (match by repoId/nodeId, rewrite name, keep `previousRepoNames`) | glossary | QA | **safe** (updates names only) |
| RF2 | **Finalize confirmed-missing** repo: tombstone record + purge local checkout | glossary | QA | **DATA-LOSS-SENSITIVE** |
| RF3 | **Backfill** metadata records for local resources missing a record | QA | glossary | **safe** (creates only) |
| RF4 | **Bootstrap untracked remote** repos as sync targets | QA | glossary | **safe** (adds sync targets only) |
| RF5 | **Local-missing recovery**: detect metadata-without-local and rebuild from metadata (+ `recoveryMessage`) | glossary | QA | **safe** (rebuild/warn only) |

Each port is a **faithful mirror** of the existing, production-proven counterpart — do not reinvent
logic. The agnostic reconciliation primitives currently live in `glossary-discovery.js`
(`findMatchingRemoteGlossary`, `findConfirmedMissingGlossaryRecords`, `mergeMetadataBackedGlossarySummaries`);
QA already has `findMatchingRemoteQaList`. Mirror per-domain for now; Phase B extracts the shared core.

## THE safety invariant (RF2 — read before implementing)

Glossary's `finalizeMissingGlossariesForTeam` tombstones the metadata record **and purges the local
repo**. It is safe today only because:

1. It runs **only inside `if (metadataLoaded)`**, i.e. after `listGlossaryMetadataRecords` succeeded.
2. It runs **only after `listRemoteGlossaryReposForTeam(team)` succeeded** — and that function **throws**
   on broker/API failure (it returns `[]` *only* for the no-installation case, which is gated out
   earlier). So a remote-fetch failure **aborts the whole load before finalize ever runs** — finalize
   never sees a partial/empty remote list.
3. "Confirmed missing" = record is `recordState:"live"` AND `remoteState:"linked"` AND unmatched by
   **all four** identifiers (repoName, fullName, repoId, nodeId) against the authoritative remote list.

**The QA port MUST preserve all three.** `listRemoteQaListReposForTeam` already throws on failure
(verified) and is fetched before the metadata branch — so placing `finalizeMissingQaListsForTeam`
**inside QA's existing `if (metadataLoaded)` block, after the authoritative remote fetch** inherits the
invariant. Do **not** call finalize on any code path where the remote list could be empty-due-to-error.
`findConfirmedMissingQaListRecords` must use the existing `findMatchingRemoteQaList` with all four
identifiers, and the tombstone write must use `{ requirePushSuccess: true }` (as glossary does).

### Mandatory RF2 tests (characterization, before merge)
- A record whose remote exists by **only** repoId (name changed) is **not** flagged missing.
- A record whose remote exists by **only** nodeId is **not** flagged missing.
- A record truly absent from a **non-empty** authoritative remote list **is** tombstoned + local purged.
- When **metadata load fails** (metadataLoaded=false), finalize does **not** run (no deletion).
- When the **remote fetch throws**, the load aborts and **no** finalize/purge occurs.

## Sequencing — safe ports first, data-loss port last; one capability per commit

Each commit mirrors the proven counterpart, keeps public exports/signatures stable, `npm test` green,
`audit:unused` clean. Claude reviews **each** commit for faithfulness + safety. Own branch.

1. **RF3 (QA→glossary backfill)** — mirror `backfillQaListMetadataRecords` → `backfillGlossaryMetadataRecords`; language residue = source/target. Slot into glossary load where QA calls it (after metadata load, and again after sync/refresh).
2. **RF4 (QA→glossary untracked-remote bootstrap)** — mirror `buildUntrackedRemoteQaListBootstrapTargets` → glossary; add its results (after `filterKnownDeleted…`) to glossary's sync targets.
3. **RF1 (glossary→QA rename repair)** — mirror `repairGlossaryMetadataFromRemoteRename` → `repairQaListMetadataFromRemoteRename`; language residue = `language`. Slot into QA's `if (metadataLoaded)` block before sync-target building.
4. **RF5 (glossary→QA local-missing recovery)** — mirror the `countRecoverable…` + `installationRecoveryDetected` + `recoveryMessage` path into QA's load and return shape.
5. **RF2 (glossary→QA confirmed-missing finalize) — LAST, with the mandatory tests above.** Mirror `findConfirmedMissingGlossaryRecords` → `findConfirmedMissingQaListRecords` (reuse `findMatchingRemoteQaList`, 4 identifiers) and `finalizeMissingGlossariesForTeam` → `finalizeMissingQaListsForTeam`. Place strictly inside QA's `if (metadataLoaded)` block after the authoritative remote fetch. Preserve the safety invariant verbatim.

After all five, the two `loadRepoBacked*` paths should mirror (token-substituted diff near-empty apart
from language residue), unblocking the Phase B collapse into `repo-resource/repo-flow.js`.

## Phase B note (after this spec lands)

The now-symmetric reconciliation primitives (currently `glossary-discovery.js` + the QA equivalents
this spec creates) are the natural shared core for `repo-resource/repo-flow.js`: extract them once,
parameterized by a descriptor whose only term-model hook is `buildMetadataRecord` (language fields).
