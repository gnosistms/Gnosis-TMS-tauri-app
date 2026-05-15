# DOCX Image Import Plan

## Goal

Support images when importing `.docx` files through Add files.

When a DOCX contains an image, import that image into its own row. The image row should have:

- the image, either as an uploaded/stored image for embedded DOCX media or as a URL-style image for external `http(s)` links;
- the image caption, if the DOCX provides one;
- empty translation/source text;
- no footnote unless the caption paragraph itself has footnotes and we later decide to preserve those.

Do not merge images into neighboring text rows. This keeps the behavior simple, predictable, and consistent with how image rows already work in the editor/export pipeline.

## Current State

The DOCX importer is in `src-tauri/src/project_import/chapter_import/docx.rs`.

Current behavior:

- `parse_docx_file()` opens the DOCX zip, reads `word/document.xml`, reads footnotes, and produces text rows.
- `parse_docx_document_xml()` treats `drawing` and `pict` as unsupported content:
  - it increments `unsupported_content_counts["embedded_images"]`;
  - it does not read the image relationship id;
  - it does not read `word/media/*`;
  - it does not create image rows.
- The shared import row model already supports images:
  - `ImportedField.image_caption`;
  - `ImportedField.image`;
  - `ImportedFieldImage { kind, url, path, pending_upload }`.
- `write_gtms.rs` now finalizes pending imported image bytes into repo-relative uploaded-image paths before writing row JSON. This is the right storage path for embedded DOCX images.

Conclusion: the writer/storage side is mostly ready. The missing work is DOCX relationship/media parsing and emitting image-only rows.

## Design

### 1. Reuse the Import Image Pipeline

Use the same image rules that HTML import uses:

- Embedded DOCX image bytes become upload-style images.
- External absolute `http://` or `https://` image relationships become URL-style images.
- External non-`http(s)` relationships are omitted and counted as unsupported.
- Do not fetch external images during import.

For embedded DOCX media, create `ImportedFieldImage` with:

  - `kind: "upload"`;
  - `url: None`;
  - `path: None`;
  - `pending_upload: Some(ImportedImageUpload { filename, bytes })`.

For external `http(s)` image relationships, create `ImportedFieldImage` with:

  - `kind: "url"`;
  - `url: Some(url)`;
  - `path: None`;
  - `pending_upload: None`.

- During row writing, let `finalize_pending_uploaded_images()` write the image file under:
  - `chapters/{chapter_slug}/images/row-{row_id}-{language}-{uuid}/{filename}`
- Validate embedded image bytes before creating image rows when practical, so unsupported DOCX image formats do not become empty image rows. Keep the existing `write_gtms.rs` validation as a final guard.

No new chapter JSON format is needed.

### 2. Read DOCX Image Relationships

Add a small DOCX image asset loader in `docx.rs`.

Read `word/_rels/document.xml.rels` and build:

```rust
BTreeMap<String, DocxImageAsset>
```

Where the key is the relationship id, for example `rId5`.

Represent relationships with an enum-like shape:

```rust
enum DocxImageAsset {
    Embedded {
        relationship_id: String,
        target: String,
        filename: String,
        bytes: Vec<u8>,
    },
    ExternalUrl {
        relationship_id: String,
        url: String,
    },
    Unsupported {
        relationship_id: String,
        reason: &'static str,
    },
}
```

Embedded assets should include:

- `relationship_id`;
- `target`, for example `media/image1.png`;
- a safe filename, for example `image1.png`;
- raw `bytes` from `word/media/image1.png`.

Implementation details:

- Parse relationship XML entries where:
  - local element name is `Relationship`;
  - `Type` ends with `/image`;
  - `Id` is present;
  - `Target` is present.
- If `TargetMode="External"`:
  - keep absolute `http(s)` targets as `ExternalUrl`;
  - treat all other schemes or malformed targets as unsupported.
- If the target is embedded:
  - resolve targets relative to `word/`;
  - only read enclosed archive paths under `word/media/`;
  - validate bytes as a supported imported image before creating an image row when practical.
- Reuse the existing DOCX zip safety checks; do not add network access.

### 3. Detect Images in Document XML

Update `parse_docx_document_xml()` so it receives image assets:

```rust
fn parse_docx_document_xml(
    xml: &str,
    footnotes: &BTreeMap<String, String>,
    images: &BTreeMap<String, DocxImageAsset>,
) -> Result<ParsedDocxDocument, String>
```

Detect both common paths:

- modern DrawingML:
  - `w:drawing`
  - nested `a:blip`
  - relationship attribute `r:embed` or `embed`
- older VML:
  - `w:pict`
  - nested `v:imagedata`
  - relationship attribute `r:id` or `id`

When an image relationship id is found:

- look it up in the image asset map;
- create either a pending-upload image entry for embedded media or a URL-style image entry for external `http(s)` relationships;
- add it to the current paragraph state as a separate image candidate;
- if it is missing or unsupported, increment `unsupported_content_counts["embedded_images"]`.

Keep detecting image events in document order. If a paragraph has both text and images, emit:

1. a text row for the paragraph text, if nonempty;
2. one image-only row per image in the same paragraph.

That satisfies the requirement that the image belongs to its own row without losing surrounding text.

### 4. Caption Handling

Use a clean, conservative caption rule.

Primary caption source:

- A paragraph immediately following an image-only paragraph with DOCX style `Caption`.
- Attach that paragraph text as the previous image row's `image_caption`.
- Do not emit that caption paragraph as a separate text row.

Fallback caption source:

- Use image metadata from `wp:docPr` or equivalent drawing properties if available:
  - prefer `descr`;
  - then `title`;
  - ignore generic values such as `Picture`, `Image`, `Graphic`, or empty strings.

Do not guess captions from arbitrary nearby paragraphs. That would incorrectly consume normal text.

Implementation shape:

- Extend `DocxParagraphState` to hold:
  - text;
  - style;
  - footnotes;
  - image candidates in the paragraph.
- Extend `ParsedDocxRow` so it can represent text rows and image rows:

```rust
enum ParsedDocxRowKind {
    Text {
        plain_text: String,
        footnote: String,
        text_style: Option<String>,
    },
    Image {
        image: ImportedFieldImage,
        caption: String,
    },
}
```

or keep the current struct and add optional image fields:

- `plain_text`;
- `footnote`;
- `image_caption`;
- `image`;
- `text_style`.

The second option is smaller and matches `ImportedField`.

Caption assignment flow:

- When finishing a paragraph:
  - if it is style `Caption` and the most recent emitted row is an image row with an empty caption, attach the normalized paragraph text to that image row and return without emitting a text row;
  - otherwise emit text and image rows normally.
- If the image already has a non-generic `descr`/`title`, keep it unless the following style `Caption` paragraph exists; the explicit caption paragraph should win.

### 5. Row Metadata

Keep DOCX metadata useful but simple.

For image rows:

- `block_kind: "image"`;
- `paragraph_number`: the paragraph where the image appeared;
- `table_row_number`: current table row if the image came from a table, otherwise `None`;
- `list_item: false`;
- `original_style`: the paragraph style, if any;
- `warning_counts`: empty unless image extraction had recoverable issues.

For text rows, keep existing metadata behavior.

For import summary:

- Add `imported_images: usize` to `DocxImportSummary`.
- Stop counting successfully imported images under `unsupported_content_counts["embedded_images"]`.
- Continue counting missing, unreadable, invalid, and non-`http(s)` external images as unsupported embedded images.
- Do not count external `http(s)` images as unsupported; those are imported as URL-style images.

### 6. Tables

Keep table support conservative in the first implementation.

If an image appears inside a table cell:

- create an image-only row in document order;
- use the active table row number in metadata;
- do not try to merge the image into the flattened table-row text.

If a caption-style paragraph appears immediately after that image inside the same table cell, attach it as the image caption and do not add it to the flattened cell text.

If table ordering becomes complex, prefer preserving images as separate rows over preserving perfect flattened table text. The editor can handle image rows cleanly.

### 7. Tests

Add Rust tests in `src-tauri/src/project_import/chapter_import/docx.rs`.

Test fixtures should build minimal DOCX zip files with:

- `[Content_Types].xml`;
- `_rels/.rels`;
- `word/document.xml`;
- `word/_rels/document.xml.rels`;
- `word/media/image1.png`.

Required tests:

1. `parse_docx_file_imports_embedded_image_as_own_row`
   - DOCX has text paragraph, image paragraph, text paragraph.
   - Parsed rows are text, image, text.
   - Image row has empty `plain_text`.
   - Image row has `image.kind == "upload"` and pending bytes.

2. `parse_docx_file_attaches_following_caption_style_to_image_row`
   - DOCX has image paragraph followed by style `Caption`.
   - Caption paragraph is not emitted as a text row.
   - Image row has `image_caption`.

3. `parse_docx_file_uses_docpr_description_as_caption_fallback`
   - DOCX has image with `wp:docPr descr="..."`.
   - No following caption paragraph.
   - Image row caption uses the description.

4. `parse_docx_file_caption_paragraph_wins_over_docpr_description`
   - DOCX has both `descr` and following style `Caption`.
   - Image row caption uses the caption paragraph.

5. `parse_docx_file_imports_external_http_image_as_url_row`
   - Relationship has `TargetMode="External"` and an `https://...` target.
   - Image row has empty `plain_text`.
   - Image row has `image.kind == "url"`.
   - Image row has no pending upload.
   - Unsupported embedded image count does not increment.

6. `parse_docx_file_counts_unreadable_or_non_http_external_images_as_unsupported`
   - Relationship target is missing from zip or external with a non-`http(s)` scheme.
   - Import does not fail.
   - No image row is created.
   - `unsupported_content_counts["embedded_images"]` increments.

7. `parse_docx_file_imports_vml_pict_image`
   - Covers legacy `v:imagedata r:id="..."`.

8. `parse_docx_file_imports_image_only_docx`
   - A DOCX with only an image imports successfully.
   - The old "does not contain any importable text" empty-file path is updated to allow image-only content.

Add or extend tests in `write_gtms.rs` only if the pending-upload helper needs changes. Ideally it should not.

Run:

- `cargo test project_import::chapter_import::tests::parse_docx`
- `cargo test project_import::chapter_import`
- `cargo test`
- `npm test`
- `npm run build`

### 8. Manual QA

Create or find DOCX files with:

- one paragraph, one image, one paragraph;
- an image with a Word caption inserted through Word's caption feature;
- an image with alt text but no caption;
- an external `https://...` linked image;
- an external non-web linked image, such as a local file link;
- an image inside a table;
- multiple images in a row;
- a DOCX with no images.

For each:

1. Add the DOCX through Add files.
2. Select the source language.
3. Open the imported chapter.
4. Confirm each image appears as its own row.
5. Confirm caption rows are not duplicated as translation text.
6. Confirm normal text rows remain in order.
7. Confirm embedded images become uploaded/stored images.
8. Confirm external `http(s)` images stay URL-style images.
9. Export to HTML/DOCX and confirm uploaded and URL-style images render through the existing export path.

## Out of Scope

- Fetching/downloading externally linked DOCX images.
- OCR or image text extraction.
- Complex caption guessing from arbitrary nearby paragraphs.
- Preserving image sizing, alignment, wrapping, or exact Word layout.
- Importing images from `.xlsx`; plan that separately if needed.
- Importing headers, footers, comments, endnotes, text boxes, or tracked-change image variants.

## Implementation Order

1. Add DOCX relationship/media/external-image loading.
2. Extend parser state to collect image candidates.
3. Emit image-only rows.
4. Attach style `Caption` paragraphs to the previous image row.
5. Add summary count for imported images.
6. Add focused DOCX parser tests.
7. Run full Rust/frontend verification.
