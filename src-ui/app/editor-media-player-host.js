// The audio and video players live beside #app, not inside it. A full render
// rebuilds everything in #app (background sync, status updates…), which would
// restart playback; here the player is redrawn only when its own HTML changes,
// as the research windows are (see research-modal-host.js).

import { app, openExternalUrl } from "./runtime.js";
import { captureModalRenderState, reconcileModalRenderState } from "./events/modal-dialog.js";
import { editorMediaPlayerOverlay, renderEditorMediaPlayer } from "../screens/editor-media-player.js";

const SKIP_SECONDS = 10;
const PLAYBACK_RATES = [1, 1.25, 1.5, 2];

let host = null;
let lastHtml = "";
let lastOpener = null;

export function formatEditorMediaTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "--:--";
  }
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = String(whole % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

function playerAudio(root = host) {
  return root?.querySelector("[data-media-player-audio]") ?? null;
}

function syncAudioPlayer(root = host) {
  const audio = playerAudio(root);
  if (!(audio instanceof HTMLMediaElement)) {
    return;
  }
  const duration = Number.isFinite(audio.duration) ? audio.duration : NaN;
  const seek = root.querySelector("[data-media-player-seek]");
  if (seek instanceof HTMLInputElement) {
    seek.max = Number.isFinite(duration) ? String(duration) : "0";
    if (!seek.matches(":active")) {
      seek.value = String(audio.currentTime);
    }
    const progress = Number.isFinite(duration) && duration > 0 ? (audio.currentTime / duration) * 100 : 0;
    seek.style.setProperty("--editor-media-player-progress", `${progress}%`);
  }
  const elapsed = root.querySelector("[data-media-player-elapsed]");
  if (elapsed) {
    elapsed.textContent = formatEditorMediaTime(audio.currentTime);
  }
  const total = root.querySelector("[data-media-player-duration]");
  if (total) {
    total.textContent = formatEditorMediaTime(duration);
  }
  const toggle = root.querySelector('[data-media-player-control="toggle"]');
  if (toggle) {
    const playing = !audio.paused && !audio.ended;
    toggle.classList.toggle("is-playing", playing);
    toggle.setAttribute("aria-label", playing ? "Pause" : "Play");
  }
  const speed = root.querySelector('[data-media-player-control="speed"]');
  if (speed) {
    speed.textContent = `${audio.playbackRate}×`;
  }
}

function showAudioError(root = host) {
  root?.querySelector("[data-media-player-error]")?.removeAttribute("hidden");
  root?.querySelector(".editor-media-player__card")?.classList.add("has-error");
}

function playAudio(audio) {
  const attempt = audio.play();
  if (attempt && typeof attempt.catch === "function") {
    // Autoplay may be refused; the play button still works.
    attempt.catch(() => syncAudioPlayer());
  }
}

function attachAudioPlayer(root) {
  const audio = playerAudio(root);
  if (!(audio instanceof HTMLMediaElement)) {
    return;
  }
  for (const eventName of ["loadedmetadata", "durationchange", "timeupdate", "play", "pause", "ended", "ratechange"]) {
    audio.addEventListener(eventName, () => syncAudioPlayer(root));
  }
  audio.addEventListener("error", () => showAudioError(root));
  playAudio(audio);
}

function handleControl(control) {
  const audio = playerAudio();
  if (!(audio instanceof HTMLMediaElement)) {
    return;
  }
  const duration = Number.isFinite(audio.duration) ? audio.duration : Infinity;
  switch (control) {
    case "toggle":
      if (audio.paused || audio.ended) {
        playAudio(audio);
      } else {
        audio.pause();
      }
      break;
    case "back":
      audio.currentTime = Math.max(0, audio.currentTime - SKIP_SECONDS);
      break;
    case "forward":
      audio.currentTime = Math.min(duration, audio.currentTime + SKIP_SECONDS);
      break;
    case "speed": {
      const index = PLAYBACK_RATES.indexOf(audio.playbackRate);
      audio.playbackRate = PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length];
      break;
    }
    default:
      return;
  }
  syncAudioPlayer();
}

function ensureHost() {
  if (host) {
    return host;
  }
  host = document.createElement("div");
  host.id = "editor-media-player-host";
  // The document click handler ignores clicks inside data-stop-row-action, so
  // the player's own controls are handled here.
  host.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest("[data-media-player-control]");
    if (control instanceof HTMLElement) {
      handleControl(control.dataset.mediaPlayerControl);
      return;
    }
    const external = target?.closest("[data-media-player-open-external]");
    if (external instanceof HTMLElement) {
      openExternalUrl(external.dataset.mediaPlayerOpenExternal);
    }
  });
  host.addEventListener("input", (event) => {
    const seek = event.target instanceof HTMLInputElement && event.target.matches("[data-media-player-seek]")
      ? event.target
      : null;
    const audio = playerAudio();
    if (seek && audio instanceof HTMLMediaElement) {
      audio.currentTime = Number(seek.value) || 0;
      syncAudioPlayer();
    }
  });
  (app ?? document.body).after(host);
  return host;
}

/** True while an audio or video player is on screen. */
export function editorMediaPlayerOpen() {
  return Boolean(host?.querySelector("[data-editor-media-player]"));
}

function restoreOpenerFocus(opener) {
  if (!opener?.rowId || !opener?.languageCode) {
    return;
  }
  const tile = Array.from(document.querySelectorAll('[data-action="open-editor-image-preview"]'))
    .find((element) => element.dataset.rowId === opener.rowId && element.dataset.languageCode === opener.languageCode);
  tile?.focus?.({ preventScroll: true });
}

/** Redraw the player if, and only if, its HTML changed. */
export function renderEditorMediaPlayerHost(state) {
  const html = renderEditorMediaPlayer(state);
  if (html === lastHtml) {
    return false;
  }
  const root = ensureHost();
  const snapshot = captureModalRenderState(root);
  for (const media of root.querySelectorAll("audio, video")) {
    media.pause();
  }
  root.innerHTML = html;
  lastHtml = html;
  reconcileModalRenderState(root, snapshot);
  const overlay = editorMediaPlayerOverlay(state);
  if (overlay) {
    lastOpener = { rowId: overlay.rowId, languageCode: overlay.languageCode };
    attachAudioPlayer(root);
  } else {
    const opener = lastOpener;
    lastOpener = null;
    restoreOpenerFocus(opener);
  }
  return true;
}
