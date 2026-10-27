# Project Search Relevance Gate

## Goal

Preserve the project → chapter → row search tree without allowing low-quality
matches to become prominent merely because results are grouped. By default, the
tree contains only strong matching rows. Users can deliberately reveal the
weaker matches returned by the same search.

## Relevance model

- Treat the row as the leaf search result. A row's relevance score is the
  maximum score of its matching excerpts.
- Apply the quality gate to rows before constructing the hierarchy. Empty
  chapters and projects therefore disappear from the default tree.
- A chapter's relevance score is the maximum score of its visible rows. A
  project's relevance score is the maximum score of its visible chapters.
- Sort sibling projects and chapters by descending relevance score with the
  existing title tie-breakers. Continue sorting rows within a chapter by
  `rowOrderKey`, because the source document's reading order is useful after a
  chapter has been selected.
- Describe this in product and code terminology as “highest relevance score,”
  not “maximum rank.” If ordinal ranks are discussed, the inherited value is
  the best (minimum-numbered) descendant rank.

## Quality classification

- Keep classification in the Rust search layer, next to the scoring formula.
  The frontend must not reverse-engineer quality from the numeric `score`.
- Add a pure row-quality classifier that receives the complete score-ordered
  logical-row set and assigns each row `strong` or `weaker`. It must always keep
  at least the best row, handle tied scores deterministically, and classify all
  rows on the retained side of a boundary identically.
- Calibrate the boundary from representative exact, multi-token, fuzzy,
  short-query, long-field, footnote, caption, and multilingual searches. The
  current score is an unbounded ranking value, not a confidence probability, so
  do not introduce an arbitrary percentage cutoff.
- Use the first material score separation after a small protected top set as
  the initial adaptive boundary. If no meaningful separation exists, use a
  conservative default top-row ceiling to prevent an unbounded weak tail. Keep
  the separation threshold, protected-row count, and fallback ceiling as named
  backend constants backed by golden fixtures, so later tuning does not alter
  the interface contract.
- Run classification after document matches have been aggregated into unique
  rows. A row with several matching excerpts therefore occupies one position in
  the score distribution.

## Backend interface

- Add `qualityTier` to each logical row result. Retain all strong and weaker
  rows in the existing single capped response so revealing weaker matches does
  not rerun the query or rebuild the index.
- Add `strongTotal` and `weakerTotal` for the rows actually returned. Preserve
  `total` as the total returned unique-row count and preserve `totalCapped` as
  the indication that the complete match set may be larger.
- Keep excerpt ordering and row aggregation unchanged. The row score remains
  the maximum excerpt score, and classification never removes excerpts from a
  retained row.
- Document capped-count semantics carefully: when `totalCapped` is true, do not
  claim that the unknown remainder belongs specifically to either quality tier.

## Frontend state and behavior

- Add `includeWeakerMatches`, defaulting to `false`, to Projects search state.
  A changed or cleared query resets it to `false` along with project/chapter
  expansion.
- Build the tree from strong rows by default. When weaker matches are enabled,
  build it from all returned rows. Perform project/chapter max-score propagation
  from that selected leaf set, rather than retaining scores from hidden rows.
- Preserve current project and chapter expansion sets when the weaker-match
  control is toggled. Newly introduced branches start collapsed; IDs no longer
  present in the selected leaf set have no rendered effect.
- In the default state, label the summary “N strong matching rows” and show a
  secondary action such as “Include M weaker matches.” When enabled, show the
  ordinary total and change the action to “Hide weaker matches.” Avoid implying
  an exact weak remainder when the overall response is capped.
- Keep row cards, chapter Open behavior, counts, language metadata, and
  disclosure accessibility unchanged. Project and chapter counts always reflect
  the currently visible leaf set.
- If every returned row except the guaranteed best row is classified weaker,
  render that best result normally rather than presenting a false no-results
  state.

## Calibration and diagnostics

- Add a development-only diagnostic that records, for a supplied query, the
  ordered unique-row scores, adjacent score drops, chosen boundary, quality
  tiers, and exact/fuzzy indicators. Do not expose raw scores in the production
  UI.
- Create a checked-in golden fixture of representative queries and expected
  strong/weaker boundaries. Include cases with a clear degradation point, tied
  scores across the boundary, uniformly good results, uniformly weak results,
  and more results than the fallback ceiling.
- Review the fixture output against the pre-tree relevance order before locking
  the initial constants. Treat later threshold tuning as a scoring change that
  requires updating the fixture expectations intentionally.

## Test plan

- Rust scoring tests: deterministic adaptive boundary; protected top set;
  fallback ceiling; tied-score handling; at least one strong result; aggregation
  before classification; and correct `strongTotal`, `weakerTotal`, `total`, and
  capped semantics.
- Frontend model tests: hidden weak rows do not create projects or chapters;
  project/chapter scores equal the maximum visible child score recursively;
  row order remains `rowOrderKey`; enabling weak rows recalculates counts and
  parent scores; query changes reset the toggle and expansion state.
- Renderer tests: strong-row summary and include action; enabled-state summary
  and hide action; no weak-only branches by default; capped copy does not make
  an unsupported exact claim; disclosures retain valid `aria-controls` targets.
- Regression tests: empty, too-short, searching, error, stale-index, capped, and
  no-results states; chapter Open transfers the raw query; all excerpts for a
  retained row remain visible.
- Verification: targeted Rust project-search tests, targeted frontend state and
  renderer tests, `npm test`, strict Rust Clippy, and browser keyboard checks for
  the new include/hide control and existing tree disclosures.

## Acceptance criteria

- A weak row cannot cause a project or chapter to appear in the default tree.
- Every displayed project and chapter score is the highest relevance score of a
  displayed descendant.
- Users can reveal every weaker row returned by the capped search without a new
  backend query.
- Default counts, hierarchy ordering, and branch presence are derived only from
  strong rows; revealed counts and ordering are recomputed from all visible rows.
- The initial cutoff is justified by checked-in representative fixtures rather
  than an unexplained numeric threshold.

## Assumptions

- “Strong” and “weaker” describe relative retrieval quality for the current
  query; they are not probability estimates.
- The existing candidate cap remains unchanged. This work controls default
  presentation quality, not index recall or the maximum search workload.
- Weak matches remain useful for exhaustive searches, so they are hidden by
  default rather than discarded from the response.

## Implemented calibration

- Classify each excerpt into a semantic match band using the scorer's existing
  exact-phrase, token-coverage, and ordered-token signals. A row inherits its
  best excerpt's band.
- Keep rows in the highest non-empty semantic band strong. For the partial or
  fuzzy bands, detect a score-distribution knee and otherwise keep at most 50
  rows strong, extending the boundary through exact score ties.
- Guarantee only the best row; do not protect an arbitrary top-five set from a
  genuine early quality drop.
- Cap candidate results by unique logical row rather than indexed document and
  retain every matched excerpt belonging to a selected row. Capped UI copy says
  how many rows are shown rather than claiming an unsupported unique-row lower
  bound.
- Golden fixtures contain real query/document inputs that run through text
  normalization, scoring, row aggregation, and classification.
- Set `GNOSIS_PROJECT_SEARCH_DIAGNOSTIC_QUERY` in a debug build to print the
  ordered row scores, adjacent drops, exact-match flags, and assigned tiers for
  that normalized query.

## Real-corpus calibration

Calibrated on 2026-09-02 against a stable snapshot of the active Gnosis VN
index: approximately 108,000 indexed excerpts, 41,000 logical rows, 504
chapters, and 29 projects. The reusable ignored Rust calibration test accepts a
database snapshot and pipe-separated query list through
`GNOSIS_PROJECT_SEARCH_CALIBRATION_DB` and
`GNOSIS_PROJECT_SEARCH_CALIBRATION_QUERIES`.

| Query | Returned rows | Strong | Weaker | Highest band |
|---|---:|---:|---:|---|
| `Drukpa` | 154 | 20 | 134 | Exact phrase |
| `white lodge` | 500 capped | 157 | 343 | Exact phrase |
| `psychological moon` | 500 capped | 36 | 464 | Exact phrase |
| `cuerpo astral` | 500 capped | 435 | 65 | Exact phrase |
| `sabiduría` | 500 capped | 461 | 39 | Exact phrase |
| `đức phật` | 500 capped | 204 | 296 | Exact phrase |
| `trung đạo` | 500 capped | 7 | 493 | Exact phrase |
| `compassion wisdom` | 500 capped | 1 | 499 | Ordered tokens |
| `initiation` | 500 capped | 487 | 13 | Exact phrase |
| `Drukpaa` | 156 | 2 | 154 | Fuzzy |

Inspection confirmed that exact and complete-token rows remain visible while
partial-token tails no longer promote unrelated projects and chapters. The
`Drukpaa` typo case also exposed a pre-existing fuzzy scorer limitation: its two
strong rows contain both the intended `Drukpa` match and a short false positive.
Tightening the hierarchy boundary would hide the intended match, so correcting
that ordering belongs in a separate token-level fuzzy-scoring change.

The row-aware cap lookup was changed to resolve only enough ranked candidates
to select 500 logical rows, then retrieve all excerpts for those rows through a
dedicated row-id index. This avoids scanning and materializing row keys for the
entire candidate population. Browser automation was waived because the user
verified the disclosure and weaker-match controls directly in the app.
