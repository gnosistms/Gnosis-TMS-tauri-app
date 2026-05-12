# Paste Link Import Plan

## Summary

Implement the Paste link path in the Add file modal. The user pastes a URL, clicks `Continue`, and the app detects whether it is a public Google Doc, Google Sheet, or HTML web page. Google Docs are downloaded as DOCX and imported through the existing DOCX path. Google Sheets are downloaded as XLSX and imported through the existing XLSX path. HTML pages are fetched, cleaned with a Reader Mode-style extractor, converted into structured editor rows, and imported through a new HTML import path.

References:
- Google sharing wording uses "Anyone with the link": https://support.google.com/drive/answer/2494822
- Firefox Reader View uses Mozilla Readability: https://github.com/mozilla/readability
- Chrome Reader Mode uses DOM Distiller: https://chromium.googlesource.com/chromium/src/+/364c3ff44d9e91d8d69e293e6c24db72360777fa/docs/accessibility/browser/reader_mode.md

## Key Implementation Changes

### UI and State

- In `projectImport`, add:
  - `linkUrl: ""`
  - `linkErrorModal: null | "accessDenied" | "invalid"`
  - `status: "idle" | "error" | "resolvingLink" | "importing" | "selectingSourceLanguage"`
- Replace the Paste link coming-soon panel with:
  - A text input marked with `data-project-import-link-input`.
  - Hint text: `Paste link here. Supports Google Docs, Google Sheets, and HTML web pages.`
  - A `Continue` button using `data-action="submit-project-import-link"`.
- Disable `Continue` until `linkUrl.trim()` is non-empty.
- While `status === "resolvingLink"`, disable segmented control, input, Cancel, and show `Opening...` on Continue.
- Add `updateProjectImportLinkUrl(render, value)` and wire it through `input-handlers.js`.
- Reset `linkUrl` and `linkErrorModal` when opening/canceling the modal or switching away from Paste link.

### Link Resolution Flow

- Add `submitProjectImportLink(render)` in `project-import-flow.js`.
- On submit:
  - Validate the pasted value is an absolute `http` or `https` URL.
  - Set `status: "resolvingLink"` and call Tauri command `resolve_project_import_link`.
  - Convert the response into an existing file-like object:
    - `{ name, dataBase64 }`
  - If the resolved file type is `docx` or `html`, call `importProjectFile`; it will open the existing source-language picker.
  - If the resolved file type is `xlsx`, call `importProjectFile`; it imports immediately.
- Extend `detectImportFileType()` to recognize `.html`.
- Extend `PROJECT_IMPORT_ACCEPT` only if Upload should accept HTML later. For this feature, HTML is link-only, so no upload accept change is required.
- Extend `importFileTypeNeedsSourceLanguage()` so `html` behaves like `txt` and `docx`.
- Extend `importProjectFileResult()` to call new Tauri command `import_html_to_gtms` for `html`.

### Tauri Link Resolver

- Add command `resolve_project_import_link(input: ResolveProjectImportLinkInput)`.
- Input:
  - `{ url: String }`
- Output:
  - `{ fileType: "docx" | "xlsx" | "html", fileName: String, dataBase64: String, sourceUrl: String }`
- Google Docs detection:
  - Match host `docs.google.com`.
  - Match path `/document/d/{document_id}/...`.
  - Download `https://docs.google.com/document/d/{document_id}/export?format=docx`.
  - Return `fileType: "docx"` and file name from document title if discoverable, otherwise `google-doc.docx`.
- Google Sheets detection:
  - Match host `docs.google.com`.
  - Match path `/spreadsheets/d/{spreadsheet_id}/...`.
  - Download `https://docs.google.com/spreadsheets/d/{spreadsheet_id}/export?format=xlsx`.
  - Return `fileType: "xlsx"` and file name from sheet title if discoverable, otherwise `google-sheet.xlsx`.
- HTML website detection:
  - Any non-Google `http` or `https` URL is treated as candidate HTML.
  - Fetch with existing `reqwest` dependency.
  - Require successful status and `Content-Type` compatible with `text/html`, or HTML-looking body beginning with `<!doctype html`, `<html`, or containing `<body`.
  - Return `fileType: "html"` and `fileName` from URL slug or `<title>`, ending in `.html`.

### Link Error Classification

- Access-denied Google file maps to `linkErrorModal: "accessDenied"` when:
  - HTTP status is `401` or `403`.
  - Redirect target host is `accounts.google.com`.
  - HTML response includes Google access text such as `You need access`, `Request access`, or sign-in prompts.
- Access denied modal:
  - Eyebrow: `FILE NOT SHARED PUBLICLY`
  - Title: `Please share this file with everyone`
  - Message: `Please open this file in your web browser and share it to "Anyone with the link".`
  - Buttons: `Cancel` and `Retry`
- `Retry` action re-runs `submitProjectImportLink(render)` with the existing `linkUrl`.
- Any other resolver failure maps to `linkErrorModal: "invalid"`.
- Invalid link modal:
  - Eyebrow: `INVALID LINK`
  - Title: `This link can not be opened`
  - Message: `This link is not readable. The exact reason is unknown. Note that only Google Docs, Google Sheets, and HTML website links are supported.`
  - Button: `Cancel`

### HTML Reader Mode Extraction

- Add Rust dependencies:
  - `readabilityrs = "0.1.3"` for Mozilla Readability-style extraction.
  - `scraper = "0.25"` for deterministic traversal of the extracted HTML fragment.
- Add `ImportHtmlInput`:
  - Same fields as `ImportTxtInput`, plus `sourceUrl: String`.
- Add `import_html_to_gtms` command and `parse_html_file(input)`.
- `parse_html_file` steps:
  1. Decode bytes as UTF-8, using the same BOM handling style as TXT where applicable.
  2. Run `readabilityrs::Readability::new(html, Some(source_url), Some(options)).parse()`.
  3. Reject if Readability returns no article or if extracted text is under 200 non-whitespace characters.
  4. Parse `article.content` as an HTML fragment with `scraper`.
  5. Recursively walk the fragment in DOM order.
  6. Skip `script`, `style`, `noscript`, `nav`, `footer`, `header`, `form`, `aside`, `svg`, `canvas`, and hidden/template-like content.
  7. Convert blocks to rows:
     - `h1` -> `text_style: "heading1"`
     - `h2` through `h6` -> `text_style: "heading2"`
     - `blockquote` -> `text_style: "quote"`
     - `p`, `pre`, and readable standalone text blocks -> `text_style: "paragraph"`
     - `li` -> `text_style: "paragraph"` with text prefixed by `- ` unless already bullet-prefixed.
  8. Normalize whitespace by collapsing runs of spaces/tabs, preserving meaningful line breaks inside `pre` only.
  9. If `article.title` exists and the first extracted row is not the same normalized text, insert it as the first `heading1` row.
  10. Reject if no rows remain after normalization.
- Add `HtmlRowMetadata` and `html_metadata` on imported rows.
- Write `format_metadata.html` for HTML rows:
  - `source_url`
  - `block_kind`
  - `block_index`
  - `original_tag`
- Do not import website images in v1.

### HTML Fallback When Readability Fails

- If Readability fails, attempt one conservative fallback before showing invalid link:
  - Parse original HTML with `scraper`.
  - Candidate containers: `article`, `main`, `[role="main"]`.
  - Score each candidate by text length, paragraph count, and low link density.
  - Use the best candidate only if it has at least 500 non-whitespace characters and at least 2 paragraph-like blocks.
- Do not import raw `<body>` as a fallback, because it risks importing navigation, ads, and footer content.

### XLSX Validation Improvements

Improve XLSX parser errors so Google Sheets failures tell the user exactly what to fix. Apply these messages to both pasted Sheets links and uploaded XLSX files:

- Empty file: `The selected workbook is empty.`
- Cannot open workbook: `Could not open the workbook. Make sure the Google Sheet can be exported as XLSX and try again.`
- No worksheets: `The workbook does not contain any worksheets. Add a sheet with language-code headers in the first row.`
- First worksheet unreadable: `Could not read the first worksheet.`
- Missing header row: `The first worksheet is missing a header row. Add supported language codes to row 1, such as es, en, vi, zh-Hans, or zh-Hant.`
- Blank header cell: `Column {n} in row 1 is blank. Every imported column must start with a supported language code.`
- Unsupported header: `Column {n} in row 1 has unsupported language code "{value}". Use supported codes such as es, en, vi, zh-Hans, or zh-Hant.`
- No valid language columns: `Could not detect any language columns in row 1. Add supported language codes such as es, en, vi, zh-Hans, or zh-Hant.`
- No rows below header: `The workbook has valid language headers, but no importable text rows below row 1.`
- Duplicate language codes remain supported using the existing unique duplicate-column behavior.

## Test Plan

- UI tests:
  - Paste link tab renders input, hint, and disabled Continue when empty.
  - Continue enables after typing a URL.
  - Resolving state disables controls and shows loading copy.
  - Access denied modal renders exact copy and `Cancel | Retry`.
  - Invalid link modal renders exact copy and Cancel.
- JS flow tests:
  - Docs link resolver result creates a `.docx` pending file and opens source-language picker.
  - Sheets link resolver result creates a `.xlsx` file and calls `import_xlsx_to_gtms`.
  - HTML link resolver result creates a `.html` pending file and opens source-language picker.
  - Retry reuses the existing `linkUrl`.
  - Resolver access-denied and invalid errors map to the correct modal state.
- Rust resolver tests:
  - Detect normal Google Docs and Sheets share URLs.
  - Generate correct export URLs.
  - Map 401/403, Google sign-in redirects, and Google access-denied pages to access denied.
  - Reject unsupported schemes and unreadable non-HTML pages as invalid links.
- Rust import tests:
  - HTML import maps `h1`, `h2`, `blockquote`, `p`, and `li` into correct row text styles.
  - Readability extraction removes nav/ad/sidebar content from representative HTML.
  - Fallback uses `article` or `main` only when it passes minimum text and paragraph thresholds.
  - XLSX header validation returns the new detailed messages.
- Full verification:
  - `npm test`
  - `cargo test`
  - `npm run build`

## Assumptions

- Paste text remains coming soon.
- Private Google Drive access through OAuth is out of scope; only public "Anyone with the link" files are supported.
- Link detection happens on `Continue`, not while typing.
- HTML website imports focus on readable text and block styles; images and tables are out of scope for v1.
