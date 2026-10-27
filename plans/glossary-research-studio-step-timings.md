# Research Studio step timing

Keep the real acceptance run paused. Add measurement, not optimizations or paid
research runs, so later efficiency decisions can use saved evidence.

1. Record automated step runs with start/end timestamps, active elapsed time and
   completion/pause/error/reuse outcomes. Exclude human review and time between
   Pause and Resume. Keep separate attempts rather than overwriting prior runs.
2. Link tool attempts to the step and nested work-list path. Retain request elapsed
   time, native execution/AI duration, save duration, cache source and provider token
   usage when actually supplied. Cached reads must not count historical AI time or
   tokens as fresh work. Cancellation closes timers immediately and late results
   cannot reopen them. Parallel work has measured wall time; sums of overlapping
   operation times are explicitly labeled, never presented as step wall time.
3. Measure normal study saves by step, without additional full-study writes.
   As with existing persistMs diagnostics, a write's measured duration becomes
   durable at the next normal checkpoint; do not claim the current file includes
   its own final write duration. Existing studies' missing timing stays unknown.
4. Display saved step totals and per-operation timings with a collapsible table
   ordered by automated elapsed time, plus readable timings in the nested list.
   Include the data in the existing research JSON export. Avoid prompts, source
   text and credentials in timing records. Do not change research signatures.
5. Verify deterministic clock-based pause/resume/error/cache/parallel accounting,
   durable export/reopen behavior and UI escaping/formatting. Run frontend tests,
   browser fixtures, lint/build and unused audit. No paid AI calls.

Observed priorities for later work: stop repairs caused by missing context or
incorrect source assignments; avoid full retranslation of already passing work
when safe; reduce oversized prompts/repeated evidence and long synthesis output;
reuse source research across target languages; consider bounded independent work
concurrency; reduce large-study rewrite costs. These are proposals, not authorized
changes to research coverage, providers, models or agreed repair limits.

## Saved-request observations (read-only, fatal EN)

The real study is paused at8. Its saved JSON is39,092,578bytes after preserving
previous requests and repairs. Individual fresh-execution receipts show:

| Operation | AI operation | Input tokens | Output tokens | Save wait |
| --- | ---: | ---: | ---: | ---: |
| Source summary4.4.4 |166.054s|11,678|12,370|2.235s|
| Bibliography consolidation4.4.1 |157.329s|10,144|11,727|1.318s|
| Meaning inventory4.5 |118.080s|13,227|8,425|2.365s|
| Bibliography comparison4/4 |58.400s|63,799|3,649|1.393s|
| Candidate generation6 |54.104s|78,295|2,864|2.396s|

These are individual historical AI-operation measurements, not complete step
wall times or a network/generation breakdown. Long outputs and repeated synthesis
are candidates for investigation; these samples do not establish causality or
an overall before/after improvement. No new AI calls were made to obtain them.

Highest-priority opportunities after measurement:

- Route failures by cause: missing context, source meaning needing human review,
  absent target form, usage-note selection or unrelated sentence quality. Avoid
  spending repeated repair calls on a problem that needs source/meaning review.
  Human decisions should be resolved once from evidence, rather than oscillating
  with individual AI judgments. The agent spent excessive time doing this for fatal.
- Stabilize a draft on a smaller diagnostic set before repeated full-sample tests,
  while retaining all required final examples and independent assessment. Reuse
  work only when the relevant inputs truly remain unchanged; global-note changes
  can legitimately require a full recheck.
- Reduce repeated long prose synthesis. Preserve complete source receipts and
  quotations, but consider a concise structured findings layer passed between
  bibliography, source-summary and inventory steps instead of regenerating the
  same lengthy evidence/definitions in several reports.
- Extend reuse of source discovery/provenance across target languages. DLE and
  author-mention caching already help; target-specific definitions and usage
  judgments still need independent language-aware work.
- Evaluate bounded concurrency for independent source checks once timings expose
  their share of wall time. Keep dependent edits and repair loops sequential.
- Reduce large-study rewrite costs with separate immutable receipts and compact
  study snapshots, preserving audit history. This is secondary to minute-long AI
  work but can compound across many requests. Some redundant saves are already removed.

Already addressed in prior work: missing neighbor context in translation/judging,
optional wider-source lookup, exact duplicate evidence aliases, duplicate native
requests during pause/resume, redundant preliminary completion saves, and bounded
concurrency for preliminary display translations. Do not claim these have a
measured aggregate speedup yet.

## Implementation and verification

Implemented versioned local timing records under study.timing. Automated runs
retain monotonic elapsed durations, wall-clock audit timestamps, outcomes, model
identity and workload counts. Tool attempts retain their nested work-list paths,
request/AI/native execution/save measurements where available, and actual supplied
provider usage. Study/native cache reuse excludes original cached AI time and
usage from fresh-work totals. Pauses close timers before waiting for cancellation;
late results cannot resume a closed timer. Checkpoints retain explicitly partial
in-flight measurements, without inventing an end time after reopening.

The collapsible Step timings table ranks recorded automated elapsed time, with
request/retry details. The nested work list shows union-of-interval tool time for
each branch (parallel children count once within a run). Summed AI and save waits
are labeled non-additive, and human review/offline gaps are excluded. Normal save
waits are recorded by step; the final write duration becomes durable at the next
normal checkpoint. Existing Export research includes timing data automatically.
Older unmeasured work is marked unknown; historical request receipts remain intact.
No added tool requests, changes to research/cache signatures or extra study writes.
Optional wider-context reads and retained-entry verification also receive timings.

Validation:2,440app unit tests,37Studio browser tests,production build,targetedlint
anddiffcheckpassed. Unusedbaseline341files/26exportsunchanged. Browser fixtures
verify durable saves/reopen/export and no extra research request on reopening;
clock-controlled tests verify cache accounting, errors, pause/late results,
parallel wall time, partial snapshots and safe model/workload metadata. Native
research remained paused and no paid AI calls were made for this change.
