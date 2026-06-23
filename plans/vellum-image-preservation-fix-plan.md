# Vellum Image Preservation Fix

## Problem

Vellum image paste currently serializes `OGImageHandle` objects that point
directly at source image URLs or paths. Vellum-generated pasteboard data instead
points `preservedMetadata` at a local `file://` URL under a Vellum temp image
directory and stores richer image metadata in `preservedURL`.

## Approach

1. Add a macOS-only native preparation command that downloads or copies each
   Vellum export image to a temp `co.180g.Vellum/preserved-images.*` directory
   and returns local URL/path metadata.
2. Let the Vellum archive builder use prepared image metadata when present,
   while preserving the current fallback for tests and non-image data.
3. Wire the copy/export flow to prepare image resources before building the
   Vellum pasteboard archive.
4. Add focused JS and Rust tests for prepared image metadata and unsupported
   non-macOS preparation behavior.

## Verification

- `node --test src-ui/app/vellum-text-editor-content.test.js`
- `node --test src-ui/app/editor-export-flow.test.js`
- `cargo test --manifest-path src-tauri/Cargo.toml vellum_clipboard`
