export const app = document.querySelector("#app");

const tauri = window.__TAURI__ ?? {};

export const invoke = tauri.core?.invoke?.bind(tauri.core);
export const listen = tauri.event?.listen?.bind(tauri.event);

export function openExternalUrl(url) {
  const opener = window.__TAURI__?.opener;
  if (opener?.openUrl) {
    opener.openUrl(url);
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

export function waitForNextPaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}
