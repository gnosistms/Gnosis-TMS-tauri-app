# Startup session inspection

Restore a stored GitHub login faster at startup. The broker session inspection
waited for the connectivity probe to finish although the two are independent, and
the probe downloaded the GitHub homepage when it only needs reachability.

1. Add `beginStoredBrokerSessionInspection` to `auth-flow.js`, start it in the
   `main.js` bootstrap as soon as the stored session is prepared, and hand the
   promise to `restoreStoredBrokerSession` through `options.inspection` so the
   restore reuses it instead of inspecting again.
2. Switch the connectivity probe in `lib.rs` from a GET to a HEAD request.
3. Cover the reused inspection and an early inspection failure with unit tests.

Completed all three steps. The restore keeps its existing refresh and sign-out
handling because the early promise is awaited inside the same code path.
