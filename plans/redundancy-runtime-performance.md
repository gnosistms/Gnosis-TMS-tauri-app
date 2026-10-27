# Fix the real-book redundancy stall

PR #384 follow-up. Diagnose and correct the native path on the affected local
book; mocked browser completions did not expose the real workload.

## Evidence and agreed procedure

The local project has 2,171 stored rows; its active Vietnamese text contains 453
footnotes and 98 chapter-image occurrences. A native stack sample showed full
remote-image decoding/pixel hashing before the first result. The old footnote
candidate function took ~83 seconds on the real corpus, generating whole-book
fragments and repeatedly comparing body pairs.

The user confirmed that identical URLs are identical images and that footnote
candidates must follow reversed punctuation-stripped context order: compare each
note only with its next neighbor, chaining matches for AI splitting. At most
N-1 context comparisons are required. No all-pairs body index or whole-book
fragment index belongs in this procedure.

## Implementation

- Images compare URLs locally without fetching/decoding them. Uploaded/book
  assets compare cached hashes of their encoded bytes, with path and file-revision
  validation. Thumbnails load independently in the browser. Verified aliases
  retain existing inclusion choices after migrating legacy pixel identities.
- Punctuation-stripped contexts are reversed and sorted; only adjacent contexts
  are compared. Whole-word frequencies prune common endings and incomplete word
  matches. Exact/edit-distance hints are confined to candidate neighbors; AI
  splits their chains and cannot combine distinct candidate chains.
- Word counts persist separately in the account/project/language cache. A digest
  of the counted text invalidates them after edits or chapter-selection changes;
  chapter reordering reuses them. A corrupt count cache is recomputed safely.
- The footnotes section shows "Computing word frequency counts..." during count
  creation, then "Comparing footnote meanings..." during AI adjudication, each
  with the shared spinner. Images and editable image choices remain mounted.
- Unknown semantic evidence is sent in bounded batches, at most four concurrent.
  Cache merges retain existing verdicts. Provider calls do not hold the scope
  mutex, so cancelled/slow older requests cannot block a newer local check.
  Cancelled requests cannot persist final snapshots; unexpected worker failures
  emit a terminal error rather than leaving an endless spinner.

## Verification and dev integration

All 3,124 frontend unit/screen tests, 25 workflow tests, 964 native tests, and all
37 export browser workflows passed. Fourteen existing/opt-in native checks were
ignored; the new opt-in corpus timing check was also run explicitly. Strict
all-target Clippy, formatting, changed-module ESLint, build and whitespace checks
passed. The unused-file audit retains the existing 41-file baseline.

The aggregate-only opt-in corpus run used real local source without AI calls or
source mutations: local inventory ~0.70 s, initial counts ~0.44 s, cached counts
~0.06 s, and reversed-context normalization/sorting/neighbor comparisons ~0.12 s.
The first AI pass remains a separate network/model operation; subsequent unchanged
reviews reuse completed evidence and snapshots.

Only the nine related source/test files were copied into the dev checkout after
backing up originals; unrelated local work was preserved. The dev backend rebuilt
successfully. Actual live dev jobs then reported image inventories in ~1.0-1.2 s
and 452 neighbor comparisons, including context preparation, in ~0.105 s. The real
review completed with five image groups, eleven footnote groups, and no unresolved
warnings. The native cache confirmed the word counts were reused; the first live
AI meaning pass completed in approximately 26 seconds using the app's existing
stored team credential path.
