# Team AI invalid-key recovery

## Goal

When an AI provider rejects a cached team key, refresh the selected team's AI
metadata and issued provider key before showing the authentication failure.

## Implementation

1. Detect normalized provider-key rejection errors at the shared Tauri command
   boundary for AI commands that consume provider credentials.
2. Force-refresh the selected team's AI metadata, bypass the matching local key
   cache, and issue the current team key. Deduplicate concurrent refreshes per
   team/provider.
3. Retry the failed AI command exactly once. Surface the retry failure (or the
   original authentication failure when no team key could be refreshed).
4. Add focused tests for detection, successful recovery, one-retry behavior, and
   concurrent refresh deduplication.

## Verification

- Run the focused frontend tests covering runtime and team AI behavior.
- Run JavaScript lint on the changed modules.
