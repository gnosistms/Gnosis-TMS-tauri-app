# Cache And Progress Plan

## Summary

The alignment pipeline should be resumable and transparent. Every expensive stage writes a cache artifact with a content-based signature. On a later run, the app recomputes the canonical input hashes and algorithm version keys, reuses valid stage caches, and marks stale stages for recomputation. Progress is emitted as structured stage events so the UI can show the current stage, completed/total counts, cache hits, warnings, and resumability.

The app must not use file paths as cache keys. In Gnosis TMS, source content normally comes from editor rows and target content usually comes from pasted text. Cache validity is based on canonical content and processing settings, not the file or textarea identity.

## Canonical Inputs

Build a canonical input payload before any expensive work:

```json
{
  "sourceLanguage": "Spanish",
  "targetLanguage": "Vietnamese",
  "sourceUnits": [
    { "id": 1, "text": "..." },
    { "id": 2, "text": "..." }
  ],
  "targetRawText": "..."
}
```

Normalize this into parsed target units:

```json
{
  "sourceUnits": [
    { "id": 1, "text": "...", "originalRowId": "editor-row-id" }
  ],
  "targetUnits": [
    { "id": 1, "text": "...", "originalLineNumber": 1 }
  ]
}
```

Hash content, not containers:

- `sourceContentHash`: hash of source unit texts in order
- `sourceOrderHash`: hash of source unit ids/order, used for safe editor writeback
- `targetRawTextHash`: hash of raw target textarea content
- `targetContentHash`: hash of parsed target unit texts in order
- `languageHash`: source/target language pair

Recommended canonical hash input:

```json
{
  "version": "canonical-input-v1",
  "sourceLanguage": "Spanish",
  "targetLanguage": "Vietnamese",
  "sourceTexts": ["...", "..."],
  "targetTexts": ["...", "..."]
}
```

Use stable JSON serialization before hashing. Do not include file paths, temp paths, textarea session ids, paste timestamps, or UI state.

## Job Layout

Store each alignment run under a job directory:

```text
alignment-jobs/
  align_2026_05_05_001/
    manifest.json
    01-text-units.json
    02-sections.json
    03-section-summaries.json
    04-section-matches.json
    05-section-corridor.json
    06-row-candidates.json
    07-row-merged.json
    08-conflicts.json
    09-split-targets.json
    10-preview.html
    11-final-checks.json
```

`manifest.json` is the source of truth for stage status:

```json
{
  "jobId": "align_2026_05_05_001",
  "createdAt": "2026-05-05T10:00:00Z",
  "updatedAt": "2026-05-05T10:12:00Z",
  "signature": {},
  "stages": [],
  "apiUsage": {
    "callsMade": 0,
    "cacheHits": 0
  },
  "warnings": []
}
```

## Cache Signature

Each stage stores only the signature fields that affect that stage. A downstream stage is stale if its own signature changed or any upstream dependency is stale.

Full signature:

```json
{
  "sourceContentHash": "...",
  "sourceOrderHash": "...",
  "targetRawTextHash": "...",
  "targetContentHash": "...",
  "sourceLanguage": "Spanish",
  "targetLanguage": "Vietnamese",
  "parserVersion": "plain-text-v1",
  "sectioningVersion": "overlap-section-v1",
  "chunkSize": 50,
  "stride": 25,
  "models": {
    "summary": "gpt-5.5",
    "sectionMatch": "gpt-5.5",
    "rowAlignment": "gpt-5.5",
    "conflictResolver": "gpt-5.5",
    "splitTarget": "gpt-5.5"
  },
  "promptVersions": {
    "summary": "same-language-v1",
    "sectionMatch": "adaptive-sparse-overlap-top3-v1",
    "rowAlignment": "row-align-v1",
    "conflictResolver": "row-conflict-v1",
    "splitTarget": "split-target-v1"
  },
  "dpVersion": "corridor-centerline-v1",
  "mergeVersion": "row-merge-v1",
  "htmlRendererVersion": "alignment-preview-v1",
  "finalCheckVersion": "coverage-checks-v1"
}
```

## Invalidation Rules

Stage 1, Preparing text units:
- stale when source content, target raw text, languages, or parser version changes

Stage 2, Building overlapping sections:
- stale when parsed units, sectioning version, chunk size, or stride changes

Stage 3, Summarizing sections:
- stale when section text, language, summary model, or summary prompt version changes
- can be reused per section by section content hash

Stage 4, Finding section matches:
- stale when summaries, section-match model, section-match prompt version, or adaptive search options change

Stage 5, Selecting section corridor:
- stale when section matches, DP version, or DP scoring parameters change

Stage 6, Aligning rows inside matched sections:
- stale when section corridor, row-alignment model, row-alignment prompt version, source units, or target units change
- can be reused per corridor pair by target-section/source-section expansion hash

Stage 7, Merging row-level results:
- stale when row candidates or merge version changes

Stage 8, Resolving conflicts:
- stale when conflicts, conflict resolver model, conflict resolver prompt version, or conflict-region rules change
- can be reused per target conflict by target text plus candidate source sets plus conflict region hash

Stage 9, Splitting combined target rows:
- stale when merged alignments, split-target model, split-target prompt version, source units, or target units change

Stage 10, Building preview:
- stale when merged alignments, split-target output, source/target units, or HTML renderer version changes

Stage 11, Final checks:
- stale when preview inputs, final-check version, source/target units, merged alignments, or split-target output changes

Prefer ignoring stale caches over deleting them immediately. Stale artifacts are useful for debugging. Provide a UI action to clear old job data.

## Stage Progress Events

Emit structured events from the backend:

```json
{
  "jobId": "align_2026_05_05_001",
  "stageId": "row_alignment",
  "stageNumber": 6,
  "stageName": "Aligning rows inside matched sections",
  "status": "running",
  "completed": 18,
  "total": 412,
  "percent": 4.37,
  "cached": 398,
  "apiCallsMade": 14,
  "message": "Aligning target section T8 with source section S6",
  "warningCount": 0
}
```

Statuses:
- `not_started`
- `checking_cache`
- `cached`
- `running`
- `complete`
- `warning`
- `failed`
- `canceled`
- `stale`

If `completed` and `total` are available, the UI uses `completed / total`. If not, the backend may emit `percent`. Prefer counts where possible.

## Stage Counts

1. Preparing text units
- `completed`: parsed source rows + parsed target rows
- `total`: expected source rows + expected target rows if known, otherwise omit
- usually completes quickly; percent can be indeterminate

2. Building overlapping sections
- `completed`: source sections built + target sections built
- `total`: expected source section count + expected target section count

3. Summarizing sections
- `completed`: sections summarized or loaded from cache
- `total`: total source sections + target sections
- `cached`: sections loaded from summary cache
- message example: `Summarizing target section T12 in Vietnamese`

4. Finding section matches
- `completed`: target sections whose adaptive search has finished
- `total`: total target sections
- `cached`: target section searches loaded from cache
- message example: `Searching T12 near S28-S31`

5. Selecting section corridor
- `completed`: target sections placed in corridor
- `total`: total target sections
- usually local-only and fast

6. Aligning rows inside matched sections
- `completed`: corridor section pairs aligned or loaded from cache
- `total`: selected target/source corridor pairs
- `cached`: section-pair row alignments loaded from cache
- message example: `Aligning target rows 126-175 with source rows 101-200`

7. Merging row-level results
- `completed`: target rows merged
- `total`: total target rows
- message example: `Merging row candidates for T148`

8. Resolving conflicts
- `completed`: conflicts resolved or loaded from cache
- `total`: total conflict targets
- `cached`: resolver decisions loaded from cache
- message example: `Resolving conflicting candidates for T148`

9. Splitting combined target rows
- `completed`: split targets processed or loaded from cache
- `total`: target rows with more than one source id
- message example: `Splitting target T84 across S81-S82`

10. Building preview
- `completed`: rows rendered
- `total`: source rows + inserted unaligned target rows
- usually local-only and fast

11. Final checks
- `completed`: checks completed
- `total`: checks planned
- message example: `Checking target word coverage`

## UI Behavior

Show a stage list with one active stage:

```text
1. Preparing text units                complete
2. Building overlapping sections       complete
3. Summarizing sections                42 / 186, 38 cached
4. Finding section matches             not started
...
```

Show cache status when starting:

```text
Cache status:
- Text units: stale because target text changed
- Sections: stale because text units changed
- Summaries: partially valid, 178 / 186 reusable
- Section matches: stale because summaries changed
- Row alignments: stale because section corridor changed
```

Offer actions:
- `Resume with valid cache`
- `Restart from scratch`
- `Clear cached job data`
- `Cancel`

Cancel should be safe because completed stage artifacts are already written. On resume, the app loads the manifest and continues from the first stale/incomplete stage.

## Partial Cache Granularity

Use whole-stage caches for simple stages and item-level records inside expensive stages.

Summaries:

```json
{
  "sectionId": 12,
  "docRole": "target",
  "language": "Vietnamese",
  "sectionContentHash": "...",
  "model": "gpt-5.5",
  "promptVersion": "same-language-v1",
  "summary": "..."
}
```

Section match search:

```json
{
  "targetSectionId": 12,
  "targetSummaryHash": "...",
  "searchedBlocks": [
    {
      "sourceSectionIds": [27, 28, 29, 30],
      "sourceSummaryHashes": ["...", "..."],
      "matches": []
    }
  ]
}
```

Row section alignment:

```json
{
  "sectionRunId": "t12-s28",
  "targetUnitHash": "...",
  "sourceExpansionHash": "...",
  "model": "gpt-5.5",
  "promptVersion": "row-align-v1",
  "candidates": []
}
```

Conflict resolution:

```json
{
  "targetId": 148,
  "conflictHash": "...",
  "sourceRegionHash": "...",
  "candidateSetHash": "...",
  "sourceIds": [142],
  "resolution": "resolver"
}
```

## Implementation Order

1. Add content-hash utilities and stable JSON serialization.
2. Add `AlignmentJobManifest` and `StageStatus` types.
3. Add job directory creation and manifest persistence.
4. Add stage signature comparison and stale-stage detection.
5. Add progress event emitter API in Rust/Tauri.
6. Update summary stage to reuse per-section cached summaries.
7. Update section match stage to cache per-target adaptive search results.
8. Update row alignment stage to cache per-corridor-pair row results.
9. Update conflict resolver to cache per-target conflict decisions.
10. Add resume/cancel handling.
11. Add frontend progress panel and cache status display.
12. Add tests for cache invalidation and progress events.

## Tests

Add tests for:

- content hash unchanged when file path changes but source/target text is identical
- source text edit invalidates all downstream stages
- target text edit invalidates target parsing and downstream stages
- language change invalidates summaries and downstream stages
- chunk size/stride change invalidates sections and downstream stages
- summary prompt version change invalidates summaries and downstream stages
- DP scoring version change invalidates corridor and downstream, not summaries
- HTML renderer version change invalidates preview only
- per-section summary cache reuses unchanged sections and regenerates changed sections
- row alignment cache reuses unchanged corridor-pair runs
- conflict cache reuses unchanged conflict decisions
- progress events include stage id, stage number, status, completed, total, and cached counts
- cancel leaves manifest resumable
