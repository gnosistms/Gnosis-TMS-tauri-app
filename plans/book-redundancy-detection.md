# Book export redundancy detection

Status: implemented for PR #384; verification recorded below.

Implementation destination: existing PR #384,
<https://github.com/gnosistms/Gnosis-TMS-tauri-app/pull/384>, branch
`codex/book-export-formatting-integration`. The feature implementation, including
tests, belongs in that PR. Adding this document alone does not complete the work.
Preserve unrelated changes in the current working checkout.

## Goal and workflow

Keep the first occurrence of repeated images and equivalent footnotes in the
exported book by default, while letting the user include later occurrences.
Source chapters, translations, images, and footnotes remain unchanged.

The project export composer becomes a three-page workflow:

1. Arrange the book, select its language, and edit its sections.
2. Review redundant images and footnotes and choose which to include.
3. Choose the export destination, format, and existing export options.

Clicking Next on page 1 enters page 2 and loads cached results immediately when
available. Run expensive detection only for new or changed inputs. Page 2 remains
present when there are no duplicates, with a clear empty result. Next proceeds to
page 3; Previous returns to page 1. Previous on page 3 returns to page 2 without
restarting completed detection or resetting checkbox choices.

## Product rules

### Repeated images

- Show one thumbnail per repeated image, followed by the chapter names where it
  occurs. Each chapter has an **Include** checkbox. Show an occurrence count when
  an image appears more than once in that chapter.
- Initially check only the first chapter containing the image, using arranged
  book order rather than alphabetical order or chapter numbering.
- Working behavior for within-chapter repetition: a checked chapter keeps its
  first occurrence of the image; an unchecked chapter keeps none. The UI must
  explain this when the occurrence count is greater than one.
- Include book image sections in detection and identify them by section title
  when there is no chapter name. Inventory images in other exported sections as
  well, so the inventory matches the actual book output.
- Compare image content, not filenames, asset paths, or URLs. Reuse validated
  image loading and managed-asset resolution. Initially support exact bytes and
  exact decoded pixels, including dimensions. Resized, cropped, or perceptually
  similar illustrations are outside the initial automatic grouping rule.
- A missing or unreadable image is unresolved, not evidence of a duplicate.

### Redundant footnotes

- Group footnotes only when they explain the same text/referent and convey
  substantially equivalent information. Matching anchor text alone is
  insufficient. Complementary explanations and conflicting meanings stay separate.
- Each redundant group shows the text being explained at the top, then every
  footnote's full text, chapter name, and **Include** checkbox. Disambiguate
  multiple occurrences in the same chapter with their location/context.
- Initially check only the first occurrence in each redundant group. Unique
  notes, materially different notes, and unresolved candidates remain included.
- Order occurrences by included book item order, then stored row order, then
  marker position within the row. Do not use display footnote numbers as identity.
- Unchecking removes the note's marker and body from export, preserving the
  surrounding prose and formatting. Renumber surviving notes through the existing
  export machinery.
- Exact body equality is strong evidence but still needs compatible anchors and
  context. Context-dependent bodies such as "See the previous chapter" are not
  automatically redundant just because their strings match.
- Both bodies having at least 50 characters and at least 95% normalized edit
  similarity is a strong candidate rule. The later requirement to preserve
  substantially different meanings takes precedence over treating this threshold
  as proof. Changed numbers, names, negation, and citations require scrutiny.

### User choices

- Apply first-occurrence defaults only where the user has made no explicit choice.
  Save explicit checked and unchecked values immediately, locally, including
  when the user cancels or closes before exporting.
- Preserve choices across reopening, navigation, retries, and application restart.
  Do not require a successful export before retaining results or decisions.
- Reordering changes automatic defaults to the new first occurrence while keeping
  explicit choices attached to their original occurrences. Excluding/deleting
  the former first occurrence promotes the next eligible automatic occurrence.
- Allow the user to check multiple occurrences, uncheck the first, or uncheck all.
  Do not force one remaining copy after an explicit user decision.
- Apply decisions only to the selected book language and composition. Standalone
  chapter exports keep their current behavior.

## Existing integration points

- `src-ui/app/project-book-flow.js` owns page navigation and currently takes
  page 1 directly to page 2, including eager PDF font inspection.
- `src-ui/screens/editor-export-modal.js` switches between the composer and export
  options. `src-ui/screens/project-book-composer.js` provides the shared navigation.
- `src-ui/app/project-book-model.js` produces the ordered `bookItems` export input.
- `src-ui/app/project-export-context.js` reads durable chapter snapshots for
  clipboard, Vellum, and WordPress output.
- `src-ui/app/project-book-settings.js` saves account-scoped local preferences;
  `project-book-settings-document.js` and `project-book-settings-sync.js` also
  manage portable, Git-synchronized layout settings. Redundancy decisions and
  detection caches must remain local and stay out of that portable document.
- Native book composition lives in
  `src-tauri/src/project_import/chapter_editor/book_export.rs` and
  `chapter_export.rs`; PDF has its own input and shared document preparation.
- XLSX and SRT currently read combined stored rows rather than just the composed
  export document. Filtering only document blocks would leave a bypass.
- Existing Unicode normalization, Unicode segmentation, image decoding, and
  SHA-256 dependencies can support the detector. Reuse the configured AI provider,
  model selection, credential storage, and provider adapter infrastructure.

## Detection design

### 1. Build an inventory with stable occurrence identities

Read the selected-language content of included book items from a durable local
snapshot, after pending chapter writes finish. Share existing chapter reads where
the snapshot is demonstrably current; a preview promise alone is not a revision
guarantee. Avoid network/git work in the IPC call path.

For each occurrence record book item/chapter ID, row ID, language, kind,
marker/occurrence discriminator, source order, and content signature. Preserve
original text plus mappings from normalized matching text to original spans.
If markers are renumbered, reconcile an occurrence only when its row, body, and
anchor identify it unambiguously. Never transfer an exclusion based on an ordinal
alone when an insertion shifts later notes.

For each footnote, collect its body separately from its preceding text: from the
marker back to the previous actual footnote marker or beginning of that field.
Use the existing markup/footnote parsers. Escaped markers, unmatched bracketed
numbers, and numbers in links are not footnote boundaries. Handle legacy
row-level notes and empty/missing anchors explicitly; ambiguous anchors need AI
context or remain unresolved. Preserve referenced empty notes for export.

Fingerprint source content, including relevant anchor text, note markup/link
destinations, and image bytes or a trusted immutable asset digest. Timestamps,
filenames, source Git HEAD, and URL equality alone cannot prove equality.

### 2. Detect repeated images

Hash bytes once per distinct source asset; group equal byte hashes. For unequal
encodings, hash a defined decoded representation, including dimensions, orientation
handling, and alpha, to find exact pixel matches. Decode one unique image at a
time and retain digests and bounded thumbnails rather than full decoded books.
Reuse existing validated URL-download behavior for uncached remote images; cache
the resolved bytes and digest. Reopening an unchanged export must not trigger
another remote fetch solely to repeat detection. Unavailable images stay included
and can be retried explicitly. Treat changed references or refreshed remote bytes
as changed input; do not promise to detect a remote URL changing without fetching.

Persist occurrence membership, image identity, and thumbnail references. Keep
machine paths and thumbnail bytes out of portable/Git settings. When an omitted
image has a caption, omit its associated caption as well; omit a now-empty
image-only section rather than generating an empty page. Rebuild affected contents
and page references from the final composed output.

### 3. Prune footnote comparisons using local book statistics

Maintain separate normalization policies:

- Exact bodies: normalize Unicode and whitespace conservatively; retain numbers,
  punctuation, case, and link destinations as semantic evidence.
- Candidate contexts: use Unicode normalization and punctuation-insensitive
  matching while retaining boundaries and the original text for AI/display.
  Never mutate source strings or strip meaning-sensitive punctuation from the
  final equivalence decision.

Use grapheme sequences as the universal baseline, without shipping stopword lists,
dictionaries, or language models. Word segmentation can improve matches where
available, but languages without spaces must still work.

Generate candidates through the union of several routes:

1. Hash identical bodies, independent of context matches.
2. Find near-identical bodies with both lengths >= 50 and similarity
   `1 - editDistance(a, b) / max(length(a), length(b)) >= 0.95`. Define character
   length consistently in Unicode graphemes. Use length bounds and justified
   sequence-overlap bounds before threshold-banded edit distance.
3. Find shared context suffixes up to an initial 64-grapheme window, grouping all
   occurrences with a matching suffix rather than comparing only neighboring
   entries in a reversed sort.
4. Find distinctive shared sequences within a bounded context window and shared
   footnote-body sequences, catching explanations attached to different endings.

Score contextual matches by length and rarity in the current book. Count candidate
patterns in ordinary book text as well as footnote contexts, using comparably sized
text windows for distribution statistics. Common function-word endings such as
"the" should contribute little evidence, while a distinctive single name can
contribute enough. Repeated subject vocabulary must not become a hard exclusion.

Build a multi-pattern index for the relevant patterns and scan the book together,
instead of rescanning the whole book for every note. Cache counts. With a fixed
context bound, inventory/index work scales with input size and pattern volume;
matching also costs the number of matches reported. Near-match work depends on
candidate volume and must be measured, not described as universally linear.

Do not compare every footnote pair by default. Detect overly broad buckets and
split/schedule them with bounded memory; do not silently discard overflow pairs.
Lexical pruning cannot prove that differently worded paraphrases are unrelated.
Unmatched notes stay included; tune recall using labeled multilingual examples.

### 4. Ask AI to partition ambiguous candidate groups

Send stable occurrence IDs, full note bodies, original anchor contexts, language,
and enough surrounding context to resolve the referent. Ask for exact quoted
anchor spans and a partition into equivalent subgroups, distinct notes, and
uncertain notes. Same topic, different senses, complementary information,
contradictions, and contextual references must stay separate.

Validate response IDs and quoted spans; reject invented, missing, duplicated, or
incompatible memberships. A connected candidate graph is only a work batch:
similarity between A/B and B/C does not automatically establish an A/B/C group.
Reconcile overlapping batches against cached pair/group evidence without blind
transitive merging. Split large requests deterministically, preserving links
across batches and avoiding silent truncation.

Use bounded provider concurrency and persist each completed result. Cache negative
and uncertain results as well as duplicates, with prompt/algorithm versions and
provider/model provenance. Do not repeat unchanged paid work on navigation.
If AI is unavailable, fails, or returns an invalid answer, keep unresolved notes
included, explain that checking is incomplete, and offer Retry. The user can
continue to page 3 with known results; incomplete work must not look like a
successful "no duplicates" result. An explicit retry may revisit unresolved
inputs without rerunning completed comparisons.

## Local cache, invalidation, and incremental work

Store the inventory, reusable detection evidence, and explicit user decisions
locally, scoped by account, team/installation, project, and language. Reuse
`persistent-store.js` for compact UI preferences; use a Rust-owned versioned local
cache for larger inventories/results/thumbnails rather than copying entire book
text into frontend preference storage. Use atomic writes and corruption recovery.
No new central SQLite store, cloud service, or Git-synchronized decisions are
required. Keep the cache and inclusion choices out of `.gtms/export-settings.json`.

On each entry to page 2, do a cheap inventory/revision check. This is separate from
rerunning detection. Without new or changed relevant content, load existing groups
and choices and make **zero AI calls, zero edit-distance comparisons, and zero
repeat image decodes/hashes** when trusted cached asset revisions are unchanged.
Some source reads may still be necessary to establish that the input is unchanged.

Reconcile changes as follows:

| Change | Required work |
| --- | --- |
| No relevant content changes | Reuse groups, evidence, thumbnails, and choices. |
| New image or footnote | Analyze the new occurrence against cached existing occurrences; preserve completed evidence between unchanged occurrences. |
| Changed body, relevant anchor, or image | Invalidate only that occurrence's dependent results and choices that no longer have a verified content identity; analyze it as changed input. |
| Deleted occurrence | Remove it from active groups and recompute automatic first-occurrence defaults without AI. |
| Reordered chapters/rows | Reorder results and recompute automatic defaults; preserve explicit choices and semantic evidence. |
| Newly included chapter/section | Reuse any valid cached inventory/results; otherwise analyze the newly introduced occurrences against the existing inventory. |
| Excluded item or language switch | Select the appropriate active scope; never apply another language's decisions. |
| Algorithm/schema incompatibility | Migrate compatible data; invalidate affected evidence explicitly instead of trusting an incompatible cache. |

The user's reuse requirement applies to unchanged content. Edits that change a
footnote's meaning or the text it explains must invalidate the affected result
even if the number of notes/images is unchanged; otherwise an obsolete exclusion
could hide a now-distinct explanation. Ordinary unrelated prose edits do not
trigger AI again. If frequency counts change, regenerate candidate routing as
needed while retaining judgments for unchanged semantic inputs.

Cache singleton and rejected occurrences too: a newly inserted note may duplicate
one that previously had no group. Preserve explicit choices when a new member is
added to a validated group. New groups use first-occurrence defaults. If changed
meaning makes a group split/merge, preserve only choices supported by unchanged
occurrence identities and validated new grouping; default uncertain members to
included and make changed membership visible.

## Implementation sequence

1. **Define the native inventory and local cache contract.** Add a focused
   `book_redundancy` module beneath `chapter_editor/`, with separate helpers for
   inventory/identity, image matching, candidate matching, AI adjudication, cache,
   and output filtering as complexity warrants. Use pure functions for the core
   algorithms. Add request/result schemas, content signatures, cache migrations,
   explicit-vs-default choices, and shared JS/Rust fixtures before UI wiring.
2. **Implement deterministic detection and cache reconciliation.** Build the
   inventory, image groups, body equality/near-match paths, multilingual context
   statistics, and incremental updates. Prove unchanged entries reuse results.
   Avoid a new implementation of markup or footnote parsing.
3. **Add cancellable native jobs and AI adjudication.** Register start/status or
   progress/cancel commands through `chapter_editor/mod.rs`, `project_import.rs`,
   and `lib.rs`. Return a job ID immediately; run disk/CPU/provider operations
   outside the IPC/async execution path. Reuse provider adapters and team secrets.
   Fence jobs and events by account, team, project, language, modal entry, and
   input revision. Stop scheduling/cancel supported work on navigation or close;
   retain completed cache entries without publishing stale UI results.
4. **Add page 2 and update navigation.** Introduce
   `project-book-redundancy-flow.js`, a screen renderer, and focused styles. Keep
   page 1's current settings-save boundary; move export controls/PDF inspection
   to page 3. Page 3 Back returns to cached page 2, and page 2 Back re-enters the
   existing page-1 settings synchronization. Update page-number checks throughout
   export flows, modal events, and tests. Reuse shared navigation, modal control,
   checkboxes, accessibility patterns, and tooltips. Preserve scroll/focus when
   results arrive or a checkbox changes. Render only duplicate groups, with clear
   loading, cached, partial, retry, and empty states.
5. **Persist local decisions and produce a verified inclusion manifest.** Resolve
   defaults against the current composition, overlay explicit choices, and pass
   occurrence IDs plus expected content/snapshot signatures to export. Keep
   transient job state and large cached evidence out of the modal and portable
   settings. A stale manifest must trigger affected reanalysis/review before
   output, never silently hide a different note that reused a marker or row slot.
6. **Apply filtering across output paths.** Create one native filtering contract
   for cloned export data before composition/renumbering. Apply it to document
   parts and raw-row XLSX/SRT paths where those formats carry affected content.
   Mirror its behavior for `loadProjectExportBlocks` so clipboard, Vellum, and
   WordPress output agree, using shared golden fixtures to enforce parity. Remove
   exact marker tokens through parser-aware transforms, repair block anchors
   after removals, and preserve literal/escaped bracketed text. Include the
   effective inclusion manifest in PDF font-inspection/render keys, without
   invalidating reusable image-preparation caches unnecessarily. Verify the
   durable snapshot again when exporting to catch intervening edits or sync.
7. **Validate and deliver the implementation in PR #384.** Work against the
   current PR branch/head, preserve unrelated checkout work, and use focused
   commits. Update the PR description around the final implemented behavior and
   validation; do not represent this planning document as a completed feature.

## Validation and acceptance criteria

- Deterministic fixtures cover chapter order, within-chapter repetition, exact
  bytes/pixels across image encodings, different images with the same filename,
  unavailable images, mixed image/text rows, captions, and section images.
- Footnote fixtures cover multiple markers in one field, previous-marker
  boundaries, formatting/links, escaped markers, legacy row-level notes, referenced
  empty notes, identical anchors with different meanings, identical bodies with
  different referents, complementary notes, negation/dates/numbers, 50-character
  and 95% boundaries, nontransitive candidates, and new duplicates of singletons.
- Multilingual fixtures include Latin, combining marks, Arabic/RTL, Indic scripts,
  Thai, Chinese, Japanese, and mixed-language text. No language-specific data files
  are required; common endings alone must not create a confirmed group.
- Mocked AI tests cover valid partitions, distinct/uncertain results, inconsistent
  overlapping batches, malformed IDs/spans, provider failure, retries, and cancel.
  Do not require paid live API calls for the routine test suite.
- Cache tests count actual detector/provider/image-decoder calls: unchanged input
  after reopening/restarting performs no expensive detection; insertion compares
  only new/affected input against the existing inventory; edits/deletion/reorder,
  partial runs, corrupt cache, schema migration, and account/language isolation
  behave as specified. Explicit decisions survive cancellation and navigation.
- Browser tests cover pages 1 -> 2 -> 3 and reverse navigation, thumbnails, group
  headings, full footnote text, initial first-only selection, manual overrides,
  all-unchecked choices, empty results, partial/error states, local persistence,
  keyboard access, and stale event fencing.
- Export fixtures verify PDF, DOCX, HTML, Markdown, TXT, RTF, clipboard/Vellum,
  WordPress payloads, and XLSX/SRT behavior where applicable. Check absence of
  omitted markers/bodies/captions, correct surviving anchors/numbering, final
  contents/page references, and byte-identical source chapter files afterward.
- Benchmark small books, large books, long notes, and pathological repeated
  endings. Record input sizes, elapsed phases, peak memory, candidate counts,
  cache hits, and AI requests. Compare cold, warm, and single-insertion runs;
  optimize from measured results rather than inventing latency targets.
- Run focused native/JS/browser suites during development, then `npm test`,
  `npm run build`, `npm run audit:unused`, relevant browser tests, Rust tests,
  formatting, and strict Clippy on the completed change. Review and document any
  pre-existing failures separately from regressions.

Done means the working three-page export flow and all output paths honor local
inclusion choices, warm-cache reopening skips completed detection, distinct-meaning
footnotes remain included, and the implementation/tests are present in PR #384.


## Implementation and verification (2026-10-27)

Implemented the three-page workflow, native local inventory/evidence cache,
local-only checked/unchecked decisions, bounded raster thumbnails, exact pixel
matching with orientation/color-profile handling, Unicode context-frequency
pruning, threshold-banded edit distance, and AI partitions in batches of up to
24 notes. AI uses the existing configured Review model/provider and the team's
internally stored key; no environment-file key is used or exposed to this feature.

The matcher indexes suffix lengths up to 64 graphemes and longer phrases in the
preceding 128 graphemes. This is a heuristic candidate filter, not a guarantee of
finding every paraphrase. Common endings are downweighted using the book itself;
body equality and near-equality are independent candidate routes. The worst-case
amount of candidate work still depends on how repetitive the book is.

The native cache reuses completed positive and negative judgments and edit-distance
results. Unchanged inventory returns cached groups before candidate generation;
reordered occurrences receive new automatic first-occurrence defaults. New/changed
inputs reuse existing judgments rather than repeating completed AI work. Explicit
choices are saved separately from detector evidence and never enter Git settings.

Native exports and the chapter reads used by clipboard/Vellum/WordPress apply the
same validated exclusions to cloned rows before composition and numbering. Raw-row
XLSX/SRT paths therefore share the policy too. Export checks the reviewed revision
of every included chapter, detecting new notes/images even when that chapter has
no exclusions. A stale review produces a return-to-review message. Remote layout
acknowledgements after page 1 restart page 2 rather than bypassing review.

Verification:
- 3,110 frontend unit/screen tests and 25 workflow tests passed.
- 952 native tests passed, with the existing 13 opt-in checks ignored.
- All 31 project-export Chrome browser workflows passed, including local choices,
  reopening, three-page navigation, and the final exclusion/revision payload.
- Focused native regressions cover Unicode/common endings, edit-distance bounds,
  original-source preservation, marker escaping/math/markup, legacy anchors,
  distinct meanings and malformed AI partitions, cache reuse/corruption,
  image pixels/thumbnails, stale inventories, and native export formats.
- The 1,000-note common-ending benchmark pruned to zero candidates in approximately
  0.2 seconds in an unoptimized local test build; this is an example measurement,
  not a universal latency guarantee.
- Production build, changed-module ESLint, Rust formatting, strict all-target
  Clippy, and whitespace checks passed. The unused-code audit retains its existing
  41-file baseline, without new redundancy-module findings.
- The review page was visually inspected using a browser screenshot.

No paid live provider request was made during verification. Semantic behavior is
covered with validated mock partitions; actual requests use the existing provider
adapters and internal credential loader. Unavailable/failed checks leave unresolved
occurrences included and offer Retry. Unchanged remote URLs reuse cached image
content for detection; detecting an externally replaced image at the same URL
requires a refreshed reference/cache. Resized/cropped images remain outside the
initial exact-image matching rule.
