import { escapeHtml } from "../lib/ui.js";
import { renderSanitizedInlineMarkupHtml } from "../app/editor-inline-markup.js";
import { editorVideoEmbedUrl } from "../app/editor-media-kind.js";
import {
  closeIconSvg,
  externalLinkIconSvg,
  fileAudioIconSvg,
  pauseIconSvg,
  playIconSvg,
  skipBackIconSvg,
  skipForwardIconSvg,
} from "../app/editor-media-icons.js";

const VIDEO_PROVIDER_TITLES = {
  youtube: "YouTube video",
  vimeo: "Vimeo video",
  videopress: "VideoPress video",
};

export function editorMediaPlayerOverlay(state) {
  const overlay = state?.editorChapter?.imagePreviewOverlay;
  const kind = overlay?.media?.kind;
  return state?.screen === "translate"
    && overlay?.isOpen === true
    && (kind === "audio" || kind === "video")
    && typeof overlay.src === "string"
    && overlay.src.trim()
    ? overlay
    : null;
}

function captionHtml(caption) {
  const text = String(caption ?? "").trim();
  return text
    ? `<p class="editor-media-player__caption">${renderSanitizedInlineMarkupHtml(text).replaceAll("\n", "<br>")}</p>`
    : "";
}

function openInBrowserButton(url, label) {
  return url
    ? `<button
        class="editor-media-player__link"
        type="button"
        data-media-player-open-external="${escapeHtml(url)}"
      >${externalLinkIconSvg("editor-media-player__link-icon")}<span>${escapeHtml(label)}</span></button>`
    : "";
}

function renderAudioPlayer(overlay) {
  const src = overlay.src.trim();
  return `
    <div class="editor-media-player__card editor-media-player__card--audio" data-stop-row-action>
      <div class="editor-media-player__header">
        <span class="editor-media-player__badge">${fileAudioIconSvg()}</span>
        <div class="editor-media-player__heading">
          <h2 class="editor-media-player__title" id="editor-media-player-title">${escapeHtml(overlay.title || "Audio")}</h2>
          ${captionHtml(overlay.caption)}
        </div>
      </div>
      <audio data-media-player-audio preload="metadata" src="${escapeHtml(src)}"></audio>
      <div class="editor-media-player__timeline">
        <span class="editor-media-player__time" data-media-player-elapsed>0:00</span>
        <input
          class="editor-media-player__seek"
          type="range"
          min="0"
          max="0"
          step="0.1"
          value="0"
          data-media-player-seek
          aria-label="Position"
          style="--editor-media-player-progress: 0%"
        />
        <span class="editor-media-player__time" data-media-player-duration>--:--</span>
      </div>
      <div class="editor-media-player__controls">
        <button
          class="editor-media-player__control"
          type="button"
          data-media-player-control="back"
          aria-label="Back 10 seconds"
        >${skipBackIconSvg()}<span class="editor-media-player__skip-label">10</span></button>
        <button
          class="editor-media-player__play"
          type="button"
          data-media-player-control="toggle"
          data-modal-initial-focus
          aria-label="Play"
        >${playIconSvg("editor-media-player__play-icon")}${pauseIconSvg("editor-media-player__pause-icon")}</button>
        <button
          class="editor-media-player__control"
          type="button"
          data-media-player-control="forward"
          aria-label="Forward 10 seconds"
        >${skipForwardIconSvg()}<span class="editor-media-player__skip-label">10</span></button>
      </div>
      <div class="editor-media-player__footer">
        <button
          class="editor-media-player__speed"
          type="button"
          data-media-player-control="speed"
          aria-label="Playback speed"
        >1×</button>
        ${openInBrowserButton(overlay.imageUrl, "Open in browser")}
      </div>
      <p class="editor-media-player__error" data-media-player-error hidden>This audio could not be played.</p>
    </div>
  `;
}

function renderVideoPlayer(overlay) {
  const media = overlay.media;
  const src = overlay.src.trim();
  const embedUrl = editorVideoEmbedUrl(media, { autoplay: true });
  const title = VIDEO_PROVIDER_TITLES[media.provider] ?? (overlay.title || "Video");
  const frameHtml = embedUrl
    ? `<iframe
        class="editor-media-player__video"
        src="${escapeHtml(embedUrl)}"
        title="${escapeHtml(title)}"
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"
      ></iframe>`
    : `<video
        class="editor-media-player__video"
        data-media-player-video
        src="${escapeHtml(src)}"
        controls
        autoplay
        playsinline
        data-modal-initial-focus
      ></video>`;
  const browserLabel = media.provider === "youtube"
    ? "Open on YouTube"
    : media.provider === "vimeo"
      ? "Open on Vimeo"
      : "Open in browser";
  return `
    <div class="editor-media-player__card editor-media-player__card--video" data-stop-row-action>
      <div class="editor-media-player__frame">${frameHtml}</div>
      <div class="editor-media-player__details">
        <div class="editor-media-player__heading">
          <h2 class="editor-media-player__title" id="editor-media-player-title">${escapeHtml(title)}</h2>
          ${captionHtml(overlay.caption)}
        </div>
        ${openInBrowserButton(overlay.imageUrl, browserLabel)}
      </div>
    </div>
  `;
}

// The audio and video players. They are drawn beside #app, not inside it (see
// editor-media-player-host.js), so a full render cannot restart playback.
export function renderEditorMediaPlayer(state) {
  const overlay = editorMediaPlayerOverlay(state);
  if (!overlay) {
    return "";
  }

  const isAudio = overlay.media.kind === "audio";
  return `
    <div
      class="editor-media-player-overlay editor-media-player-overlay--${isAudio ? "audio" : "video"}"
      data-action="close-editor-image-preview"
      data-editor-media-player
      data-row-id="${escapeHtml(overlay.rowId ?? "")}"
      data-language-code="${escapeHtml(overlay.languageCode ?? "")}"
      role="dialog"
      aria-modal="true"
      aria-labelledby="editor-media-player-title"
      data-modal-dialog="editor-media-player"
      tabindex="-1"
    >
      <button
        class="editor-media-player__close"
        type="button"
        data-action="close-editor-image-preview"
        data-modal-cancel
        aria-label="Close player"
      >${closeIconSvg()}</button>
      ${isAudio ? renderAudioPlayer(overlay) : renderVideoPlayer(overlay)}
    </div>
  `;
}
