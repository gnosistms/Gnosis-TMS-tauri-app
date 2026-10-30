# Take the AI's Run or Skip recommendation after 10 seconds

## Problem

Before an optional research step (2a, 4.1, 4.3, 4.4.1, 4.4.2, 4.4.3, 5), the
studio asks the AI whether to Run or Skip it, then waits indefinitely for the
translator to click one of the two. Most of the time the translator just takes
the recommendation, so research stalls whenever nobody is watching.

## Change

1. When a current AI recommendation is waiting on the translator, show a
   countdown in the recommendation panel ("Running this step in 10 seconds
   unless you choose.") with a bar that drains. After 10 seconds, take the
   recommendation exactly as if its button had been clicked. Skipping 4.4.3
   still opens its confirmation, since that skip discards the whole
   source-research branch.
2. The countdown only runs on the research frontier: not while the AI is still
   thinking, while research runs or saves, while a dialog or error is showing,
   while a question is pending, or while revisiting a step from the outline.
   It does not run for the fallback "Run" given when the AI could not answer.
3. Opening "Show reasoning" holds the countdown so the translator can read;
   closing it resumes from where it stopped. A state change that is not the
   translator's action (a save, an error) restarts it from 10 when the
   recommendation is back.
4. Once the translator takes any studio action (Run, Skip, or another such as
   leaving the studio or opening a step from the outline), or the timer acts,
   that recommendation is answered: it never counts down again (for example
   after cancelling the 4.4.3 skip confirmation, or the redo confirmation).
   This also keeps the timer from overtaking a slow action such as leaving
   the studio. Refreshing the recommendation starts a new countdown.

## Design

- `glossary-research-studio-auto-choice.js` owns the countdown: a pure target
  predicate, a state step (`advanceStudioAutoChoice`) driven by an injected
  clock, and a 250 ms ticker that runs while the studio screen is open. The
  ticker updates the countdown text in place, so no full render per second.
- Countdown state is view-only (`studioView().autoChoice`,
  `studioView().autoChoiceAnswered`); nothing is saved with the study.
- The flow starts the ticker when the studio opens, marks a recommendation
  answered on Run or Skip, and acts through `studioAction`.

## Tests

- Unit: target rules, countdown, hold, restart, answered, firing once.
- Screen: countdown shown only for an eligible, unanswered recommendation.
- Browser: an unanswered Skip recommendation skips the step after the timer.
