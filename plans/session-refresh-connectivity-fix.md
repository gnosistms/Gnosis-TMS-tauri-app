# Preserve login during session-refresh connection failures

1. Add regression coverage for explicit-token and native actions through invoke and
   sync recovery, including connection failures, timeouts and rejected credentials.
2. Propagate a failed refresh's connectivity error instead of the original auth
   error, retaining the existing cancellation and persistence guards.
3. Run focused runtime, connectivity and action recovery tests and lint the changes.

Status: complete.

The invoke boundary now propagates connectivity failures from session refresh.
Regression tests cover both native and explicit-token actions through sync recovery:
connection failures and timeouts retain the login and current screen and open the
connection dialog; rejected credentials still require sign-in. Failed refreshes
neither persist a session nor replay the original action.

Verification: the five regression cases failed before the fix. After the fix,
all 253 focused runtime, connectivity, sync recovery and editor action tests pass.
Focused ESLint and whitespace checks pass.
