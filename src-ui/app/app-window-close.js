// Destroys the Tauri app window after a close request has already passed any
// application-level guards. Using `close()` here would re-enter the close
// request lifecycle and requires a separate capability that the app does not
// grant; `destroy()` is the authorized terminal operation.
export function destroyCurrentAppWindow(
  tauriWindowApi = globalThis.window?.__TAURI__?.window,
) {
  try {
    const currentWindow = tauriWindowApi?.getCurrentWindow?.();
    if (typeof currentWindow?.destroy !== "function") {
      return false;
    }

    void Promise.resolve(currentWindow.destroy()).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

// Quits the app once the editor close wait is over (changes saved, or Close
// without saving) without closing the window first. On macOS, destroying the
// window at that point could hang AppKit's window close and freeze the app
// with the wait dialog still on screen. The backend command saves the store
// and exits; destroying the window is only the fallback when the command is
// unavailable. See plans/editor-close-wait-direct-exit-plan.md.
export async function exitAppAfterCloseWait({
  tauriCoreApi = globalThis.window?.__TAURI__?.core,
  tauriWindowApi = globalThis.window?.__TAURI__?.window,
} = {}) {
  if (typeof tauriCoreApi?.invoke === "function") {
    try {
      await tauriCoreApi.invoke("exit_app_after_close_wait");
      return true;
    } catch {}
  }

  return destroyCurrentAppWindow(tauriWindowApi);
}
