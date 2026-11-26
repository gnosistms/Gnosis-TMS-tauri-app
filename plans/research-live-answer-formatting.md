# Live answers in the research panel: survey and plan

Status: survey done 2026-10-08; reader + sorting histogram built (branch claude/research-live-views); other views proposed below, waiting for Hans. Replaces the
"generic JSON only" decision of `research-log-redesign.md` for the live panel.

## What the panel shows today

While a request runs, the live panel shows the model's thinking summaries
(titles plus paragraphs), then the answer as indented, coloured JSON. Since
2026-10-08 the status line also shows the step, the latest thinking title, a
clock against the step's usual time, and "translation 12 of 31" while writing.

## Measured (all saved runs, 2026-10-08)

| Step | Requests | Median time | Longest | Median answer | Thinking shown |
|---|---|---|---|---|---|
| candidates | 26 | 164 s | 582 s | 7,800 chars | 88% |
| checks | 31 | 68 s | 254 s | 15,800 chars | 23% |
| proposal | 32 | 53 s | 90 s | 8,500 chars | 39% |
| family | 28 | 19 s | 54 s | 2,900 chars | 37% |
| counting (batches of 8) | 259 | 17 s | 42 s | 3,400 chars | 8% |
| parts | 26 | 16 s | 25 s | 1,100 chars | 40% |
| frequency sorting (100 sentences) | 165 | 15 s | 22 s | 2,300 chars | 20% |
| discovery (batches of 10) | 63 | 13 s | 38 s | 2,600 chars | 12% |
| summary | 22 | 10 s | 15 s | 1,800 chars | 9% |
| dictionary (web search) | 5 | 9 s | 13 s | small | 0% |
| sources (+ original-word check) | 38 | 8 s | 280 s | 600 chars | 30% |
| comparison | 8 | 8 s | 11 s | 1,500 chars | 25% |
| convergence | 3 | 7 s | 7 s | 200 chars | 0% |
| footnotes | 13 | 6 s | 9 s | 150 chars | 38% |
| forms (propose / confirm) | 58 | 4 s | 25 s | 200 chars | 6% |

Most of a long request is thinking before the first character of the answer;
the answer then streams in a few seconds. The thinking titles and the clock
cover the wait; live formatting matters for the last stretch, and most for the
big answers (candidates, checks, proposal) and the many batch requests
(counting, discovery, sorting).

## How

1. **Read the unfinished answer as data.** Close whatever is open in the text
   received so far (an unfinished string, the missing `]` and `}`; drop a key
   without a value and a half-written number or `true`), then `JSON.parse`.
   Pure function, many tests with cut-off answers. Re-read at most ~4 times a
   second; the biggest answers are ~30 KB.
2. **One small live view per step**, built from the step's schema and tolerant
   of missing fields; a field still being written grows in place. Same app
   tokens and chips as the finished-step results in the log.
3. **Fallback**: an unknown step, or text that cannot be read, shows today's
   indented JSON. Thinking stays as it is.

## Live view per step (proposal, after looking at a real answer of each)

Chart only where the point is a count (sorting, open reading, counting). The
rest are lists, tables or cards, shaped like the data.

| Step | What the reader needs to see | Display |
|---|---|---|
| **Sorting by meaning** (built) | how the word's uses split over its meanings | **Histogram**: one bar per meaning, named, growing; "needed" marked; leftovers in grey |
| **Open reading** (discovery, batches of 10) | which renderings a translator reaches for | **Tally chart** of renderings across the whole batch (top first), then one line per use: rendering in bold, the phrase translation muted, an expression flagged |
| **Counting** (batches of 8) | which proposed translation wins | **Tally chart** of chosen translations across the batch (by name, not variant id); below, one line per use: the sentence translation with the chosen wording highlighted, a label for "other" / "unresolved" and for a poor fit |
| **Candidate translations** | the options per meaning | One section per meaning (its gloss as heading): each group a row of chips, recommended group first with ★, its note muted; a count "8 renderings in 3 groups" |
| **Candidate checks** | what each translation is made of, and what will be measured | **Table**, one row per translation: its words as chips, a compound's parts small underneath ("= cấp + học"), a look-alike flagged "looks like Spanish “fatal”, will be measured", the meaning needed muted; "translation 12 of 31" bar |
| **Proposal** | the suggested entries | **Document-like cards**: per entry its forms, general note, translations with their notes; then short lists: left out (with counts and reasons), separate studies, open questions |
| **Where the term comes from** | where the word comes from and how the author uses it | Summary paragraph; one **card per meaning**: name, "in the dictionary" or "the author's own", source book, original word (language), meaning there / how the author uses it, equivalences as chips |
| **Parts and meanings** | how the word is built, its meanings, its base words | Parts as an **equation** ("vanid- + -oso") with each part's meaning under it; numbered meanings ("used by the author" label); base words with the meaning needed and "+4 other meanings" |
| **Word forms** | which forms are searched | **Chips**: inflections solid, spelling variants outlined, low confidence faded; when confirming, dropped forms struck through with the reason on hover |
| **Word family** | related words found | Rows: word, how it is built (prefix / suffix / compound), reason muted |
| **Dictionary** (web search fallback) | the definitions | Like a dictionary entry: per source, numbered definitions with labels, source linked |
| **Comparison with the glossary** | what happens to each current translation | Rows: current translation, "kept" / "left out" label, reason |
| **Shared translations** | whether two words may share a translation | Rows: the translation and the two words, "same meaning" / "different meanings" label, reason (pair labels sent with the request) |
| **Rare-translation notes** | which rare translations need a note | Rows: translation, then "understood from its parts" or the note |
| **Summary** | the conclusion | Paragraph growing, recommendations as a list |

Several views need names the answer does not carry (counting gives variant
ids, shared translations give pair numbers): the request carries them, as the
sorting request carries its meanings' names.

## Order of work

1. Partial-JSON reader + tests (cut at every character of real saved answers).
2. View registry by stage, with the JSON fallback; wire into the live panel and
   the stream updater (re-render the view, throttled).
3. The big three first: candidates, checks, proposal; then counting,
   discovery, sorting; then the small steps.
4. Check each in the preview with real saved answers replayed character by
   character; then a real run.
