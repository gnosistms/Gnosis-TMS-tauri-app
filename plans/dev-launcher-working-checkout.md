# Launch the working development checkout

The personal Applications launcher opens `scripts/launch-dev.command`, which runs the session supervisor. The supervisor currently enables automatic version metadata repair. A checkout containing ongoing feature work but not every later release change then stops before starting Tauri.

1. Configure this personal development session to use the existing documented older-version development option, retaining its actual version label and consistency checks. Disable automatic metadata repair for this launch path. Leave release/build guards unchanged.
2. Verify the launcher environment against the actual version guard with a temporary older-version Git fixture, and retain the existing process-group cleanup tests.
3. Confirm port 1431 is free and the native build is ready. Let Hans launch from Applications; do not leave a competing session running.

Completed: the personal session now explicitly uses `GNOSIS_ALLOW_STALE_DEV_VERSION=1` and disables automatic version relabeling. The actual version guard remains in the startup chain and still rejects inconsistent metadata. Eleven focused guard/launcher checks pass, including unchanged version files and cleanup after normal exit, failure, SIGINT, and SIGHUP. The native development build completed successfully. The verification app/session was stopped at Hans's request, and port 1431 is free for launching from Applications.
