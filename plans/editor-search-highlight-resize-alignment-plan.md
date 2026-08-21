# Editor Search Highlight Resize Alignment

## Problem

An active editor textarea and its search-highlight overlay can diverge after a
window resize. The non-virtualized editor resize path does not recompute textarea
height, and the overlay's content box is two pixels wider because it lacks the
textarea's transparent border.

## Plan

1. Re-run mounted editor textarea autosizing in the non-virtualized resize path.
2. Give highlight layers the same transparent border geometry as editor textareas.
3. Cover a focused, searched, multi-line row across a viewport resize in the browser
   regression suite and verify matching size and scroll geometry.

## Verification

- Run the focused browser regression against installed Chrome.
- Run relevant unit tests and the complete frontend test suite.
