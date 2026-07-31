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
