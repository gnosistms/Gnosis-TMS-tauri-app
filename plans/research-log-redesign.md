# Research log redesign

Status: plan agreed with Hans on 2026-10-08. Not implemented yet.

## Objective

Make the research run modal read like the rest of the app instead of a terminal
dump. The fixes:

1. **Results** (what each step found) use the app's colours, Inter, headings,
   whitespace and real structure (translation chips, rows per word) instead of
   long green monospace lines.
2. **The AI stream** (thinking and answers arriving live) moves into its own
   panel at the bottom of the modal. It isn't formatted field by field. A
   generic pretty-printer indents and colours it, and thinking titles show as
   headings.

## Decisions

| Topic | Decision |
|---|---|
| Layout | Stacked: results on top, live panel below. Not side by side: both kinds of content are wide, and a side column would sit empty between requests and after the run. |
| Live panel | Follows the request that is running now. Shrinks to one line between requests and folds away when the run stops. |
| Request rows | No longer interleaved with the results. Each results section header ends with a small "91 s · $0.05 · details ›" link that shows that request's full exchange (what was sent, thinking, answer, usage) in the panel. |
| Batches | The panel header shows "3 of 8 done, 5 running" and a compact switcher to pick which running request to watch. Default: the most recently active one. |
| Stream formatting | Generic only: indent and colour JSON from bracket depth and string state, character by character. No partial-JSON parsing and no per-stage live renderers: the formatted result appears in the section above once the answer is complete. |
| Thinking | A line that is exactly `**Title**` shows as a small heading; the rest stays as paragraphs. |
| Old logs | Saved runs must still open and read sensibly. Every structured result also carries its text form, and the renderer falls back to it for unknown kinds or missing data. |
| Colours and fonts | Only the app tokens from `styles/base.css` (`--text`, `--muted`, `--surface*`, `--accent`, `--message-*`, `--font-sans`). The GitHub-style hex colours in `glossary-research.css` go. Monospace only inside the live panel. |

## 1. Structured results from the engine

`glossary-research-engine.js` currently flattens every finding into a string
via `fact(text)`, e.g. line 967 joins translation groups with " / " and "; ".
The renderer can't recover structure from that.

- Add `result(kind, data, text)` next to `heading`/`fact`/`info` (around
  line 442). It logs `{ type: "result", kind, data, text }`. `text` is
  exactly what `fact` logs today, so log-only consumers and old renderers are
  unaffected.
- `appendLog` in `glossary-research-flow.js` copies `kind` and `data` onto the
  stored entry (it currently keeps only a fixed set of fields). Saved logs
  (`store.save("log", …)`) then carry the data.
- Keep `data` small and already-shaped for display. Don't log whole stage
  results: the log is capped at `MAX_LOG_EVENTS` and saved with the run.

Kinds, in order of value (one commit each is fine, or batch the small ones):

| Kind | Stage heading | Data |
|---|---|---|
| `candidates` | Candidate translations | `[{ sense, groups: [{ recommended, members: [] }] }]` |
| `checks` | Candidate checks | `[{ target, verdict: "pass"\|"unclear"\|"fail", reasons, notes, clashes }]` |
| `frequency` | Parts and frequency | `{ parts: [{ part, meaning }], measures: [{ language, word, zipf, neededSense, senseText }] }` |
| `sampling` | Sampling | `{ rows, distinct, duplicateGroups, measuring, discovery, overlap, light }` |
| `discovery` | Discovery | `{ read, total, renderings, top: [[rendering, count]] }` |
| `proposal` | Proposal | `[{ sourceTerms, variants: [] }]` |
| `agreement` | Counting | `{ agreed, compared }` |
| `senses` | Where the term comes from | `[{ sense, sourceBook, originalTerm, originalLanguage }]` |
| `shared` | Shared translations | `[{ target, sourceTerms, otherSourceTerms, relation, reason }]` |

Remaining `fact` calls (dictionary status, forms, family, done) stay as text
lines, restyled in §3. Convert them later only if they still read badly.

## 2. Log view model

`glossary-research-log-view.js`:

- `buildLogView` returns **sections** instead of a flat item list: one per
  `heading`, holding its lines/results and the requests made under it.
  Requests are kept per section but are not rendered inline any more.
- A section's summary meta (seconds, cost, failed?) is derived from its
  requests. A section with several requests or a batch shows the total and a
  count.
- `collapseRepeatedBlocks` keeps working on sections.
- New `liveRequest(view, choice)`: the request the panel shows. The person's
  choice (from a "details ›" link or the batch switcher) wins. Otherwise the
  most recently updated running request. Otherwise none.
- Unit tests in `glossary-research-log.test.js`: sectioning, old logs with no
  `result` entries, results without data, live-request choice, batches.

## 3. Results rendering (top)

`screens/glossary-research-modal.js`:

- Section = header row (heading in `--text`, 15px/500; meta + "details ›" link
  right-aligned in `--muted`) + hairline + body with breathing room (≈20px
  between sections).
- One renderer per kind from §1, e.g.:
  - `candidates`: sense as a muted sub-line, each group as a row of chips;
    the recommended group's chips use the accent tint with ★ on the first.
  - `checks`: one row per target, a two-column grid: target (500 weight)
    and verdict text coloured by `--message-success-text` /
    `--message-warning-text` / `--message-error-text`, with reasons below.
  - `frequency`: parts as "a + b + c" chips, measures as a small table.
  - `sampling` / `discovery` / `agreement`: a few stat figures in a row.
- Plain text lines (`fact`, `info`, problems) in Inter. `fact` uses `--text`,
  `info` uses `--muted`, and `problem` uses the existing `modal__error` look.
- Data download progress lines ("Preparing the English frequency data…")
  collapse into one muted line that updates in place.
- The results area is the modal's main scroll area. Keep the "stay pinned to
  the bottom while running" behaviour (`renderKeepingLogPinned`).

## 4. Live panel (bottom)

- A docked block under the results, fixed max height (≈220px, own scroll),
  slightly darker warm surface so it reads as a different kind of content.
- Header: stage · purpose, state ("thinking…", "writing · 784 characters"),
  spinner; batch progress and switcher when relevant; a collapse toggle.
- Body: "What was sent" (folded), thinking, answer, usage, problem. The same
  pieces `renderRequest` shows today, moved here.
- `updateStreamInDom` in `glossary-research-flow.js` targets the panel instead
  of the inline request card (same `data-log-*` attributes, one card). A
  stream for a request that isn't in the panel only updates the batch
  progress text.
- New `glossary-research-stream-format.js`:
  - `formatJsonStream(text)` returns HTML: escapes, indents on `{`/`[`/`,`
    outside strings, colours keys vs string values. Pure, char-by-char, never
    throws, and is cheap enough to re-run on each delta (answers are a few
    KB). If the text doesn't start with `{` or `[`, it's shown as plain text.
  - `formatThinking(text)` turns `**Title**` lines into headings.
  - Unit tests with truncated JSON, escaped quotes inside strings, and
    non-JSON answers.
- After the run stops the panel folds away. "details ›" on any section
  reopens it showing that section's request.

## 5. Styles

`styles/glossary-research.css`:

- Replace `.research-log*`, `.research-request*` and `.research-batch*` rules
  with section, result, chip and live-panel rules built on the app tokens.
- Delete the hard-coded `#0969da`, `#1a7f37`, `#cf222e`, `#8250df`,
  `#57606a`, `#2d333b` and `#f6f7f9` colours.
- Check the modal at its narrowest width: chips wrap and grids collapse to
  one column (extend the existing `@media` blocks).

## Order of work (commits)

1. Stream formatter module + tests (independent, low risk).
2. `result()` in the engine + `appendLog` field copy, for `candidates` and
   `checks` only; text unchanged.
3. Sectioned view model + tests.
4. Results rendering + CSS for sections, text lines, `candidates`, `checks`.
5. Live panel, moving request detail out of the flow; `updateStreamInDom`
   retargeted.
6. Remaining result kinds, one or two per commit.

## Verification

- `npm test` (log view, stream formatter, existing engine/flow tests).
- Run a real research in `npm run tauri:dev` and watch a single request and a
  batch stream; check pinning, the panel switcher, and that "details ›"
  opens the right request.
- Reopen a run saved before this change (Past research → Resume / log) and
  confirm it still reads correctly from text fallbacks.
- Screenshots before/after for Hans.

## Out of scope

- The report page (`glossary-research-report.js`) and the review step layout.
- Any change to prompts, schemas, budget or what the engine does.
