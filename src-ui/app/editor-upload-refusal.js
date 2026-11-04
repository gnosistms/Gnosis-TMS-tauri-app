// Why a file picked or dropped for a row's media is refused before it is read,
// judged by its name, type and size, so the message can say what to do instead.
// A file that passes is still checked by its contents afterwards.

import { editorMediaForUploadPath } from "./editor-media-kind.js";
import { MAX_IMPORT_FILE_BYTES } from "./import-file-limit.js";

export const EDITOR_UPLOAD_REFUSAL_VIDEO = "video";
export const EDITOR_UPLOAD_REFUSAL_UNSUPPORTED_AUDIO = "unsupported-audio";
export const EDITOR_UPLOAD_REFUSAL_TOO_LARGE = "too-large";

const VIDEO_FILE_EXTENSIONS = new Set([
  "3gp", "avi", "flv", "m2ts", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "mts", "ogv", "webm", "wmv",
]);
const OTHER_AUDIO_EXTENSIONS = new Set([
  "aac", "aif", "aifc", "aiff", "amr", "ape", "caf", "flac", "oga", "ogg", "opus", "wma",
]);

function fileExtension(name) {
  const segments = String(name ?? "").split(/[\\/]/);
  const baseName = segments[segments.length - 1] ?? "";
  const dotIndex = baseName.lastIndexOf(".");
  return dotIndex > 0 ? baseName.slice(dotIndex + 1).toLowerCase() : "";
}

/**
 * @param {{ name?: string, type?: string, size?: number }} file
 * @returns {"" | "video" | "unsupported-audio" | "too-large"}
 */
export function editorUploadRefusalReason(file) {
  const name = typeof file?.name === "string" ? file.name.trim() : "";
  const type = typeof file?.type === "string" ? file.type.trim().toLowerCase() : "";
  const extension = fileExtension(name);
  // MP3, M4A and WAV are judged by extension alone: browsers report .m4a
  // under several types, some of them video/mp4.
  const isSupportedAudio = editorMediaForUploadPath(name).kind === "audio";
  if (!isSupportedAudio) {
    if (VIDEO_FILE_EXTENSIONS.has(extension) || type.startsWith("video/")) {
      return EDITOR_UPLOAD_REFUSAL_VIDEO;
    }
    if (OTHER_AUDIO_EXTENSIONS.has(extension) || type.startsWith("audio/")) {
      return EDITOR_UPLOAD_REFUSAL_UNSUPPORTED_AUDIO;
    }
  }
  const size = Number(file?.size);
  return Number.isFinite(size) && size > MAX_IMPORT_FILE_BYTES ? EDITOR_UPLOAD_REFUSAL_TOO_LARGE : "";
}
