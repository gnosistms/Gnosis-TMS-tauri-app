# Publish step 2a findings before original-spelling verification

## Findings
- Borrowed-origin verification is one provider-native web-search request. The
  backend collects the whole response before returning cited findings; it does
  not expose live per-search or per-page progress.
- The original-spelling request currently blocks corpus checks, despite its
  position at the end of the checklist.
- Forms already have incremental checkpoints, but lexical explanations are not
  attached to existing rows until all accepted alternatives finish checking.

## Plan
1. Order real work and its checklist consistently: propose forms, check corpus
   evidence, check any borrowed original spelling, review lexical identity,
   verify accepted alternatives. Preserve the existing requests and cache reuse.
2. Publish the proposed origin/spelling, per-form corpus counts and lexical
   explanations at their completion checkpoints. Show cited original-spelling
   evidence when available and an honest waiting status while its request runs.
3. Verify a held original-spelling request still leaves earlier findings visible;
   check ordinary vocabulary, retries, checkpoints and final results with the
   existing stage, rendering and browser tests.

## Completed
- Corpus checks finish and publish counts before the original-spelling request.
  Forms and findings appear above the work checklist in step 2a.
- Original-spelling work shows the actual proposal, cited-source request and
  received findings, without inventing provider-internal search progress or
  adding model calls. Ordinary vocabulary explicitly needs no origin lookup.
- Cited findings are published before identity review; identity explanations are
  checkpointed before remaining accepted-alternative checks. Results persist on
  reopening and historical requests retain their existing cache identities.

## Validation
- 85 stage/activity/rendering unit tests passed, including held web evidence and
  identity explanations published before the last corpus check.
- Five browser checks passed, covering held original spelling, persisted counts,
  source links, reopening without another web call, live forms, pause/resume and
  source-spelling review.
- Frontend build, targeted ESLint and whitespace checks passed.

## Follow-up: include original spelling in saved checklists
1. Merge the current five-item forms checklist with older saved progress for
   display, preserving every saved result and keeping the real work order.
2. Recover an omitted origin item's result only from recorded origin data;
   otherwise show it waiting. Do not rewrite studies or start research.
3. Verify fresh and legacy checklists, including before Run is clicked.

Completed: saved forms checklists are merged with the five-item plan for display,
with original spelling in the third position. Saved progress and findings are
preserved without writes or requests. All 39 activity/rendering tests and two
browser checks passed; ESLint and whitespace checks passed.

## Follow-up: show original-spelling details only in the work list
1. Remove the separate Original spelling card and its unused rendering helper.
2. Keep proposal, progress and findings in their work items, with cited source
   links under Verify original spelling. Remove text referring to the old card.
3. Update the held-search/reopening browser check and run relevant validation.

Completed: removed the duplicate card. Original-spelling proposal, progress and
findings remain in the work list, with source links in a disclosure under the
origin item that preserves its open state through progress renders. All 87
focused unit tests and two browser checks passed, including source links after
reopening. ESLint and whitespace checks passed.

## Follow-up: separate setup, progress and review
1. In step 2a, show the entered forms before research starts and hide the work
   checklist until Run. Waiting-only saved plans do not count as started work.
2. While work is running, paused or awaiting retry, hide source-form inputs and
   show progress/findings in the work list. Restore editable forms for review
   once the complete result is available.
3. Verify all transitions, incremental findings, original-spelling evidence and
   pause/resume, without changing the saved research or requests.

Completed: step 2a shows entered forms before Run and the work list after Run;
form controls stay hidden during active, paused and interrupted research. They
return when complete results are ready for review. Waiting-only saved plans no
longer count as started research. All 41 focused unit tests and seven browser
flows passed, including incremental counts, cited findings, scope edits, legacy
plans, pause/resume and the completed Spanish forms review. ESLint and whitespace
checks passed.

## Follow-up: plain terms before Run
1. Replace disabled form fields and checkboxes in the pre-run view with a simple
   text list. Step 1 remains the place to edit the entered terms.
2. Retain active selection/editing only for completed research results, where
   users can review AI suggestions and corpus-based inclusion decisions.
3. Update existing phase/rendering and browser checks for the text-only preview.

Completed: before Run, terms appear in a simple list without disabled controls or
unperformed corpus-check notices. Completed research retains active review
controls for accepting/rejecting suggested forms. All 34 rendering tests and
three browser flows passed; ESLint and whitespace checks passed.

## Follow-up: summarize completed corpus checks
1. Preserve the exact per-form paragraph counts when the corpus-check phase
   completes, before later lexical decisions can filter the form list.
2. Show the number of attested forms, the selected corpus and every matching
   form/count under the completed work item. Label counts as matching paragraphs.
3. Collapse the detailed per-form/tool tree after completion, retaining a way to
   inspect it. Verify both corpus choices, zero matches and live transitions.

Completed: the completed corpus check lists every confirmed form and its matching
paragraph count, naming the selected corpus. Detailed checks collapse under
“Check details”; original-spelling progress remains visible. Counts are preserved
before later form filtering, with a fallback for older studies. All 83 focused
unit tests and four browser flows passed; ESLint and whitespace checks passed.

## Follow-up: recommendation placement and wording
1. Place the step 2a recommendation below the entered forms and Run/Skip guidance.
2. Display recommendations as “Run it.” or “Skip it.” while retaining existing
   decision values and collapsed reasoning.
3. Update existing rendering/browser expectations and run focused checks.

Completed: step 2a places the recommendation after the entered terms and guidance.
Recommendations read “Run it.” or “Skip it.” with reasoning still collapsed.
All 35 rendering tests and the focused browser flow passed, including visual
element ordering; ESLint and whitespace checks passed.

## Follow-up: readable research findings
1. Format research-result Markdown safely using escaped text, semantic paragraphs,
   headings, lists, quotations and checked source links; keep the app typography.
2. Use a clean text preview for long findings and formatted full text when opened.
   Read original-spelling findings from saved web evidence, avoiding the shorter
   activity receipt. Preserve saved data and disclosure state.
3. Verify formatting and unsafe-input handling, then check collapsed/expanded
   results in the browser.

Completed: work results render escaped Markdown as paragraphs, compact headings,
lists, quotations, tables, code and safe web links using the app theme. Long
results show a plain preview without Markdown markers, with formatted text in
the disclosure. Original-spelling findings use the complete saved search summary
rather than the clipped activity receipt, without rerunning research. All 40
focused unit tests and three browser flows passed; screenshots of collapsed and
expanded findings were inspected. ESLint and whitespace checks passed.

## Follow-up: name accepted forms
1. Include accepted form names in the lexical-identity completion message.
2. Show names for older saved messages when the recorded accepted-form checklist
   supplies the complete list, without modifying evidence or rerunning research.
3. Check stage and saved-activity behavior.

Completed: the identity completion message includes the accepted forms, with
singular/plural wording. Existing saved messages use their recorded accepted-form
checklist when its count matches. All 54 activity/stage tests passed; ESLint and
whitespace checks passed.

## Follow-up: completed forms review at the bottom
1. Render the completed step 2a review after the work checklist while keeping the
   pre-run entered forms above the recommendation.
2. Scroll the research content down to the review only when it first appears in
   the current step; preserve subsequent user scroll and disclosure choices.
3. Verify ordering, completion scrolling and later progress/edit renders in the
   browser, including a narrow window.

Completed: finished forms review appears below the work checklist. Its first
appearance scrolls only the research content region to the review introduction;
later renders preserve the user's scroll and open disclosures. All 35 rendering
tests and four browser checks passed, covering completion at 1280px and 700px and
ordinary progress scroll preservation. Both layouts were inspected in screenshots.
The shared footer check now respects the app's responsive gap. ESLint and
whitespace checks passed.

## Follow-up: hide internal corpus locators
1. Remove relative `/doc/...` locators from displayed narrative and work results,
   including collapsed previews, while retaining useful link labels and public
   source URLs.
2. Keep original AI replies, study evidence, cache and export/log data unchanged.
3. Check parenthesized, bare and Markdown citations and completed forms review.

Completed: displayed narrative and work reports omit relative corpus document/
line locators, including form explanations, recommendation reasoning, source
assessments and collapsed/expanded findings. Human-readable link labels and
public source URLs remain. Original replies and evidence are untouched. All 42
focused unit tests and two browser flows passed, checking both clean display and
retained original locators. ESLint and whitespace checks passed.
