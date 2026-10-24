# Require SRT uploads for subtitle chapters

1. Identify SRT chapters when opening Add translations and show only SRT upload.
2. Restrict native/browser file selection and drops to .srt; block paste/link
   handlers while retaining backend strict SRT validation and the preflight guard.
3. Verify subtitle-only UI, picker filters, early input rejection, and unchanged
   document input behavior with focused frontend tests and lint.

Implemented: SRT chapters show only file upload, with SRT-only picker filters.
Other file types are rejected before reading/extraction; paste/link handlers and
the existing preflight guard refuse non-file input. Strict native SRT validation
remains in place. Regular chapters keep their existing input options.

Validation: 76 focused frontend tests passed, including shared import rendering.
Scoped ESLint passed with one existing unused-import warning in state.js;
git diff --check passed.
