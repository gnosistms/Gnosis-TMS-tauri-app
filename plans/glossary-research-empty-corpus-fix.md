# Unmatched research spelling

The live ES–EN run for Hooltanpanas saved zero searched source forms, then sent an empty `forms` parameter to `/api/sample`. The site correctly returned HTTP 400. The Spanish author corpus instead uses Hooltampanas. The focused route incorrectly treated a successful empty forms hint as an unavailable hint and fell back to two legacy AI form requests.

1. Distinguish a valid empty hint from unavailable form lookup. Stop unconfirmed forms before AI requests; handle saved empty-form checkpoints the same way. Query the corpus's existing near-forms API for spelling suggestions, without silently substituting an unrelated word.
2. Keep empty population requests local and include safe server error details for rejected requests. Preserve original-source near-form lookup separately from author-corpus suggestions.
3. Add regression coverage for empty hints, saved empty checkpoints, alternatives, empty population requests and descriptive HTTP errors. Verify the actual live API/engine with model and dictionary calls forbidden; confirm the running dev server serves the fixes.

No remote glossary writes, corpus changes, provider calls or credential changes are required.

Completed in the research checkout. A successful empty forms hint is now handled deterministically; both fresh zero-hit runs and saved empty-form checkpoints stop with corpus spelling suggestions. User-supplied alternative spellings still work. Empty population queries do not go to the server, and JSON API rejection messages include the endpoint and explanation.

Verification: 213 research tests pass, including four new regressions; ESLint and `git diff --check` pass. The actual app engine against the live public API stops cleanly for fresh and resumed Hooltanpanas searches, suggesting Hooltampanas, with zero AI/dictionary calls. Hooltampanas produces Hooltanpanas in both ES–VI and ES–EN with two corpus passages and zero AI/dictionary calls. All 22 verification requests returned HTTP 200 and none had an empty `forms` parameter. The running research dev server serves both updated modules. The user's stored failed run was inspected read-only and left intact.
