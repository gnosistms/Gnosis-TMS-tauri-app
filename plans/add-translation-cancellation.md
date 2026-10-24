# Cancel alignment from the progress modal

1. Add a bottom Cancel action to the processing dialog, including shared Escape
   behavior and a pending-cancellation state.
2. Give preflight/apply attempts a client request ID. Add a backend cancellation
   token per attempt, check it before/after provider work and between stages,
   and propagate it into split workers. In-flight blocking HTTP may finish, but
   canceled work must not start another request or reach application.
3. Treat entry into local application as an atomic non-cancelable boundary;
   retain the dialog when cancellation is too late. Ignore stale async success,
   errors and progress after cancellation or opening a different operation.
4. Test token lifecycle/concurrency, UI cancellation, and late-response races;
   run focused frontend/backend checks and appropriate broader verification.

Subtitle timing evaluation remains a separate ongoing task; no live AI tests or
credential changes are needed for this cancellation work.

## Verification

Implemented the footer action, per-attempt cancellation with a save boundary,
split-worker propagation, progress request IDs, stale-response handling, and
expected-control-flow telemetry handling. Token lifecycle, cancel-before-start,
late responses/errors, rejected cancellation, worker cancellation, and subtitle
cancellation regressions pass. The shared save boundary prevents partial local
writes; an in-flight blocking HTTP request can finish after cancellation.
