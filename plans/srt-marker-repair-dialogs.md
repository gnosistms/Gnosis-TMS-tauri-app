# Repair subtitle separators and report the result

1. Add a pure save-time separator scanner. Close an opening bracket after its
   following number; add an opening bracket before a closing bracket's preceding
   number. Delete unmatched brackets with no adjacent number, retaining ordinary
   text. Normalize safe numeric spelling and validate the expected identities,
   uniqueness, order, count, and absence of stray delimiters. Preserve original
   literal marker content and the session's collision-avoidance prefix.
2. Apply repairs to the draft, never partially to canonical cue rows. Show the
   user's exact success/failure text in an accessible shared-controller modal
   with an Ok button. If invalid and no usable expected marker remains, append
   the first expected marker so brackets can be copied. Defer during composition
   and avoid duplicate dialogs from simultaneous blur/save requests.
3. Restore fully missing markers using the earlier rule (text stays in the
   earliest fragment; later fragments become blank). Present this as an unsaved
   proposal. Ok only dismisses the modal; keep the draft open and require an
   explicit Save sentence draft after review. Do not change live input/undo.
4. Cover bracket repairs, numeric validation, duplicates/order/count, blank cues,
   literal content, repeated saves, both modal outcomes, sample-marker insertion,
   acknowledgment/focus, and navigation/save gating with unit/browser regressions.

Status: implemented. All 38 SRT browser regressions passed, including exact modal
copy, keyboard dismissal/focus, explicit-save gating, repeated flushes, missing
markers/blank cues, invalid markers/sample insertion, and IME deferral. The full
frontend suite and launcher workflow tests passed; unused-code audit counts are
unchanged. Native Windows/macOS interaction has not been exercised in this run.
