# Research Studio request latency

## Scope and evidence

Continue the Spanish interactive test at the saved vanidad VI step 9 boundary.
The current study has 33 distinct step 9 operations (15 translation and 18
assessment/repair operations). Local read/parse/clone/stringify measurements do
not explain the observed tens of seconds per AI operation. No per-call usage or
duration is currently retained, so network versus model time is not established.
The 100 paragraph records also repeat identical context and citation aliases.

Use the existing configured team credential and model, as already authorized for
this ongoing test. Keep all original studies, tool results, notes and code.

## Implementation

1. Compact outbound research evidence by removing only known, exactly equal
   paragraph aliases. Preserve complete paragraph text, all unique context and
   references, occurrences, and original local evidence. Do not shorten sources.
2. Record native execution duration, cache reuse, AI request duration and provider
   token usage when available. Keep the ordinary result contract unchanged and
   preserve old cache compatibility. Use the existing translation implementation
   and provider usage path rather than a separate translation prompt.
3. Retain these diagnostics with the tool cache and frontend result record; record
   frontend round-trip and persistence durations separately, without adding a
   second write after every request. Persistence timing is included in the next
   normal checkpoint. No prompt, API key or source text in diagnostic logging.
4. Prepare display-only preliminary translations with at most two concurrent
   batches after all source assignment/recovery finishes. These do not edit
   research meanings, candidates or tests. Tool results are already durable;
   update completion progress without a second full-study save per batch. Normal
   stage/pause checkpoints save display fields, and the cached tool result can
   reconstruct a display batch after interruption. Preserve completed batches, cancel
   every active native job on Pause, stop dispatching after failure, and await
   outstanding workers before returning. Keep research/repair loops sequential.
5. Verify exact-alias preservation and nonmutation, actual prompt compaction,
   diagnostic propagation, cache compatibility, cancellation, and native job
   receipts. Measure actual saved-request reductions offline without extra API
   calls. Build and resume the native test from its saved boundary.

## Constraints

No model/reasoning changes, evidence truncation, reduced coverage, combining
translation with its independent judge, or changes to repair and save decisions.
Only the independent display-translation batches gain bounded concurrency.
Streaming progress and research-test batch concurrency remain follow-up options.
This change reduces
avoidable input and establishes evidence; do not promise a proportional latency
improvement from smaller requests.

Official reference: [OpenAI latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization).

## Validation

Implemented exact-alias compaction only at the outbound prompt boundary, with
original evidence unchanged. Offline replay of actual saved requests:

| Request | Evidence before | Evidence after | Reduction |
|---|---:|---:|---:|
| Candidate generation | 415,021 bytes | 289,729 bytes | 30% |
| Bibliography batch | 302,658 bytes | 284,150 bytes | 6% |
| Author mention verification | 303,431 bytes | 303,431 bytes | 0% |

Diagnostics distinguish current native cache reads from new execution. Completed
new executions retain `executionMs`, `aiOperationMs`, provider usage (including
OpenAI cached-input and reasoning counts when supplied), prompt bytes, frontend
round-trip and persistence time. AI operation time includes the production
translation call's local preparation/parsing; it is not a network-only measure.
No first-token or generation-only metric is available yet. Cache reads preserve
original disk diagnostics and do not report the original usage as a new API call.

Validation: 94 focused tests; 2,415 app tests and 25 launcher tests; 29 isolated
browser tests; 793 native library tests passed, 8 ignored; Clippy, JS lint (existing
62 warnings, no errors), production frontend build, native debug build and diff
check pass. The initial sandboxed native HTTP fixture and launcher process tests
needed the approved local-server/process permissions and passed with them.

First native follow-through: the first split child's compound research completed
with aiOperationMs10,226, executionMs10,235, roundTripMs10,446, persistMs21;
1,196 input tokens,303 output tokens including102 reasoning tokens. This one
small call confirms AI-operation time dominates local saving; it does not
establish the larger requests' timing or isolate network versus model time.

Bounded preliminary-translation concurrency implemented: two workers, complete
source classification/recovery first, successful batches checkpointed, all active
jobs cancelled on Pause (including late job starts), no new dispatch after an
error, and remaining workers settled before the stage returns. Retry explicitly
targets the failed request rather than a later successful sibling. Partial invalid
batches do not write display translations. No research test uses these aids.

Final verification: 98 focused tests, 2,419 app tests, 30 isolated browser tests
passed. The retry correction was followed by the full app tests and the focused
browser pause/resume regression again; build, lint and diff check pass. Earlier
793 native tests, 25 launcher tests and Clippy remain applicable (no subsequent
Rust or launcher changes).

Second native call (candidate generation): aiOperationMs16,922, executionMs16,944,
roundTripMs17,124, persistMs14;2,469input tokens and734output tokens including209
reasoning tokens. The two measured small operations spend their time in the AI
operation rather than local persistence. Larger-study measurements remain part
of the ongoing Spanish test. No before/after provider speedup is claimed from
these two different operations.

## Follow-through: repeated grammatical-form repairs

The second vanidad child exposed another avoidable delay. Candidate generation
included the detachable Vietnamese plural marker `những` in the canonical target
phrase. Natural `mọi điều…` renderings therefore failed exact-form checks; the
first repair incorrectly treated them as the same confirmed form. Preserve exact
matching. Through the native UI, use the complete lexical noun phrase `điều phù
hoa…` and retain source plurality/quantity in usage notes. Fresh focused and
complete-entry tests then passed all eight paragraphs without further repairs,
including actual `mọi điều…` renderings. All original attempts remain saved.

At this completed-study boundary, clarify candidate-generation guidance to keep
naturally variable, detachable articles/quantifiers outside canonical lexical
forms unless fixed in the expression. Clarify repair guidance that a replacement
inside a confirmed form is not automatically confirmed: use existing wording,
request an additional form in step 8, or request candidate review in step 9.
Add a Vietnamese regression for exact lexical spans with varying surrounding
quantifiers and a longer overlapping confirmed form. Do not relax matching or
change the repair limits. Verify focused/full frontend checks and browser flow.

Lexical-form guidance implemented at the completed vanidad boundary, retaining all raw attempts. Vietnamese regression verifies natural surrounding quantifiers, longest confirmed target selection, distinct spans, and continued rejection of an unlisted replacement inside a prefixed confirmed form. Full frontend suite:2,420passed; build/lintpass. All30browserregressionspassed.

Fatal EN larger-study measurements: nineteen author-mention checks reused shared
results without new API calls (native execution2–31ms; frontend saves303–1635ms).
Bibliography comparisons1/4and2/4 spent46,297ms/38,327ms in the AI operation;
33,709/59,008input tokens and3,167/2,405output tokens, including159/187reasoning
tokens. First comparison's full-study save took2,406ms; study was13.1MB by the
second comparison. These actual measurements qualify the earlier small-child
save timings: full-study saving adds visible overhead, while the live AI
operation remains the main wait in these requests. No network-only or
first-token breakdown is available. Core research-test batching/coverage and the
configured model remain unchanged.

Removed the redundant preliminary-completion checkpoint write after measuring
large-study saves. Completion progress now renders through a guarded,
non-persisting method; each tool response remains durably saved once, and normal
stage/Pause checkpoints save display translations. Integration test with real
Studio tools and three batches asserts exactly three tool-result saves and no
extra saves on a fully translated resume. Final verification:2,421app tests;
full-flow and two-batch pause/resume browser cases;build/lint/diffcheck pass.
Earlier full30browser,793native and25launcher results remain applicable.

## Pause/resume operation ownership

Code inspection found that the shared guarded() cleanup checks the study owner
but not the particular run. A cancelled run and its outer action can finish
after a resumed run starts on the same study, potentially clearing the new busy
state/message or error. Reproduce with two held native poll responses, Pause,
resume with new requests still held, then release only the old responses. The
new Pause control and busy state must survive until its own results finish.

At the saved fatal4.4.2 boundary, add the deterministic browser regression before
fixing. Give runs/navigation a generation; stale tools, results, errors and
finalizers cannot publish into the new operation. Pause invalidates its previous
run before awaiting cancellation and persistence. Keep normal cancellation and
result caching. Guard the preliminary failure-signature publication too. Verify
full browser flow, pause/resume, double-start and navigation regressions; run
frontend tests/build/lint. Do not reload an active research request.

Native pause/resume audit also found that cancelling removes the only in-flight
request identity while its blocking provider call can still be running. An
immediate identical resume can therefore start a second AI call. Add a native
regression proving one execution with distinct consumer handles across Cancel
and Resume. Keep in-flight work indexed independently from its cancellable
consumer handles; a resumed handle shares that work, and an old poll cannot
consume the new handle's result. Finished work still uses the durable disk cache.
Cancel/delete remain idempotent; delete cancels/removes only its own study scope.
Publish/retry cancelled-before-start work atomically so a resumed caller does
not receive a stale cancellation. Verify native tests and rebuild the QA app at
the saved4.4.2boundary before continuing.

Ownership validation: delayed-poll browser regression failed before the fix with
Pause missing after old responses were released. It now preserves the resumed
busy state, progress, retry signature and error state. All31browserregressions
and2,421app tests pass, with build/lint/diffchecks. Native immediate-resume test
also failed before the fix because it claimed a second execution. Work is now
indexed separately from consumer handles; immediate Resume reuses it with a new
handle, old polls cannot consume that result, and cancellation of one consumer
does not cancel another. Scope deletion and stale worker publication are tested.
Native22focused and797library tests pass(8ignored). Clippy all targets with
warnings denied, debug native build and QA app rebundle passed. Bundle and build
SHA256 both be20b4c1514a9e934cf8643e5c6f676d2ebc550959c759ca290b0d278786d771.
Reopened that exact app and the saved fatal EN study through the native UI at
4.4.2; approved its completed findings and started source consolidation. Real
large-sample preliminary translation follow-through remains in progress.

Fresh fatal EN 4.4.4 source consolidation took166,054ms AI,
166,114ms round trip,2,235ms save. Provider receipt:11,678input tokens,
12,370output tokens including451reasoning tokens;49,395prompt bytes.
This is a concrete large-output bottleneck. Existing exact evidence is retained;
no unsupported claim of network-only delay or measured overall speedup.

Native large-sample follow-through: fatal EN4.6 completed102occurrences in
101paragraphs (100initial+1recovered), checking all187additional available
paragraphs. Source assignments/recovery preceded preliminary display translations.
All7preliminary batches finished with2workers, preserving101display translations
and all source evidence. Per-batch AI20,472–29,731ms; save2,317–3,297ms.
No cached author checks or research test outcomes were counted as fresh API
speedups. Required implementation and validation above are complete; remaining
Spanish acceptance cases continue in their separate interactive-test ledger.

## Observed context mismatch during complete-entry testing

Fatal EN9batch1 paused after three unsuccessful repairs. Its remaining
`diosa fatal` occurrence is explicitly seductive in the saved neighboring source
paragraphs. Assignment receives that context, but translateTrial sets batch
context empty and sends only each paragraph's text; assessment also omits the
neighbors. Repeated note repairs cannot reliably recover missing source context.

At this paused checkpoint, carry existing neighboring source text as optional
per-row context through the normal translation batch contract. Keep sampled rows
independent; never mislabel random paragraphs as consecutive batch context.
Assessment receives the same source context. Neighbors are untrusted source data,
not instructions, extra output rows or meaning hints. Show them in a collapsed
source-context disclosure for human review. No added network requests or new
retrieval, truncation, expected meanings in9, or changes to exact matching.

Version the Studio translation contract so cached no-context trials are stale;
preserve every previous receipt and test. Verify row isolation/default compatibility
in Rust, JS translation/assessment payloads and no assignment leakage, escaped UI
context and cache invalidation, then frontend/native checks. Rebuild/reopen the
QA app only while paused. Retest fatal8and9 with the corrected contract before
saving; continue the remaining primary cases afterwards.

Implemented the optional sourceContextBefore/sourceContextAfter row fields in the
normal native translation contract. Existing calls without these fields keep the
same prompt. Studio8/9supplies each row's own saved neighbors and gives the same
paragraph-keyed context to assessment. Human reports expose escaped source-only
neighbors; finding and translation disclosures preserve independent open states
through progress renders. No extra retrieval/translation rows or expected-meaning
hints were added to9. Studio translation contract is now2; old trials are preserved
but stale. Validation:2,424app tests,32browser tests,798native tests(8ignored),
Clippyalltargets-Dwarnings,frontendbuild,targetedlintanddiffcheckpassed. Browser
and five native localhost-fixture checks required the ordinary approved local
server permissions; they passed when rerun with those permissions. Native build
passed; QA rebundle and live context follow-through in progress.

QA rebundle passed; native build and app binary SHA256 both
40485827a7d99d8a16de5855b122028ccba30fad6fdc55aa3c0bf1310ca1e862.
Reopened the exact app and saved fatal study through the native UI. The saved
three-repair decision correctly resurfaced; stopped it before refreshing tests.
Native report now marks its old batch Recheck pending. Opened the new source
context disclosure and verified the actual saved before/after paragraphs around
diosa fatal, with separate labels and unchanged102occ/101pcounts. Retesting next.
First live contract2translation receipt verifies12rowswith12row-localcontexts
and exactly12nativepromptrows;22,092ms AI. Its assessment caught unnatural
“inevitable axle,” correctly favoring an inexorable-wheel construction. Existing
inexorable candidate was added in one repair round and all12necessityexamples
passed the fresh test; no reassignment or weakened matching. The adverse group
also passed3/3. Remaining focused and complete-entry checks continue.

Observed during the revised47-example focused group: a paragraph has both
seductive beauty and a dark antithesis. Step8focused on the antithesis rendered
both occurrences malign once; its one-paragraph feedback retry passed while
retaining46others. At the completed-study boundary, clarify the existing focused
instruction that its restricted candidate list applies only to the listed exact
occurrences, including when the same source form appears elsewhere in that
paragraph. Other occurrences remain freely translated in their own source
context. This preserves current intended behavior, rather than changing facts,
assignments or test coverage. Add a focused-request regression proving this
clarification does not enter step9. No edit/reload while native research runs.

## Wider context for referential examples

Further primary-source review corrected an agent mistake: the traffic-accident
conclusion9251d771c58c5ba0 refers to a man explicitly killed earlier in El Cristo
SocialIII. Its saved one-neighbor window did not include that fact; changing it
to unfortunate was too conservative. The corpus reference already advertises
/api/sample/context?line_id=16277&context=3. A browser read of that exact endpoint
confirmed the identity/text and three before/after strings, including the earlier
explicit death reference. Restore the lethal assignment after expanding evidence
through the app, not by adding an expected-answer hint to the glossary.

At the paused9checkpoint, add Load wider context to occurrence review where the
corpus reference supports it. Fetch three neighbors with the existing native
background corpus tool; validate returned line/doc/text identity before applying.
Keep all old raw receipts, source text, occurrences and counts. Canonical context
aliases must agree. Show loading/error inline; allow Cancel and prevent stale
closed-modal results from replacing another review. Persist expanded source
evidence and require affected meaning/entry tests again, without resuming AI
automatically. No extra translated rows, meaning hints or wholesale expansion of
every paragraph. Cover identity rejection, unchanged counts, cache invalidation,
native route, and browser load/cancel/error/resume; rebuild and verify the actual
case through native controls. Then restore9251d771c58c5ba0tolethal and retest.

Implemented the wider-context review control at the paused checkpoint. It uses
the advertised fixed corpus endpoint, validates line/doc/text identity and string
arrays before changing saved context, aligns existing aliases and preserves all
receipts/counts. The main research retry pointer is isolated from this read;
context errors use the existing retry counter to bypass invalid cached receipts.
Cancel stops the lookup and modal ownership prevents obsolete publication. Source
context changes require meaning retesting. Focused multi-occurrence wording was
also clarified here while paused, with a regression proving step9stays blind.
67focused and2,425app tests pass;22nativeStudio regressions andClippypass.
Cancellation and identity-error browser cases passed initially; the successful
load test needed a dialog-scoped selector because the same disclosure exists in
the underlying report. Corrected that test selector; full35browser run pending.
Native build and subsequent live evidence expansion/assignment correction pending.
Full35browser checks now pass, as do frontendbuild/targetedlint/diffcheck. Native
debug build passed in46s. Prior full798native tests remain applicable to the
unchanged AI row-context code; the only later native change is the additional
advertised read-only corpus endpoint, covered by the22Studio checks and upcoming
live fetch. QA rebundle and live source correction next.
QA rebundle passed; build and bundle SHA256 both
95803a82c2ba131118bc253b1ac7aeb650f0a21ec5985d0fba394f7b78c46895.
Reopened that app through native controls. Source expansion and correction are
still pending; do not treat the earlier unfortunate assignment as final evidence.

- Live native wider-context verification succeeded: Load wider context showed loading with Save disabled and Cancel available, then returned 3 paragraphs before/after. Expanded source explicitly says «morir despedazado» and later «condenado a morir». Through Review occurrence meaning restored 9251d771c58c5ba0 from unfortunate m2 to lethal m7, then durably saved. Counts now m2=2,m7=5 (102occ/101p unchanged). Retest meanings requested normally; prior trials remain stale until current-context rechecks. No paragraph-specific target hints added.

- Further contextual review corrected over-narrow literal-death assignments. e5a10c51e202d21c develops an inevitable consequence of childhood conditioning (m1), while af1268cac35ea212 describes destructive dark influence/lost self-command (m4), despite nearby references to homicide. Native Review meaning saved both. Expanded traffic ending context establishes a death, but not that the adjective itself means death-dealing rather than tragic; restored its adverse-outcome m2 assignment after reviewing full evidence, without deleting expanded context. The earlier statement that death evidence required m7 was too strong. Final source counts m1=13,m2=3,m3=25,m4=48,m5=5,m6=5,m7=2,m8=1, total102occ/101p. Focused repair3 and interrupted4 preserved; no literal matching relaxation.
