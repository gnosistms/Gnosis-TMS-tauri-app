# Independent redundancy check progress

Target: PR #384. Requested title: "Redundancy checks". Subtitle: "Check for
redundant images and footnotes." Remove the generic combined checking message.

Root causes: the frontend waits for all repository work (including the settings
sync started by Next) and AI preference loading before starting native detection.
The native worker publishes no image result until all footnote AI calls finish,
and its per-book mutex spans those AI calls, delaying images on repeated entries.

Implementation:
1. Let the queue idle helper optionally select operation types. Redundancy waits
   only for pending local editor writes, not settings/Git/network operations.
   Resolve the saved Review model synchronously from local preferences.
2. Publish an images-complete checkpoint before footnote candidate/AI work and
   before acquiring the long-lived semantic-cache lock. Reload/merge evidence at
   that lock so cancelled/older workers cannot overwrite newer cached evidence.
   Keep image warnings, source revisions, cancellation and account fences intact.
3. Track images and footnotes separately in the flow and UI. Each section shows
   its requested checking message plus the shared spinner, then its own results
   or exact clean empty message. Image inclusion choices work while notes run.
   Fatal note errors preserve already validated image results; errors must never
   become a false clean empty result.
4. Add queue, native checkpoint, UI/flow and browser regressions with held AI work
   and held settings sync. Verify copy, spinner replacement, independent results,
   early choices, cached behavior, retries, and navigation preservation.
5. Run focused/full relevant suites, build/lint/Clippy, push to PR #384, and integrate
   the verified change into the running dev checkout without replacing unrelated
   local work; rebuild the native dev backend so the user can test the fix.


Verification: 3,120 frontend unit/screen tests, 25 workflow tests, 958 native
checks (13 existing opt-in checks ignored), and all 35 project-export Chrome
workflows passed. Held settings sync and held footnote completion demonstrate
independent image publication, early choice persistence, and retained checkbox
nodes/focus. Production build, ESLint (no errors), formatting, strict all-target
Clippy, and whitespace checks passed. The unused-file audit retains its existing
41-file baseline. The independent progress screen was visually inspected.

Dev integration: backed up and updated only the 14 redundancy-related source/test
files that matched the previous feature or reviewed baseline. Unrelated local
edits were preserved. The backend rebuilt successfully; the stopped dev launcher
and Vite server were relaunched to serve the updated working checkout.
