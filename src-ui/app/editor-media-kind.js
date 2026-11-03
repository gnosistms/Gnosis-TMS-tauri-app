// A row's stored image value ({ kind: "url" | "upload", ... }) never records
// whether it holds an image, audio or video: older app versions would drop an
// extra field when they rewrite the row. The media kind is derived from the URL
// or the uploaded file name instead. src-tauri/.../chapter_editor/media_kind.rs
// must agree on every case in tests/fixtures/editor-media-kind/cases.json.

export const EDITOR_AUDIO_EXTENSIONS = ["mp3", "m4a", "wav"];
const VIDEO_FILE_EXTENSIONS = ["mp4", "m4v", "mov", "webm"];
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID_PATTERN = /^\d+$/;
const VIMEO_HASH_PATTERN = /^[0-9a-f]{6,}$/;
const VIDEOPRESS_GUID_PATTERN = /^[A-Za-z0-9]{8}$/;
const VIMEO_COLLECTION_SEGMENTS = new Set(["groups", "album", "showcase"]);

const IMAGE_MEDIA = Object.freeze({ kind: "image", provider: null, id: null, hash: null });
const AUDIO_MEDIA = Object.freeze({ kind: "audio", provider: null, id: null, hash: null });

function video(provider, id = null, hash = null) {
  return { kind: "video", provider, id, hash };
}

function fileExtension(path) {
  const segments = String(path ?? "").split(/[\\/]/);
  const name = segments[segments.length - 1] ?? "";
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 ? name.slice(dotIndex + 1).toLowerCase() : "";
}

function siteHost(hostname) {
  return String(hostname ?? "").toLowerCase().replace(/^(?:www|m|music)\./, "");
}

function pathSegments(url) {
  return url.pathname.split("/").filter(Boolean);
}

function youtubeMedia(url, host) {
  let id = "";
  if (host === "youtu.be") {
    id = pathSegments(url)[0] ?? "";
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [first = "", second = ""] = pathSegments(url);
    if (first === "watch") {
      id = url.searchParams.get("v") ?? "";
    } else if (["shorts", "embed", "live", "v"].includes(first)) {
      id = second;
    }
  } else {
    return null;
  }
  return YOUTUBE_ID_PATTERN.test(id) ? video("youtube", id) : IMAGE_MEDIA;
}

function vimeoMedia(url, host) {
  if (host !== "vimeo.com" && host !== "player.vimeo.com") {
    return null;
  }
  const segments = pathSegments(url);
  const numericIndexes = segments
    .map((segment, index) => (VIMEO_ID_PATTERN.test(segment) ? index : -1))
    .filter((index) => index >= 0);
  if (numericIndexes.length === 0) {
    return IMAGE_MEDIA;
  }
  const idIndex = VIMEO_COLLECTION_SEGMENTS.has(segments[0])
    ? numericIndexes[numericIndexes.length - 1]
    : numericIndexes[0];
  const pathHash = segments[idIndex + 1] ?? "";
  const hash = url.searchParams.get("h") || (VIMEO_HASH_PATTERN.test(pathHash) ? pathHash : "");
  return video("vimeo", segments[idIndex], VIMEO_HASH_PATTERN.test(hash) ? hash : null);
}

function videoPressMedia(url, host) {
  if (host !== "videopress.com" && host !== "video.wordpress.com") {
    return null;
  }
  const [first = "", second = ""] = pathSegments(url);
  return (first === "v" || first === "embed") && VIDEOPRESS_GUID_PATTERN.test(second)
    ? video("videopress", second)
    : IMAGE_MEDIA;
}

function mediaForExtension(extension, { allowVideo }) {
  if (EDITOR_AUDIO_EXTENSIONS.includes(extension)) {
    return AUDIO_MEDIA;
  }
  if (allowVideo && VIDEO_FILE_EXTENSIONS.includes(extension)) {
    return video("file");
  }
  return IMAGE_MEDIA;
}

export function editorMediaForUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    return IMAGE_MEDIA;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return IMAGE_MEDIA;
  }

  const host = siteHost(url.hostname);
  return youtubeMedia(url, host)
    ?? vimeoMedia(url, host)
    ?? videoPressMedia(url, host)
    ?? mediaForExtension(fileExtension(url.pathname), { allowVideo: true });
}

// Video cannot be uploaded, so an uploaded file is only ever an image or audio.
export function editorMediaForUploadPath(path) {
  return mediaForExtension(fileExtension(path), { allowVideo: false });
}

export function editorFieldMedia(image) {
  if (image?.kind === "url") {
    return editorMediaForUrl(image.url);
  }
  if (image?.kind === "upload") {
    return editorMediaForUploadPath(image.path || image.fileName);
  }
  return IMAGE_MEDIA;
}

export function editorMediaNoun(media) {
  return media?.kind === "audio" || media?.kind === "video" ? media.kind : "image";
}

export function editorVideoEmbedUrl(media, { autoplay = false } = {}) {
  if (media?.kind !== "video") {
    return "";
  }
  const autoplayParam = autoplay ? "1" : "0";
  switch (media.provider) {
    case "youtube":
      return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(media.id)}?rel=0&autoplay=${autoplayParam}`;
    case "vimeo": {
      const hash = media.hash ? `h=${encodeURIComponent(media.hash)}&` : "";
      return `https://player.vimeo.com/video/${encodeURIComponent(media.id)}?${hash}autoplay=${autoplayParam}`;
    }
    case "videopress":
      return `https://video.wordpress.com/embed/${encodeURIComponent(media.id)}?autoPlay=${autoplay ? "true" : "false"}`;
    default:
      return "";
  }
}

// The thumbnail address that needs no lookup. Vimeo and VideoPress thumbnails
// come from their oEmbed endpoints instead (see editor-video-thumbnails.js).
export function editorVideoStaticThumbnailUrl(media) {
  return media?.kind === "video" && media.provider === "youtube"
    ? `https://i.ytimg.com/vi/${encodeURIComponent(media.id)}/hqdefault.jpg`
    : "";
}
