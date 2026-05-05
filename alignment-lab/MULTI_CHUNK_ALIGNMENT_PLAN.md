# Multi-Chunk Alignment Pipeline Plan

## Summary

Move the alignment lab from a single GPT row-alignment call to a long-document pipeline. The existing single-chunk path remains the row-level engine. The new chunked path splits source and target documents into overlapping sections, summarizes sections, uses binary section-pair classification plus dynamic programming to produce an ordered section alignment, runs row-level alignment per matched section, reconciles duplicate/conflicting target-row candidates, then runs the existing split-target, HTML, and final-check stages.

Dynamic programming is the right fit for section matching because individual section-pair classifications can be noisy, but the final section path should still be globally coherent and mostly order-preserving. GPT should not be asked to produce unconstrained numeric match scores for every matrix cell. Test runs showed full rows of mostly bad numeric scores can be inflated. The sparse approach asks GPT to return only positive overlap matches, capped at three per target section, with an estimated overlap percent for each returned match.

## Pipeline

1. Keep the current single-chunk logic as reusable row-level alignment functions:
   - parse source and target units
   - call GPT with strict JSON schema
   - validate `{ targetId, sourceIds }`
   - run split-target fragment pass
   - render HTML
   - run final coverage checks

2. Add a new CLI command:

   ```bash
   cargo run -- align-chunked \
     --source fixtures/source.txt \
     --target fixtures/target.txt \
     --model gpt-5.5 \
     --chunk-size 50 \
     --stride 25
   ```

3. Build overlapping source and target sections:

   ```json
   {
     "sectionId": 3,
     "unitRange": [51, 100],
     "units": [{ "id": 51, "text": "..." }]
   }
   ```

   Defaults:
   - `chunkSize = 50`
   - `stride = 25`
   - ids remain absolute
   - no owned rows
   - overlap is redundant recovery coverage, not just context
   - every row-level section run may produce candidates for every target row it contains

4. Summarize source and target sections with GPT into structured metadata.

   The summary function should take the known document language as an explicit input argument. In the TMS app, this comes from the source and target languages selected by the user. The prompt should also explicitly require GPT to summarize in that same language and not translate the summary.

   ```json
   {
     "sectionId": 3,
     "language": "Spanish",
     "summary": "...",
     "headings": [],
     "names": [],
     "numbers": [],
     "dates": [],
     "distinctiveTerms": []
   }
   ```

   These summaries and anchors are only for matching. They are never used as copied alignment text.

   Summary prompt rules:
   - summarize in the original language of the section
   - do not translate into English or any other language
   - preserve key names, headings, numbers, dates, distinctive phrases, and terminology
   - do not judge whether the section matches any other section

5. Generate sparse target/source section candidates.

   Do not compute the full target-section/source-section matrix. Most cells are known to be `no_match`, so the full matrix wastes API calls and makes DP larger than necessary.

   For each target section, build a generous candidate set from:
   - expected monotone position, scaled by source/target section counts
   - a positional radius around that expected section
   - deterministic anchors such as shared numbers, names, headings, dates, and distinctive terms

   Candidate debug output:

   ```json
   {
     "targetSectionId": 4,
     "expectedSourceSectionId": 3,
     "candidateSourceSectionIds": [1, 2, 3, 4, 5, 8]
   }
   ```

6. Add adaptive candidate expansion for large offsets and inserted/deleted sections.

   The initial positional candidates are only a first guess. They are not enough when:
   - the source document has a large source-only prefix
   - the target document has a large target-only prefix
   - either document has a large inserted/deleted block in the middle
   - the two documents are the same content but begin at different locations

   Add an adaptive search stage that can discover matches outside the initial positional band before DP runs.

   For each target section:
   - start with the normal sparse candidate set
   - ask GPT for up to three positive overlap matches
   - if no matches are found, expand the source search window forward and backward in blocks
   - stop expanding when matches are found or a configured search budget is exhausted
   - cache every expansion result so retries do not repeat paid API calls

   Expansion defaults:
   - `initialRadius = 3` source sections
   - `expansionBlockSize = 4` source sections
   - `maxExpansionBlocks = configurable`
   - `maxPositiveMatchesPerTarget = 3`
   - expansion order alternates forward and backward from the expected position

   Example for a large source-only prefix:

   ```text
   T1 expected near S1
   try S1-S4 -> no matches
   try S5-S8 -> no matches
   try S9-S12 -> no matches
   try S13-S16 -> matches found
   ```

   The candidate cache should record both the initial candidates and every expanded block tested:

   ```json
   {
     "targetSectionId": 1,
     "expectedSourceSectionId": 1,
     "searchBlocks": [
       { "sourceSectionIds": [1, 2, 3, 4], "status": "searched", "matches": [] },
       { "sourceSectionIds": [5, 6, 7, 8], "status": "searched", "matches": [] },
       { "sourceSectionIds": [9, 10, 11, 12], "status": "searched", "matches": [] },
       {
         "sourceSectionIds": [13, 14, 15, 16],
         "status": "searched",
         "matches": [
           { "sourceSectionId": 14, "estimatedOverlapPercent": 80 }
         ]
       }
     ]
   }
   ```

   For middle-of-document disruption, use the previous accepted DP/source locality as an additional search center. If target section `T40` matched around `S55`, then `T41` should first search near `S55-S58`, not only near the global proportional estimate.

   Candidate centers for each target section should be:
   - global proportional expected source section
   - local continuation from previous discovered matches
   - deterministic anchor hits from names/numbers/headings/distinctive terms

   If all expansion blocks return no matches, keep a `null` state for that target section. DP will interpret it as target-only inserted material.

7. Ask GPT to classify only sparse candidates.

   Use the prior that a target section should have no more than three overlapping source sections because sections are 50-row windows with 25-row stride. The API response should return only positive matches; omitted candidates are implicit `no_match`.

   ```json
   {
     "targetSectionId": 4,
     "matches": [
       { "sourceSectionId": 2, "estimatedOverlapPercent": 30 },
       { "sourceSectionId": 3, "estimatedOverlapPercent": 90 },
       { "sourceSectionId": 4, "estimatedOverlapPercent": 45 }
     ]
   }
   ```

   Prompt rules:
   - match means the two sections contain overlapping translated/source rows
   - return at most three matches for each target section
   - include `estimatedOverlapPercent` for each returned match
   - omit non-matching candidates
   - do not explain decisions

   This keeps output small, avoids the all-bad-row over-optimism problem, and gives DP at most four states per target section: three matches plus `null`.

   Deterministic anchors still help preselect candidate pairs and debug decisions:
   - headings
   - names
   - numbers
   - dates
   - distinctive terms

   Debug output:

   ```json
   {
     "targetSectionId": 4,
     "candidateSourceSectionIds": [1, 2, 3, 4, 5, 8],
     "matches": [
       { "sourceSectionId": 2, "estimatedOverlapPercent": 30 },
       { "sourceSectionId": 3, "estimatedOverlapPercent": 90 }
     ]
   }
   ```

8. Use sparse dynamic programming to score a centerline and preserve a corridor.

   Because windows overlap, the section-level output should not be a single path through the matrix. The DP centerline is only a continuity/scoring aid. The actual output for row-level alignment is a corridor containing every positive overlap returned for that target section.

   ```json
   {
     "targetSectionId": 4,
     "sourceSectionIds": [8, 9, 10],
     "centerlineSourceSectionId": 9
   }
   ```

   ```json
   {
     "targetSectionId": 5,
     "sourceSectionIds": [],
     "centerlineSourceSectionId": null
   }
   ```

   DP constraints:
   - target sections are processed in order
   - source section ids must be nondecreasing
   - repeated source section ids are allowed because sections overlap
   - null is allowed for inserted/unmatched target material
   - source sections may be skipped

   DP scoring:

   ```text
   score =
     match_base_reward
     + estimated_overlap_percent
     - jump_penalty
     - null_penalty
   ```

   Initial weights should be simple and inspectable:
   - `match = base_reward + estimatedOverlapPercent`
   - `null = configurable penalty`
   - `jump = penalty based on source-section distance`

   DP never needs to iterate over full-matrix `no_match` cells. It only considers returned matches plus the null state for each target section. After the centerline is selected, keep all returned positive overlaps for that target section as the selected corridor.

   DP behavior with insertions/deletions:
   - source-only inserted sections are skipped because source ids may jump forward
   - target-only inserted sections become `sourceSectionId: null`
   - leading source-only material is skipped when adaptive expansion finds the first target match at a later source section
   - large middle insertions are handled by jump penalties that allow jumps when positive match evidence is strong

   DP should not assume that `T1` aligns near `S1`. It should only prefer continuity after adaptive search has produced candidate matches.

9. Run row-level alignment per corridor pair.

   If `sourceSectionIds = []`, create `sourceIds: []` candidates for target rows in that section.

   Otherwise run the current row-level GPT alignment once for each selected target/source section pair in the corridor using:
   - target units from that target section
   - source units from each matched source section
   - source section expanded by one neighboring section on each side, when available

   Candidate output:

   ```json
   {
     "targetId": 55,
     "sourceIds": [74],
     "targetSectionId": 4,
     "sourceSectionId": 9,
     "sectionRunId": "t4-s9",
     "isCenterlineSection": true,
     "estimatedOverlapPercent": 90
   }
   ```

   Row-level section runs:
   - use the existing single-chunk alignment prompt/schema
   - keep absolute target/source unit ids
   - include only the units in the selected target section and selected source section expansion
   - never let GPT copy text; it returns ids only
   - validate every section-run response with the existing row-alignment validator

   Source expansion for each corridor pair:
   - primary input is the selected source section
   - include one neighboring source section on each side when available
   - keep absolute ids so overlap between neighboring section runs can be merged deterministically

   Target handling:
   - run each target section once for every selected source section in its corridor
   - if a target section is `null`, emit unaligned candidates for all target rows in that target section
   - because target sections overlap, the same target row will usually appear in multiple section runs

   Row-alignment candidate output cache:

   ```json
   {
     "targetId": 55,
     "sourceIds": [74],
     "targetSectionId": 4,
     "sourceSectionId": 9,
     "sourceExpansionRange": [76, 125],
     "sectionRunId": "t4-s9",
     "isCenterlineSection": true,
     "estimatedOverlapPercent": 90
   }
   ```

10. Reconcile target-row candidates.

   Group candidates by `targetId`.

   Rules:
   - if all candidates agree, accept that source-id set
   - if all candidates are `[]`, accept `[]`
   - if candidates disagree, run the conflict resolver
   - if some candidates are empty and some non-empty, run the conflict resolver

   Candidate normalization before comparison:
   - sort and deduplicate every `sourceIds` list
   - remove source ids that are outside the full source document
   - keep `[]` as a valid unaligned target candidate
   - preserve provenance for every candidate so conflicts can be debugged

   Straightforward merge examples:

   ```json
   {
     "targetId": 55,
     "acceptedSourceIds": [74],
     "status": "agreed",
     "candidates": [
       { "sectionRunId": "t4-s8", "sourceIds": [74] },
       { "sectionRunId": "t4-s9", "sourceIds": [74] }
     ]
   }
   ```

   ```json
   {
     "targetId": 56,
     "acceptedSourceIds": [],
     "status": "agreed_unaligned"
   }
   ```

11. Conflict resolver.

   For disagreeing candidates, compute the conflict source region:

   ```text
   start = max(firstSourceId, min(candidate source ids) - 1)
   end   = min(lastSourceId, max(candidate source ids) + 1)
   ```

   Prompt GPT with:

   ```json
   {
     "targetUnit": { "id": 55, "text": "..." },
     "candidateSourceIds": [[74], [76]],
     "sourceUnits": [
       { "id": 73, "text": "..." },
       { "id": 74, "text": "..." },
       { "id": 75, "text": "..." },
       { "id": 76, "text": "..." },
       { "id": 77, "text": "..." }
     ]
   }
   ```

   Strict output:

   ```json
   {
     "targetId": 55,
     "sourceIds": [74, 76]
   }
   ```

   Rust validation:
   - `targetId` must match
   - every `sourceId` must be inside the conflict region
   - every `sourceId` must exist in the source document
   - `sourceIds` may be empty
   - returned ids are sorted and deduplicated
   - non-contiguous ids are allowed but logged as unusual

   If GPT conflict resolution fails:
   - fall back to the strongest deterministic candidate
   - write the issue to `chunk-conflicts.json`

   Conflict resolver input should include:
   - the target unit id and target text
   - all distinct candidate source-id sets
   - the expanded conflict source region
   - provenance of which section runs produced each candidate

   Resolver prompt:
   - ask GPT to choose the source ids in the provided conflict source region that match the target unit
   - allow `sourceIds: []`
   - allow multiple source ids for a single target row
   - return ids only
   - do not copy source or target text

   Resolver validation:
   - returned `targetId` must match the conflict target
   - each returned source id must be inside the conflict region
   - ids are sorted and deduplicated
   - non-contiguous source ids are allowed but flagged in debug output

   Deterministic fallback if resolver fails:
   - prefer candidates from centerline section runs
   - then prefer candidates from higher section overlap percent
   - then prefer non-empty over empty when there is positive section evidence
   - then prefer the candidate with the smallest source jump from neighboring accepted rows
   - write fallback reason and candidate provenance to `chunk-conflicts.json`

12. Produce the whole-file row-level alignment.

   After conflict resolution, write one accepted alignment per target unit:

   ```json
   {
     "targetId": 55,
     "sourceIds": [74],
     "status": "accepted",
     "resolution": "agreed"
   }
   ```

   Global row-level report should include:
   - parsed source units
   - parsed target units
   - section corridor
   - all row-alignment candidates
   - merged target-level alignments
   - conflicts and resolver decisions
   - model ids and prompt/schema versions
   - cache file references

13. Run the existing downstream pipeline globally:
    - split-target fragment pass
    - unresolved split fallback
    - HTML rendering
    - final checks
    - final JSON report

## Cache Boundaries

Cache after each full-data stage, not after every individual prompt unless a stage needs resumability during development. The intended cache artifacts are:

- section windows after source and target documents are parsed and chunked
- section summaries after every source and target window has a summary
- sparse section candidates after candidate generation
- adaptive candidate expansion results after all expansion searches complete
- sparse section match labels after every target section has up to three positive matches
- dynamic-programming output after the section path is selected
- row-level alignment candidates after all selected section pairs have been aligned
- merged whole-file row alignments after candidate reconciliation
- conflict-resolution output after all candidate conflicts have been resolved
- split-target fragment output after all split targets have been processed

Each cache should include the source/target file identity or content hash, chunk size, stride, model id, and prompt/schema version so stale data can be rejected deterministically.

## Debug Outputs

The chunked command should write:

- `section-windows.json`
- `source-section-summaries.json`
- `target-section-summaries.json`
- `section-sparse-candidates.json`
- `section-candidate-expansions.json`
- `section-sparse-labels.json`
- `section-matches.json`
- `row-alignment-candidates.json`
- `row-alignment-merged.json`
- `chunk-conflicts.json` when conflicts or resolver failures occur
- `split-target-errors.json` when split-target fragment validation fails
- `alignment-report.html`

## Tests

Add tests for:

- section generation with 50-row chunks and 25-row stride
- every target row appears in at least one section
- section summary prompt/schema
- sparse section candidate generation
- adaptive candidate expansion for no-match candidate blocks
- sparse match prompt/schema with at most three positive matches per target section
- DP cost construction from sparse match labels plus null
- DP matcher allows nulls, skips, repeats, and monotonic source order
- row-level section-run candidate generation for every selected corridor pair
- row-level section runs use absolute ids
- candidate grouping by `targetId`
- straightforward candidate merge when all candidates agree
- unaligned candidate merge when all candidates are empty
- conflict region expands by exactly one source row
- conflict resolver validates GPT output
- failed conflict resolver falls back deterministically
- whole-file merged row alignment contains every target id exactly once
- final chunked alignment feeds split-target pass and HTML rendering

## Implementation Order

1. Section generation and tests.
2. Section summary prompt/schema.
3. Sparse section candidate generation.
4. Sparse match prompt/schema with at most three positive matches per target section.
5. Adaptive candidate expansion for target sections with no positive matches.
6. Dynamic-programming matcher.
7. Section corridor output and HTML/debug report.
8. Row-level section-run candidates for every selected corridor pair.
9. Candidate reconciliation for agreeing row-level results.
10. Conflict resolver for disagreeing row-level results.
11. Whole-file merged row-level alignment report.
12. Integration with the existing split-target pass and HTML report.
13. Debug JSON outputs and final tests.
