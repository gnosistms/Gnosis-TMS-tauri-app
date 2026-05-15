# HTML File Import Plan

## Current State

- The project import backend already has an HTML parser and Tauri command:
  - `src-tauri/src/project_import/chapter_import/html.rs`
  - `import_html_to_gtms`
- The frontend project import flow already recognizes `.html` and `.htm` in `detectImportFileType()` and routes them through `import_html_to_gtms`.
- HTML links are already supported through the `Paste link` path:
  - `resolve_project_import_link`
  - `submitProjectImportLink()`
  - returned link data includes `sourceUrl`
- HTML image import currently keeps public-looking image URLs, but embedded `data:` images are skipped because `resolve_image_url()` rejects `data:` sources.
- Direct upload support is incomplete:
  - `PROJECT_IMPORT_ACCEPT` excludes `.html`, `.htm`, and `text/html`.
  - The upload modal hint says only `.xlsx`, `.txt`, and `.docx` are supported.
  - Unsupported-file error text also omits HTML.

Conclusion: local HTML files are mostly supported in code already, but the UI file selector and messaging do not expose them cleanly. Drag-and-drop may already work in some cases because dropped files bypass the file picker accept filter, but it is not explicit, tested, or polished.

## Goals

- Allow users to drag and drop `.html` or `.htm` files into the Add file drop target.
- Allow users to choose `.html` or `.htm` files from the file selector.
- Keep the source-language selection behavior the same as TXT/DOCX/HTML links.
- Preserve existing HTML link import behavior.
- Preserve HTML images correctly:
  - keep public internet images as URL-style image imports;
  - import non-public/local/embedded images through the existing image upload/storage path.
- Avoid changing the chapter data format unless local-file metadata needs a small source-origin improvement.

## Implementation Steps

### 1. Expose HTML in the upload UI

Update `src-ui/app/project-import-flow.js`:

- Add `.html`, `.htm`, and `text/html` to `PROJECT_IMPORT_ACCEPT`.
- Update the unsupported-file error string in `importProjectFile()` to include HTML.
- Consider extracting a shared `SUPPORTED_PROJECT_IMPORT_FORMATS_LABEL` string so the accept list, hint text, and error text do not drift again.

Update `src-ui/screens/project-import-modal.js`:

- Change the upload hint from:
  - `Supported formats: .xlsx, .txt, or .docx.`
- To include:
  - `.xlsx`, `.txt`, `.docx`, `.html`, `.htm`
- Keep the `.xlsx` language-code explanation unchanged.

### 2. Preserve a sensible source URL for local HTML files

Current local HTML imports call `import_html_to_gtms` with `sourceUrl: ""` unless the file came from a web link. That is acceptable for text extraction, but it means:

- relative image URLs in local HTML cannot be resolved;
- row metadata has an empty `sourceUrl`;
- behavior differs unnecessarily between link HTML and local-file HTML.

Clean implementation:

- When importing a dropped local path, pass a `sourceUrl` that identifies the file origin.
- Prefer a `file://...` URL for metadata if available from the native path.
- Preserve enough local path context for the backend to resolve relative image references safely.

Frontend details:

- For native path drops, `droppedPathImportFile(path)` can include:
  - `sourceUrl: pathToFileUrl(path)`
- Also preserve local origin information for backend use if needed:
  - `sourcePath`, or
  - `sourceDirectory`, derived from the dropped path.
- For `read_local_dropped_file`, preserve that `sourceUrl` when wrapping the returned bytes.
- For browser `File` objects from standard drag/drop or file picker, browser security usually does not expose a full path. Use an empty source URL or a synthetic value only if needed for metadata. Do not invent a fake web URL.

Backend detail:

- Confirm `Readability::new(html, Some(source_url), ...)` behaves cleanly with empty or `file://` source URLs. If it does not, normalize local/empty URLs before calling readability and rely on fallback extraction.
- Treat `sourceUrl` as metadata and URL resolution context, not as proof that any image is public.

### 3. Differentiate public image URLs from upload-style image imports

Current HTML import behavior stores supported image references as:

```json
{
  "kind": "url",
  "url": "https://example.com/image.jpg"
}
```

That is correct only when the image is reachable from the public internet without the user's local filesystem, browser session, VPN, or credentials. For non-public images, use the same stored-image/upload path used by editor image uploads, so the imported chapter owns a copy of the image.

#### Simple Image Rule

Keep this intentionally simple:

- If the image bytes are inside the HTML or readable from the local uploaded HTML file's folder, import it through the existing image upload/storage path.
- If the image is an absolute `http://` or `https://` URL, keep it as a URL-style image import.
- If the image is neither a public web URL nor locally readable, omit the image and preserve the caption/text row.

Apply that rule as follows:

- `data:` image -> decode and upload.
- relative image in local dropped/selected HTML -> resolve next to the HTML file and upload if readable.
- relative image in HTML imported from a web link -> resolve against the page URL and keep as URL-style `http(s)` if it resolves to `http(s)`.
- absolute `http(s)` image -> keep URL-style.
- `file:` image -> upload only if it resolves to a readable local file under the allowed local HTML folder; otherwise omit.
- `cid:` or `blob:` image -> omit.

Do not add network validation in this implementation. A public-looking `https://...` URL might still be private or expire later, but checking every URL adds latency, error cases, and policy complexity. The user can fix broken remote images later using the editor's normal image tools if needed.

This keeps the import behavior predictable:

- readable local/embedded image data becomes owned by the project;
- web URLs stay web URLs;
- unrecoverable images are skipped without failing the import.

#### Backend Implementation Shape

Keep the implementation close to `src-tauri/src/project_import/chapter_import/html.rs` unless it becomes too large. Add a helper that resolves one image source into one of three outcomes:

The resolver should return an enum-like result:

```rust
enum HtmlImageImport {
    PublicUrl { url: String },
    UploadedAsset { path: String, mime_type: String },
    Omitted { reason: HtmlImageOmitReason },
}
```

Map this to `ImportedFieldImage`:

- `PublicUrl` -> existing `kind: "url"`, `url: Some(...)`
- `UploadedAsset` -> existing upload-style shape, matching editor image uploads. Confirm the exact field image shape already used by editor image upload rows before coding.
- `Omitted` -> `image: None`, caption preserved if available.

Important import-writing detail:

- The editor upload path writes an uploaded image after a row already exists.
- HTML import creates row IDs while writing rows.
- Therefore, the HTML parser should not try to finalize uploaded image paths too early.
- Carry pending uploaded image data from parsing into `write_gtms.rs`, then after `row_id` is generated:
  - choose the upload-style relative image path using the same naming convention as editor image uploads;
  - write the image bytes to that path;
  - set the row field image to `kind: "upload"` with that repo-relative path;
  - include the image file in the same import git commit as the chapter and row files.

Do not store imported images in a separate one-off `package_assets` or `assets` convention unless the existing editor/export code already expects it. The goal is for imported images to behave exactly like images uploaded in the editor.

Implementation details:

- Decode `data:` images directly in Rust.
- Resolve local relative image paths only when the HTML source came from disk and the resolved path stays inside the HTML file's directory.
- Use the existing local file/image storage helper used by editor uploads if possible. Do not create a second image storage convention.
- Reuse existing image MIME/type validation from editor image upload code if available.
- Enforce max image byte size before writing.
- Do not fetch remote images during import. Absolute `http(s)` stays URL-style.
- Omit anything that cannot be locally read or represented as `http(s)`.
- Update the current HTML image tests that intentionally skip `data:` images so base64 image import is explicitly covered instead.

#### Frontend/API Changes

Extend `ImportHtmlInput` only as needed:

- `sourceUrl: String`
- optional `sourcePath` or `sourceDirectory` for local dropped files

For standard browser `File` uploads where no local path is available:

- `data:` images can still be uploaded because bytes are inside the HTML.
- absolute `http(s)` images can still be URL-style.
- relative images should be omitted without failing the import because there is no safe way to read sibling files.

#### Import Summary

Do not add image-summary UI in this first implementation. Keep the import rule simple and predictable:

- public URL images are kept;
- embedded/local readable images are uploaded;
- unrecoverable images are omitted without failing the import.

If users need diagnostics later, add concise optional summary counts after the core import path is stable.

### 4. Source-language selection

No design change needed:

- HTML already returns true from `importFileTypeNeedsSourceLanguage()`.
- A dropped `.html` file should open the source-language picker.
- After language selection, `continueProjectImportText()` should import it using `import_html_to_gtms`.

Regression tests should explicitly cover this for local files, not only HTML links.

### 5. Tests

Update `src-ui/app/project-import-flow.test.js`:

- Rename the file-type test to include HTML.
- Add assertions that `PROJECT_IMPORT_ACCEPT` includes:
  - `.html`
  - `.htm`
  - `text/html`
- Add/update the unsupported-file error test to include HTML in the supported-format message.
- Add a local HTML import test that:
  - starts from `importProjectFile()` with `article.html`;
  - verifies source-language selection opens;
  - selects a language;
  - verifies `import_html_to_gtms` is called with the chosen `sourceLanguageCode`;
  - verifies bytes are passed.
- Add a native dropped path test if coverage is missing:
  - `handleDroppedProjectImportPath()` calls `read_local_dropped_file`;
  - returned `article.html` proceeds to source-language selection;
  - source URL metadata is preserved if implemented.

Update `src-ui/screens/project-import-modal.test.js`:

- Assert the upload hint includes `.html` / `.htm`.
- Assert the Paste link text remains specific to Google Docs, Google Sheets, and HTML web pages.

Add or update Rust tests in `src-tauri/src/project_import/chapter_import/html.rs` only if implementation changes backend behavior:

- local/empty source URL parses readable HTML;
- `file://` source URL does not break extraction;
- `data:image/png;base64,...` image URLs become upload-style stored images;
- invalid or unsupported `data:` image URLs are omitted without failing the import;
- local relative image URLs become upload-style stored images when local path context is available;
- local relative image URLs are omitted without failing the import when local path context is unavailable;
- `file:` image URLs become upload-style stored images when allowed by the local path policy;
- `cid:` and unrecoverable `blob:` images are omitted without failing the import;
- absolute `http(s)` image URLs are stored as URL-style imports without fetching;
- path traversal attempts in relative image URLs are rejected.

Add or update Rust tests in `src-tauri/src/project_import/chapter_import/write_gtms.rs` if imported uploaded images are finalized during row writing:

- generated row JSON has `image.kind == "upload"` and a repo-relative `image.path`;
- decoded image bytes are written to that path;
- the uploaded image path uses the same convention as editor image uploads;
- the import commit stages the image file along with chapter/row files.

### 6. Manual QA

Run:

- `node --test --loader ./src-ui/test/raw-loader.mjs src-ui/app/project-import-flow.test.js src-ui/screens/project-import-modal.test.js`
- `cargo test project_import::chapter_import`
- `npm test`
- `npm run build`

Manual app check:

1. Open Projects.
2. Click Add files on a project.
3. Drag a simple `.html` file into the drop target.
4. Confirm the source-language picker appears.
5. Select a source language.
6. Confirm the imported chapter appears quickly.
7. Open the chapter and confirm headings, paragraphs, and image captions import as expected.
8. Test an HTML file with:
   - a base64 `data:` image;
   - a relative local image next to the HTML file;
   - a public `https://...` image;
   - a `cid:` or `blob:` image reference.
9. Confirm web images remain URL-style, readable local/embedded images become uploaded/stored images, and unrecoverable images are omitted without failing the import.

## Out of Scope For This Change

- Importing zipped HTML packages with local image folders.
- Preserving CSS layout from the original HTML.
- Importing arbitrary browser-only rendered HTML after JavaScript execution.
- Authenticated/private web pages beyond the current Paste link behavior.
- Recovering `blob:` URLs from a live browser session.
- Fetching remote images or verifying whether `http(s)` image URLs are truly public.
