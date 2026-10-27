# Refresh expired sessions for image edits

1. Verify image writes authenticate before commit and roll back rejected writes.
   Include URL, upload, remove and duplicate operations in the native-session
   recovery path, without changing their payloads or permissions.
2. Add regressions for tokenless image deletion/edits, a single refresh and retry,
   unchanged identity/team guards, and failures that must not be replayed. Reject
   retries when an authentication error also reports an unsuccessful rollback.
3. Run native image rollback tests and frontend runtime/image tests; review scope.

Status: complete.

The missing native-command allowlist entries prevented tokenless image commands
from using the existing session recovery. Added the four image write commands and
kept recovery bounded to one attempt with existing identity/team guards. A native
rollback failure suppresses automatic replay even when prefixed AUTH_REQUIRED.

Verification: 82 focused frontend runtime/image/telemetry-boundary tests and all 39
native image tests pass. The deletion flow test uses the reported image URL and
expired-session error, verifies session persistence before replay, and confirms the
image removal completes. Focused ESLint and whitespace checks pass.
