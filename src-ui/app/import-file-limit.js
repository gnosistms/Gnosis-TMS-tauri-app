// Mirrors src-tauri/src/constants.rs. Update both files when changing the import limit.
// Rust is authoritative; this JS pre-check avoids reading oversized picker files into memory.
export const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024;
export const IMPORT_FILE_SIZE_LIMIT_LABEL = "25 MB";

export function importFileSizeLimitMessage(fileName = "file") {
  const normalizedName = String(fileName || "").trim() || "file";
  return `'${normalizedName}' is too large to import. The maximum file size is ${IMPORT_FILE_SIZE_LIMIT_LABEL}.`;
}

export function enforceImportFileSizeLimit(sizeBytes, fileName = "file") {
  const normalizedSize = Number(sizeBytes);
  if (Number.isFinite(normalizedSize) && normalizedSize > MAX_IMPORT_FILE_BYTES) {
    throw new Error(importFileSizeLimitMessage(fileName));
  }
}
