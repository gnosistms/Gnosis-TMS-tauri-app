// Poster images for video rows. YouTube's address is known from the video id;
// Vimeo and VideoPress publish theirs through oEmbed, which the backend looks
// up once per video for the session. Rows render whatever is cached; a lookup
// that finishes later fills in the thumbnails already on screen, so no row
// re-render (and no layout change) is needed.

import { editorVideoStaticThumbnailUrl } from "./editor-media-kind.js";

export const EDITOR_VIDEO_THUMBNAIL_ATTRIBUTE = "data-editor-video-thumbnail-for";

const thumbnailUrls = new Map();
const pendingLookups = new Set();

function videoNeedsLookup(media) {
  return media?.kind === "video" && (media.provider === "vimeo" || media.provider === "videopress");
}

// The poster address, "" when the video has none, or null while unknown.
export function cachedEditorVideoThumbnailUrl(media, videoUrl) {
  const staticUrl = editorVideoStaticThumbnailUrl(media);
  if (staticUrl) {
    return staticUrl;
  }
  if (!videoNeedsLookup(media)) {
    return "";
  }
  return thumbnailUrls.has(videoUrl) ? thumbnailUrls.get(videoUrl) : null;
}

function showThumbnail(videoUrl, thumbnailUrl) {
  if (!thumbnailUrl || typeof document === "undefined") {
    return;
  }
  for (const image of document.querySelectorAll(`img[${EDITOR_VIDEO_THUMBNAIL_ATTRIBUTE}]`)) {
    if (image.getAttribute(EDITOR_VIDEO_THUMBNAIL_ATTRIBUTE) === videoUrl && !image.getAttribute("src")) {
      image.src = thumbnailUrl;
    }
  }
}

// runtime.js is loaded on first use: it imports state.js, which imports
// editor-preview.js, which renders video tiles through this module.
function invokeRuntimeCommand(command, payload) {
  return import("./runtime.js").then(({ invoke }) => invoke(command, payload));
}

export function requestEditorVideoThumbnail(media, videoUrl, operations = {}) {
  const invokeCommand = operations.invoke ?? invokeRuntimeCommand;
  if (
    !videoNeedsLookup(media)
    || !videoUrl
    || thumbnailUrls.has(videoUrl)
    || pendingLookups.has(videoUrl)
    || typeof invokeCommand !== "function"
  ) {
    return null;
  }

  pendingLookups.add(videoUrl);
  return Promise.resolve()
    .then(() => invokeCommand("fetch_editor_video_thumbnail_url", { videoUrl }))
    .then((thumbnailUrl) => (typeof thumbnailUrl === "string" ? thumbnailUrl.trim() : ""))
    .catch(() => "")
    .then((thumbnailUrl) => {
      pendingLookups.delete(videoUrl);
      thumbnailUrls.set(videoUrl, thumbnailUrl);
      showThumbnail(videoUrl, thumbnailUrl);
      return thumbnailUrl;
    });
}
