# HTML Image Import Plan

## Summary

Import article images from pasted HTML links as URL-backed editor images, without downloading or copying image files. Images should appear in editor rows using the existing image UI, with captions imported into the existing image caption field when available.

## Key Changes

- Extend the import row/field model so imported fields can carry:
  - `image: { kind: "url", url: "https://..." }`
  - `image_caption: "Caption text"`
- Write those properties into GTMS row JSON from the shared import writer, while preserving existing text, footnote, and metadata behavior for XLSX/TXT/DOCX/HTML text rows.
- Update HTML extraction to emit image blocks in DOM order from the cleaned article content:
  - `<figure><img ...><figcaption>...</figcaption></figure>` becomes one image row with caption.
  - Standalone meaningful `<img>` becomes one image row.
  - For standalone images, use meaningful nearby caption text only when available; otherwise use non-generic `alt` as caption fallback.
- Store images as URL references only. Resolve relative image URLs against `source_url`; reject `data:`, `blob:`, empty, and non-HTTP(S) sources.
- Prefer high-quality image sources in this order: `srcset` best candidate, then `data-src`/lazy attributes, then `src`, matching the existing reader-mode behavior where practical.
- Add HTML format metadata for image rows:
  - `source_url`
  - `block_kind: "image"`
  - `block_index`
  - `original_tag: "figure"` or `"img"`
  - `image_url`

## Filtering Rules

- Only inspect images inside Readability output or the conservative fallback article/main container.
- Skip likely non-content images:
  - elements hidden by `hidden`, `aria-hidden="true"`, or skipped ancestors already used by the HTML importer
  - images inside `nav`, `header`, `footer`, `aside`, `form`, `script`, `style`, `template`
  - class/id/src tokens like `ad`, `ads`, `advert`, `banner`, `promo`, `sponsor`, `tracking`, `pixel`, `spacer`, `logo`, `avatar`, `icon`, `sprite`, `share`, `social`
  - width/height both below `100`, or extreme aspect ratios when dimensions are known
- Do not preserve website styling such as rounded corners, drop shadows, borders, floats, or alignment. Reader-style import keeps semantic content only.

## Tests

- Rust HTML import tests:
  - imports `<figure><img><figcaption>` as a URL image with image caption
  - resolves relative image URLs against the source URL
  - imports standalone article images with meaningful `alt` fallback captions
  - skips tiny pixels, logos, ads, social/share images, data URLs, and images outside article content
  - preserves DOM order between headings, paragraphs, images, and blockquotes
  - writes `image`, `image_caption`, and HTML image metadata into built row files
- Existing regression coverage:
  - `cargo test`
  - `npm test`
  - `npm run build`

## Assumptions

- Image import applies only to HTML link imports for now.
- Images are not downloaded into project assets.
- Imported image rows may have empty `plain_text`; the visible content is the editor image plus optional caption.
- Captions prefer `figcaption`; `alt` is only a fallback when it is human-readable and not a filename/generic placeholder.
