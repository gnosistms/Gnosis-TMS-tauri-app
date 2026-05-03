# Editor Image Scroll Jitter Plan

## Goal

Reduce or eliminate visible jitter when scrolling editor rows that contain images, without disabling virtualization for large chapters.

The desired behavior is:

- Rows entering the viewport render at a stable height on the first paint.
- Image previews do not briefly disappear or show the loading placeholder after the same image has already loaded.
- Image captions keep the same layout while the image row is mounted, measured, and scrolled.
- The virtualizer does not adjust scroll position when the final measured height matches the predicted height.

## Current Working Theory

The editor still needs to render rows that enter the virtual window while scrolling. That part is expected.

The remaining jitter is likely caused by layout correction after a row containing an image enters the viewport:

- The virtualizer starts with a height estimate that is too low or too generic for image rows.
- The image preview receives cached dimensions during or shortly after mount.
- The row height cache is corrected after DOM measurement.
- The virtualizer adjusts offsets or scroll anchoring after the correction.
- During that short correction window, the caption can change width because the image preview column is not treated as fully stable yet.

## Implementation Plan

### 1. Confirm The Re-Render Path

Inspect and, if useful, temporarily instrument:

- `src-ui/app/editor-virtual-list.js`
- `src-ui/app/editor-virtualization.js`
- `src-ui/app/editor-row-render.js`
- `src-ui/app/editor-image-preview-size.js`

Answer these questions:

- Are already-visible rows re-rendered on scroll, or only rows entering/leaving the virtual window?
- Which code path triggers row height measurement for image rows?
- Does image `load` fire again for cached or remounted images?
- Does the virtualizer receive a height-change notification even when cached dimensions already match the rendered dimensions?

### 2. Cache Image Preview Dimensions As Stable Layout Data

Keep the existing image-source preview-size cache, but treat it as layout input rather than only post-load cleanup.

Required behavior:

- On successful image load, cache `{ contentWidth, contentHeight, frameWidth, frameHeight }` by final image source.
- On row render, if dimensions are cached for that source, apply the CSS custom properties immediately.
- Cached image renders must not add `is-loading` or `aria-busy`.
- The loading placeholder remains only for first-time image loads where no dimensions are known.

### 3. Avoid Redundant Height Invalidations

When the image load handler runs:

- Compute the preview frame size.
- Compare it with the cached size for that image source.
- If the size is unchanged, remove loading state if needed, but skip row-height invalidation.
- If the size changed, update the cache and notify the virtualizer once.

This should prevent scroll correction when the image row is being remounted with dimensions already known.

### 4. Improve Virtual Row Height Estimates

Find the virtualizer's estimated row-height path and add image-aware estimates.

The estimate should account for:

- Base row content and toolbar height.
- Presence of a visible image.
- Cached image frame height.
- Visible caption or caption editor height.

If a row has a cached image preview height, the estimate should be close enough that the measured height does not cause visible scroll correction.

### 5. Stabilize Image And Caption Layout

Make the image row layout reserve image space whenever a row has an image, including:

- first-load placeholder state,
- cached image state,
- loaded image state,
- image error state if the row is still in image status UI.

The caption column should not temporarily take the image column's space while the image preview is settling.

Potential CSS direction:

- Keep `.translation-language-panel__image-row` as a stable two-column layout when an image exists.
- Keep image preview width/height defined before first paint when cached dimensions exist.
- Keep caption max width independent of transient image loading state.

### 6. Add Regression Coverage

Add focused tests for:

- Cached image render skips loading state.
- Same-size image load does not request a virtual row-height update.
- Changed-size image load updates the cache and requests a row-height update once.
- Image-aware row-height estimates include cached image frame height.
- Caption layout remains in image-row mode when a row has an image, even before the image finishes loading.

### 7. Manual Verification

Use the dev app with rows containing:

- wide images,
- portrait images,
- image captions,
- no captions,
- freshly pasted image URLs,
- already-loaded image URLs.

Scroll slowly and quickly through those rows. Confirm:

- no visible image disappearance for already-loaded images,
- no flashing `Loading image...` for already-loaded images,
- no caption width jump,
- no scroll offset correction that feels like a row jump.

## Review

### Strengths

- The plan keeps virtualization, which is necessary for large chapters.
- It targets the likely remaining source of jitter: height correction after image rows mount.
- It separates first-time image loading behavior from remounting already-loaded image rows.
- It includes both code-level regression tests and manual visual verification.

### Risks

- Row-height estimation may be spread across multiple modules, so this could require careful changes in both the virtualized and non-virtualized paths.
- If image sources differ between `src`, `currentSrc`, and `convertLocalFileSrc()` output, cache keys must be normalized consistently or cached dimensions will be missed.
- If a remote image changes dimensions without its URL changing, cached dimensions could briefly be stale until the next load event corrects them.
- Over-aggressive suppression of height invalidation could leave a row height stale if a caption, editor control, or image state changes independently.

### Recommended Refinements Before Coding

- Start with instrumentation or logging behind an existing debug flag, then remove or keep only useful debug hooks.
- Build a small helper that compares cached and computed image preview sizes exactly, so suppression of height invalidation is explicit and testable.
- Keep the first implementation narrow: stabilize cached image remounts first, then improve row-height estimates if jitter remains.
- Prefer preserving existing scroll anchoring behavior; only change anchoring if height estimate fixes are not enough.
