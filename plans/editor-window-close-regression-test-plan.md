# Editor Window Close Regression Test

## Goal

Prevent the guarded editor close flow from calling Tauri's unauthorized
`window.close()` API again after a close request has already been approved.

## Steps

1. Extract the authorized app-window destruction call into a small frontend helper.
2. Use the helper from the editor close-wait path in `main.js`.
3. Add a unit test proving the helper calls `destroy()` and never calls `close()`.
4. Run the focused test, close-flow tests, and the frontend production build.
