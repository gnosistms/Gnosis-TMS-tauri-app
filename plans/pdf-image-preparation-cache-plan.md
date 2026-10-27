# PDF image preparation cache

## Goal

Avoid repeating expensive PDF image download/decode/resize/re-encode work when the
same chapter is exported repeatedly, while invalidating only images whose inputs
changed.

## Plan

1. [x] Add a process-local, single-chapter cache to the Rust PDF export pipeline. Scope
   it by repository/project/chapter and clear it whenever an export for another
   chapter begins.
2. [x] Fingerprint each image input. Use a content digest for uploaded images and
   normalized URL identity for remote images. Include
   an image-preparation revision so future optimizer changes invalidate old entries.
3. [x] Reuse cached prepared bytes for matching fingerprints, prepare only
   cache misses, and continue writing fresh per-job Typst workspace files.
4. [x] Add focused tests for same-chapter reuse, selective invalidation, and chapter
   switching, then run the Rust test and lint checks relevant to the module.

## Constraints

- Do not persist project image contents outside the running app session.
- Do not share cached entries across chapters.
- Cancellation and concurrent export behavior must remain safe.
- Cache failures must never make an otherwise valid export fail.
