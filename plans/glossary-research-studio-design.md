# Research studio visual cleanup

## Scope
Refine the existing research studio to match the app's warm palette and shared
controls. Preserve research behavior and existing work in other files.

## Plan
1. Reuse the page shell, back navigation, buttons, fields, and select styling.
2. Put each step in a restrained surface with an independently scrolling content
   area and visible actions; compact the outline and use real theme tokens.
3. Remove duplicate language metadata and move timing details below the work.
4. Run existing studio rendering and browser checks, inspect desktop and narrow
   layouts, and build the frontend.

## Completed
- Shared back navigation, form controls, theme colors, and button treatments.
- Compact header and outline; scrollable step content within a quiet surface,
  with actions always visible below it. Horizontal outline in narrow windows.
- Language pair appears once; timing details follow the research content.
- Progress renders preserve content and outline positions. Step navigation resets
  content and reveals the current outline item.

## Validation
- 3,058 frontend unit tests passed; 25 workflow tests passed (launcher tests need
  local port access outside the filesystem sandbox).
- All 58 existing studio browser tests passed in installed Chrome, plus the new
  regression check for scrolling, visible actions, and step navigation.
- Inspected rendered previews at 1440×900, 640×700, and 390×700.
- Frontend build, targeted ESLint, and diff whitespace checks passed.
- Unused-code audit reports unrelated existing files, imports, and exports; none
  of the changed studio modules appears in its findings.

## Follow-up: show only actionable progression
1. Hide Save and continue when research still needs to run and continuation is
   unavailable; restore it for review once results are ready.
2. Update existing checks for the formerly disabled button to expect its absence.
3. Verify rendering and the forms-research browser workflow, including refresh.

Completed: 33 rendering tests and four focused browser checks passed, including
the complete research workflow and legacy forms refresh. ESLint and whitespace
checks passed.

## Follow-up: export availability
1. Show Export research from step 4.2 onward using the workflow's step order.
2. Update rendering coverage and existing export browser fixtures for that boundary.
3. Verify export, cancellation and errors at an eligible step.

Completed: 33 rendering tests verify the visibility boundary across all steps;
five focused browser checks cover export, cancellation, errors, timings and
comparison exports. ESLint and whitespace checks passed.

## Follow-up: use the outline for previous-step navigation
1. Remove the footer Back button from every study step, retaining the step outline
   and the header link to the glossary.
2. Update existing browser workflows to use outline navigation; history checks
   return through Glossary → Research. Update the tooltip's obsolete Back comment.
3. Verify rendering, previous-step reuse, history and complete workflows.

Completed: no footer Back action is rendered on any step. All 33 rendering tests
and seven browser workflows passed, covering outline navigation, cached results,
pause/resume, history, deletion and full research. ESLint and whitespace checks passed.

## Follow-up: keep timings as saved diagnostics
1. Remove the timing accordion and per-operation durations from the studio UI.
2. Keep timing recording, study persistence and JSON exports intact. Preserve
   existing comparison actions in their own disclosure, without timing details.
3. Update rendering and browser coverage to verify timings stay hidden while
   surviving saves, reopening and export; verify comparison actions still work.

Completed: timings no longer appear on any studio step or work item. Recording
and storage are unchanged; full records remain under `timing` in exported JSON.
Comparison controls have their own disclosure. All 54 focused unit tests and four
browser checks passed, including save/reopen/export and three comparison flows.
Frontend build, targeted ESLint and whitespace checks passed.

## Follow-up: forms-step action placement
1. Keep the existing footer without Back; identify its current step for styling.
2. Align Skip this step and Run this step together at the right in step 2a.
3. Check actual browser positions and existing rendering coverage.

Completed: step 2a places Skip directly before Run at the right; Back remains
absent. All 33 rendering tests and two focused browser flows passed, including
actual button alignment, adjacency and distance from the footer's right edge.
ESLint and whitespace checks passed.

## Follow-up: remove redundant recommendation guidance
1. Remove the shared run/skip guidance sentence from every recommendation card.
2. Remove its unused CSS selector and update the existing rendering expectation.
3. Run studio rendering tests and whitespace checks.

Completed: removed the sentence from the shared recommendation renderer and
removed its unused selector. All 33 rendering tests, ESLint and whitespace checks passed.

## Follow-up: remove comparison reruns
1. Remove the Research comparison disclosure, rerun action and unused styles
   across all steps. Keep normal editing, retries and saved evidence intact.
2. Retire the comparison-only action handler so stale UI cannot trigger it.
3. Update existing rendering and browser checks for completed forms, assignments
   and translation tests, verifying normal progress and exports still work.

Completed: removed the shared Research comparison section, its styles and the
comparison-only action handler. Saved evidence and normal edit/redo behavior are
preserved. All 47 focused unit tests and five browser checks passed, covering
forms/export, assignments, translation trials and edit confirmations. ESLint and
whitespace checks passed.

## Follow-up: collapse recommendation explanations
1. Put the existing explanation behind a closed Show reasoning disclosure on
   every recommendation card, using the shared link style.
2. Keep recommendation status and available actions visible. Preserve disclosure
   state through ordinary rerenders with the existing studio helper.
3. Verify hidden-by-default text, expansion/collapse and unchanged Run/Skip flows.

Completed: all recommendation explanations are collapsed behind Show reasoning,
using a native disclosure and the shared text-link style. All 33 rendering tests
and four browser checks passed, covering Run, Skip, refresh/failure explanations,
keyboard collapse and live research. ESLint and whitespace checks passed.

## Follow-up: automatic forms recommendations
1. Remove manual recommendation actions from step 2a. Reuse saved advice on
   unchanged inputs and automatically obtain missing/stale advice on entry.
2. Include all step 1 terms/forms in cache identity, including values beyond the
   compact AI preview. Keep advice hidden after research starts, but allow it
   again when step 1 edits reset the forms research.
3. Verify navigation/reopening reuse, automatic updates after scope edits and
   provider failure without disturbing recommendation controls in other steps.

Completed: step 2a has no manual recommendation button. Entering it reuses cached
advice or requests advice for changed scope inputs, including sidebar navigation
and reopening. Complete terms/forms invalidate both recommendation and tool
caches even outside the bounded AI preview. Reset research can show fresh advice
without discarding historical timings. All 40 focused unit tests and six browser
checks passed; ESLint and whitespace checks passed.
