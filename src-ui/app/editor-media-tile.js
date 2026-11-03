import { escapeHtml, tooltipAttributes } from "../lib/ui.js";
import { editorFieldImageDisplayName, editorFieldImageMetadataText } from "./editor-images.js";
import { fileAudioIconSvg, filmIconSvg, playIconSvg } from "./editor-media-icons.js";
import {
  EDITOR_VIDEO_THUMBNAIL_ATTRIBUTE,
  cachedEditorVideoThumbnailUrl,
  requestEditorVideoThumbnail,
} from "./editor-video-thumbnails.js";

function renderEditorVideoPoster(media, videoSrc) {
  if (media.provider === "file") {
    // The first frame stands in for a poster; the film icon shows if it can't load.
    return `<video
      class="translation-language-panel__media-poster-image"
      src="${escapeHtml(`${videoSrc}#t=0.1`)}"
      preload="metadata"
      muted
      playsinline
      tabindex="-1"
      aria-hidden="true"
    ></video>`;
  }

  const thumbnailUrl = cachedEditorVideoThumbnailUrl(media, videoSrc);
  if (thumbnailUrl === null) {
    requestEditorVideoThumbnail(media, videoSrc);
  }
  return thumbnailUrl === ""
    ? ""
    : `<img
      class="translation-language-panel__media-poster-image"
      ${EDITOR_VIDEO_THUMBNAIL_ATTRIBUTE}="${escapeHtml(videoSrc)}"
      ${thumbnailUrl ? `src="${escapeHtml(thumbnailUrl)}"` : ""}
      alt=""
      loading="eager"
      referrerpolicy="no-referrer"
    />`;
}

// Audio and video show a fixed-size tile, in the row and in the preview, so
// nothing resizes while the media loads. Clicking it opens the player, as
// clicking an image opens the larger view.
export function renderEditorMediaTile({
  rowId,
  languageCode,
  image,
  media,
  mediaSrc,
  className = "",
  contextMenu = true,
}) {
  const isAudio = media.kind === "audio";
  const displayName = editorFieldImageDisplayName(image);
  const tooltip = editorFieldImageMetadataText(image) || (isAudio ? "Play audio" : "Play video");
  return `<button
          class="translation-language-panel__image-preview translation-language-panel__media-preview translation-language-panel__media-preview--${isAudio ? "audio" : "video"}${className ? ` ${escapeHtml(className)}` : ""}"
          type="button"
          data-action="open-editor-image-preview"
          ${contextMenu ? "data-editor-image-context-menu-target" : ""}
          data-editor-media-kind="${escapeHtml(media.kind)}"
          data-row-id="${escapeHtml(rowId ?? "")}"
          data-language-code="${escapeHtml(languageCode ?? "")}"
          ${image.kind === "url" ? `data-image-url="${escapeHtml(image.url ?? "")}"` : ""}
          aria-label="${escapeHtml(isAudio ? `Play audio ${displayName}` : "Play video")}"
          ${tooltipAttributes(tooltip, { side: "top", align: "start" })}
        >
          ${isAudio
            ? `${fileAudioIconSvg("translation-language-panel__media-icon")}
          <span class="translation-language-panel__media-name">${escapeHtml(displayName)}</span>`
            : `<span class="translation-language-panel__media-poster">
            ${filmIconSvg("translation-language-panel__media-poster-icon")}
            ${renderEditorVideoPoster(media, mediaSrc)}
            <span class="translation-language-panel__media-play" aria-hidden="true">${playIconSvg()}</span>
          </span>`}
        </button>`;
}
