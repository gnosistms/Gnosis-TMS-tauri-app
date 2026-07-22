# Typst PDF Export and Persistent Font Packs Plan

## Status

Core implementation completed 2026-07-21. This plan records the agreed direction
and the remaining hardening/follow-up work:

- Add one-click, chapter-level PDF export to the existing export modal.
- Generate PDF with a pinned Typst compiler bundled with Gnosis TMS.
- Do not bundle the multilingual print fonts in every app installer.
- Download only the font pack required by the selected export language, after an
  explicit user action, and persist it outside the application bundle so normal app
  updates do not download it again.
- Keep EPUB as a separate HTML/XHTML-based feature; Typst is the PDF renderer only.

## Goal

Export the selected chapter language to a polished, deterministic, self-contained PDF
from both the editor and projects-page export entry points. The user chooses `PDF`,
chooses a save path, and receives a PDF without installing Typst, LaTeX, or fonts.

The first PDF export for a script may download a clearly disclosed font pack. Once a
pack is installed, exports using that pack must work offline and the pack must survive
application updates.

## Product Decisions

1. **Typst, not LaTeX, is the bundled PDF engine.** It is a single compiler binary,
   requires no TeX package tree, and natively supports PDF, Unicode shaping, CJK,
   right-to-left text, images, figures, links, and real page footnotes.
2. **Render directly from `ExportDocument`.** Do not serialize the chapter to Markdown
   and parse it again. The existing intermediate model carries richer semantics than
   Markdown and already feeds HTML, DOCX, RTF, TXT, and Markdown exporters.
3. **Use the same serif families already used by Gnosis TMS.** PDF export mirrors the
   editor/preview serif-family selection for each language. Production export passes
   the full variable TTF counterparts through an explicit font path and disables
   system-font discovery so macOS and Windows produce the same typography.
4. **Font downloads are on demand, not at startup.** Selecting or submitting PDF shows
   the exact required download and byte count. No silent Google/font-network request is
   made merely because the app launched.
5. **Google Fonts is both the upstream source and the initial download host.** Released
   clients fetch immutable raw files from an exact `google/fonts` commit and verify
   the pinned byte length and SHA-256 before installation. These URLs can later move
   to Gnosis-controlled release assets without changing the catalog/cache contract;
   mutable Google Fonts CSS endpoints are never used.
6. **The first version exports one chapter/language.** Whole-project/book PDF export,
   cover pages, a generated table of contents, user templates, and arbitrary `.typ`
   input are out of scope.
7. **PDF is a read operation.** It does not modify a content repository, require write
   permission, or create a git commit. It still waits for the relevant repo write queue
   to become idle before reading the chapter snapshot, matching existing file exports.
8. **Initial page design matches current print output.** Use US Letter, one-inch
   margins, a restrained serif layout, and the existing heading/quote/center/indent
   semantics. Page-size and typography controls may be added later without changing
   the compiler boundary.

## Font Family Requirement

PDF output uses the same serif family choices already defined in
`src-ui/styles/base.css`; this is a fixed product requirement, not a suggested initial
font theme:

| Gnosis serif CSS family | PDF TTF counterpart | Language/script |
|---|---|---|
| `Noto Serif Variable` | Noto Serif | Latin, Vietnamese, Cyrillic, Greek and Latin fallback |
| `Noto Serif JP Variable` | Noto Serif JP | Japanese |
| `Noto Serif SC Variable` | Noto Serif SC | Simplified Chinese |
| `Noto Serif TC Variable` | Noto Serif TC | Traditional Chinese |
| `Noto Serif KR Variable` | Noto Serif KR | Korean |
| `Noto Naskh Arabic Variable` | Noto Naskh Arabic | Arabic and Persian |

The first release does not add a PDF font picker or substitute a different print
typeface. Body text, headings, captions, and footnotes inherit the applicable Gnosis
serif family, weight, and italic behavior. Latin runs inside CJK or Arabic/Persian
documents use Noto Serif as the fallback, matching the intent of the existing CSS
font stacks.

The packaged files are full variable TTF counterparts from the same upstream Noto
families. They are not byte-identical to the app's WOFF2 files because the existing UI
assets are browser-specific Unicode-range subsets that Typst cannot load directly.

## Font Pack Catalog

Use variable TTF files so regular and bold weights come from one file. Latin also
needs the italic variable face because Gnosis supports inline italics. Sizes below are
the upstream raw file sizes observed in `google/fonts` on 2026-07-21; the generated
manifest is authoritative.

| Pack id | Contents | Raw bytes (approximately) | Used by |
|---|---|---:|---|
| `noto-serif-core-v1` | Noto Serif Roman + Italic variable TTF | 4.34 MB | Latin, Vietnamese, Cyrillic, Greek; dependency of other packs |
| `noto-naskh-arabic-v1` | Noto Naskh Arabic variable TTF | 0.31 MB | Arabic and Persian |
| `noto-serif-jp-v1` | Noto Serif JP variable TTF | 13.57 MB | Japanese |
| `noto-serif-sc-v1` | Noto Serif SC variable TTF | 25.13 MB | Simplified Chinese |
| `noto-serif-tc-v1` | Noto Serif TC variable TTF | 16.85 MB | Traditional Chinese |
| `noto-serif-kr-v1` | Noto Serif KR variable TTF | 23.80 MB | Korean |

Script packs depend on `noto-serif-core-v1` so Latin text embedded in a CJK or
Arabic/Persian chapter has consistent typography. Expected first-use totals are about
4.3 MB for Latin/Vietnamese, 4.6 MB for Arabic/Persian, 17.9 MB for Japanese, 29.5 MB
for Simplified Chinese, 21.2 MB for Traditional Chinese, and 28.1 MB for Korean before
HTTP/archive overhead.

The existing `src-ui/assets/fonts-variable/**` WOFF2 files remain the UI font source.
They are browser-specific Unicode-range subsets and Typst does not discover them as
fonts; do not attempt to decompress and merge hundreds of partial faces at runtime.
The full TTF downloads must stay on the same reviewed Noto family/version line as the
corresponding Gnosis UI fonts unless a deliberate typography upgrade changes both.

## Architecture

```text
Export modal (PDF selected)
        |
        v
local readiness query ----> installed pack manifest + hashes
        |
        v
save dialog -> start PDF export job -> immediate job id
                          |
                          +-> resolve chapter snapshot after repo queue is idle
                          +-> install missing immutable font pack atomically
                          +-> resolve/download/normalize document images
                          +-> ExportDocument -> controlled Typst source
                          +-> bundled Typst sidecar -> temporary PDF
                          +-> atomically finalize chosen output path
                          +-> progress/completion event
```

### Backend module boundaries

The initial implementation keeps the PDF job lifecycle, controlled Typst serializer,
sidecar invocation, and font catalog/cache together in `pdf_export.rs`. The existing
`chapter_export.rs` remains the shared export-document owner and exposes only the
small internal surface PDF needs. Split the PDF module into `typst_render.rs`,
`typst_runtime.rs`, and `pdf_font_packs.rs` if those components grow independently.
Shared remote-image fetching continues to use the existing SSRF and byte-limit
protections rather than introducing another network path.

Re-export only the command inputs/starters needed by `project_import.rs`. Register new
commands once in `lib.rs`.

### Frontend ownership

- `editor-export-flow.js` keeps ownership of the export catalog and user intent.
- `state.editorChapter.exportModal` keeps ephemeral PDF readiness/job/progress/error
  fields; this is editor session state, not resource collection state, so it does not
  go through TanStack Query.
- `editor-export-modal.js` renders the required download disclosure and progress.
- A small event bridge in the export flow listens only while its job is active and
  ignores events for stale job ids/chapters.
- No project, glossary, or QA collection state is changed by this feature.

## Phase 1 — Reproducible Typst Sidecar

### Pin and stage the compiler

- Pin one reviewed Typst version and record release URLs plus SHA-256 hashes per
  supported target (macOS arm64/x64 and Windows x64; Linux best-effort).
- Add `scripts/prepare-typst-sidecar.mjs` to download, hash-verify, extract, and name
  the binary exactly as Tauri expects for the target triple.
- Package it through Tauri's `bundle.externalBin`/sidecar mechanism so the correct
  target binary is included and macOS signing/notarization covers it.
- Prefer invoking the sidecar from Rust. If `tauri-plugin-shell` is required for
  sidecar resolution, do not grant frontend shell-execution permissions; JS must only
  call the purpose-built PDF commands.
- Release CI must run the preparation script before `tauri build` and fail if the
  expected compiler version/hash is absent.
- Local development supports either the prepared sidecar or an explicit
  `GNOSIS_TYPST_BIN` override. A packaged build must never fall back to an arbitrary
  system Typst.

### License and release integration

- Extend `scripts/generate-third-party-notices.mjs` with the pinned Typst binary and
  the Noto font/OFL notices; external binaries/assets are not found by Cargo/npm
  scanners.
- Store upstream source/version/license metadata beside the artifact manifest.
- Verify commercial redistribution requirements during implementation and keep
  Apache-2.0/OFL license texts in shipped notices and downloaded pack directories.

### Acceptance criteria

- Each release runner reports the exact pinned `typst --version` before bundling.
- Signed macOS and Windows packages can invoke the bundled binary after installation.
- Removing/corrupting the packaged binary produces a specific PDF-support error and
  never falls back silently.
- The measured per-platform updater/installer increase is recorded in this plan when
  implemented.

## Phase 2 — Versioned Font-Pack Build and Persistent Cache

### Pack production

- Add `scripts/build-pdf-font-packs.mjs` with a checked-in source manifest containing:
  upstream commit, exact source URL, source SHA-256, OFL metadata, output pack id,
  dependencies, and language/script mapping.
- Fetch only the approved TTF files from the pinned upstream commit.
- Package each pack as an immutable archive containing its fonts, `OFL.txt`, and a
  machine-readable inner manifest with individual file hashes.
- Produce a signed/reviewed runtime catalog containing pack URL, archive SHA-256,
  archive byte count, unpacked byte count, contained font hashes, dependencies, and
  minimum catalog version.
- Publish packs under immutable versioned URLs. Do not overwrite an existing pack id.

### Persistent storage

Use `app_data_dir/pdf-fonts/` (not the application bundle, temp directory, project
repo, or Tauri key-value store):

```text
pdf-fonts/
  catalog-v1/
    noto-serif-core-v1/<archive-sha>/
      manifest.json
      OFL.txt
      *.ttf
    noto-serif-sc-v1/<archive-sha>/
      ...
```

- `inspect_pdf_font_support(languageCode)` is local-only and returns required packs,
  missing packs, total download bytes, installed state, and a stable catalog version.
- Validate an installed pack by manifest and individual file hashes before use. File
  existence alone is insufficient.
- Serialize concurrent installation attempts per pack so two exports never perform
  duplicate downloads or race the destination.
- Download to a unique sibling staging directory, cap bytes against the catalog,
  require HTTPS, apply connection/read timeouts, hash while streaming, unpack with
  path-traversal protection, validate contents, then atomically rename into place.
- Clean abandoned staging directories opportunistically. Never delete a valid old
  pack until a replacement is fully installed and selected.
- Cache validation and installed exports work offline. A missing pack while offline
  returns an actionable message explaining that one initial download is required.
- Expected cancellation, offline state, and checksum failure are user-facing control
  flow and must not be sent as telemetry errors.

### Language routing

- Reuse canonical language/base-code normalization already used by chapter export.
- Route `ja` -> JP, `zh-Hans`/Simplified variants -> SC,
  `zh-Hant`/Traditional variants -> TC, `ko` -> KR, and `ar`/`fa` -> Naskh Arabic.
- All other currently supported Latin/Cyrillic/Greek/Vietnamese codes use core.
- Unknown codes default to core only if every code point can be rendered; otherwise
  fail preflight with a missing-coverage error rather than emitting tofu boxes.
- Add a coverage preflight over the chapter's Unicode scalar values against the
  selected font cmaps because Typst does not yet guarantee missing-glyph warnings.

### Acceptance criteria

- A successful pack remains available after simulated app-version changes.
- Corruption triggers a fresh verified install, never use of corrupted data.
- Interrupted and concurrent downloads leave either the prior valid pack or a complete
  new pack, never a partially installed directory.
- Tests use a local fake HTTP server and tiny fixture fonts/packs; unit tests never
  depend on Google or GitHub availability.

## Phase 3 — Restricted Typst Renderer and PDF Job

### Renderer mapping

Implement pure, deterministic mappings with unit tests:

| Gnosis structure | Typst output |
|---|---|
| Chapter title | document title/first heading |
| Paragraph | normal paragraph |
| Heading 1 / Heading 2 | semantic Typst headings and PDF outline entries |
| Quote | quote block |
| Indented / centered | styled block/alignment |
| Separator | divider/rule |
| Bold / italic / underline | strong/emphasis/underline |
| Link | clickable `link` |
| Image + caption | in-flow figure, proportional `contain`, numbering disabled |
| Row footnote | native `footnote` marker attached after the row's final content |

- Escape every Typst-significant character. User text is content, never executable
  Typst code.
- Do not pass raw custom HTML to Typst. Reuse the existing print custom-HTML policy:
  omit it when `omitCustomHtml` is checked, otherwise flatten it to visible text.
- PDF footnote links remain clickable. When the existing
  `footnoteLinksAsPlainText` option is enabled, also append the printable URL using the
  existing skip rule for URL-as-link-text.
- Set document `lang`, region/script where needed, and dominant RTL direction for
  Arabic/Persian before any content.
- Select explicit font families from the installed pack. Disable system fonts.
- CJK has no conventional italic face in these packs; document and test the chosen
  emphasis fallback (retain normal CJK glyphs while preserving semantic emphasis;
  Latin runs may use the bundled italic face).

### Images

- Uploaded images are copied from the repo into the temporary workspace.
- URL images are downloaded before compilation through the existing public-image
  security policy and `MAX_EXPORT_IMAGE_BYTES` cap; Typst receives local paths only.
- Pass through Typst-supported PNG, JPEG, static GIF, WebP, and safe SVG.
- Normalize APNG/AVIF/BMP/ICO or any other accepted Gnosis format to a supported
  static format with pixel-count/decompression-bomb limits. If a secure decoder is not
  available for a format, fail with an actionable image-specific error rather than
  silently dropping it.
- Scale figures to printable width/height with `fit: "contain"`; keep captions with
  images and move a non-fitting figure to the next page.
- Add alt text when the content model gains it; captions must not be repurposed as alt
  text.

### Compiler sandbox and lifecycle

- Create a unique temporary working directory containing only generated Typst source,
  resolved images, and the selected font directories exposed read-only where possible.
- Invoke the pinned compiler with explicit input/output paths, `--root` restricted to
  the workspace, `--ignore-system-fonts`, and explicit `--font-path` arguments.
- Generate no package imports, plugins, arbitrary file reads, or user-controlled Typst
  source. Do not enable shell execution.
- Apply a bounded compile timeout and terminate the child on timeout/cancellation.
- Capture bounded stdout/stderr; translate known diagnostics into user-facing errors
  and scrub internal paths from displayed errors/telemetry.
- Compile to a temporary PDF, validate the `%PDF-` signature and non-zero size, then
  atomically replace the selected destination. A failed export must not truncate an
  existing destination PDF.
- Remove temporary workspaces on success and best-effort on failure.

### Background job contract

Add a dedicated command rather than making the existing synchronous-format command
perform a long network operation:

```text
start_gtms_chapter_pdf_export(input) -> { jobId }
event: chapter-pdf-export-progress
payload: { jobId, stage, completedBytes?, totalBytes?, message?, outputFileName? }
```

Stages: `preparing`, `downloading-fonts`, `preparing-images`, `typesetting`,
`finalizing`, `completed`, `failed`. The command validates and returns immediately;
the worker owns download/compile work and emits progress. Event emission failures do
not corrupt output but are handled consistently with other background jobs.

The input reuses installation/repo/project/chapter/language/output fields and print
options from `ExportChapterFileInput`. The worker reads only after the frontend has
waited for `waitForRepoWriteQueueIdle`.

### Acceptance criteria

- Every existing `ExportBlock` variant and supported inline style has a renderer test.
- Generated source cannot be escaped by Typst syntax embedded in chapter text, links,
  captions, footnotes, titles, or file names.
- A representative document compiles without network access once fonts are installed.
- Existing destination files survive failed compile/download attempts unchanged.

## Phase 4 — Export Modal Integration

### Catalog and state

- Add `{ id: "file:pdf", label: "PDF", kind: "file", format: "pdf",
  available: true, printLinkFallback: true, omitCustomHtmlOption: true }` to the file
  catalog.
- Extend `exportFileFilter` with `PDF document` / `.pdf`.
- Extend modal state with PDF readiness, required/missing packs, download byte count,
  job id, stage, and byte progress. Reset job-scoped state when opening another chapter.
- Preserve the last successful PDF option through the existing export-default storage.

### User experience

- When PDF is selected, inspect readiness for the selected export language.
- Installed state: `Click Save to export a PDF document.`
- Missing pack state: disclose pack name and exact size, for example
  `Japanese print fonts (17.9 MB) will be downloaded once and kept for future exports.`
- The submit label becomes `Download and save` when required and `Save` when installed.
- The normal native save dialog chooses the destination. Starting the worker closes no
  UI; the modal shows determinate download progress when byte totals are known and
  named stages afterward.
- Do not disable unrelated editor/project actions while font download or compilation
  runs. Only prevent duplicate submission/closing of the active export operation under
  the modal's existing busy-state rules.
- Completion closes the modal and shows the existing exported-file notice. Failure
  leaves it open with a retryable, actionable error.
- Ignore late progress events whose job id no longer matches the active export.

### Acceptance criteria

- PDF is available from both the open editor and projects page with the same language
  behavior as DOCX/HTML.
- XLSX continues to hide the language picker; PDF shows it where existing single-
  language file formats do.
- Switching export language updates the required pack and disclosed byte count.
- Canceling the save dialog does not start a download.
- Canceling or failing an export does not change the stored successful default.

## Phase 5 — Verification and Rollout

### Automated frontend tests

- `editor-export-flow.test.js`: PDF catalog/filter/default filename, readiness query,
  installed versus missing state, save cancellation, repo-queue wait, job start,
  progress correlation, completion/failure, and stored-default behavior.
- `editor-export-modal.test.js`: download disclosure, exact formatted byte count,
  installed copy, busy stages, determinate progress, retry error, language changes,
  and existing omit-custom-HTML/footnote-link options.
- Event/action/input-handler tests ensure listener cleanup and no stale-job mutation.

### Automated Rust tests

- Font catalog parsing, language routing, dependency closure, cmap coverage, size caps,
  HTTPS/redirect policy, checksum failure, traversal rejection, atomic installation,
  corruption recovery, concurrent ensure calls, and offline installed/missing cases.
- Typst escaping and mappings for every block/inline style, RTL metadata, custom HTML,
  footnote links, images/captions, and unsupported image errors.
- Runtime resolution/version mismatch, timeout/termination, bounded diagnostics,
  temporary cleanup, atomic output replacement, and progress-stage ordering.
- A release-only integration suite runs the pinned sidecar against fixture packs and
  documents for English, Vietnamese, Japanese, Simplified Chinese, Traditional
  Chinese, Korean, Arabic, and Persian.

### PDF artifact verification

- Assert valid PDF signature, page count, extractable Unicode text, clickable links,
  outline entries, native footnotes, embedded font names, and no missing glyphs.
- Render representative PDFs to PNG in CI/manual QA and compare or review pages for
  clipping, line breaking, RTL punctuation, CJK punctuation/line breaks, image scaling,
  captions, footnote overflow, and page boundaries.
- Include adversarial fixtures: Typst metacharacters, extremely long words/URLs,
  mixed-direction text, emoji, missing/corrupt images, oversized dimensions, many
  footnotes, and a footnote that crosses a page.

### Manual release matrix

- macOS arm64 and Intel; Windows x64; Linux best-effort.
- Clean install first font download, download interruption/retry, simultaneous export
  attempts, offline repeat export, app update with fonts retained, font-pack upgrade,
  uninstall/reinstall expectations, and destination overwrite behavior.
- Verify sidecar signing/notarization and that antivirus/endpoint protection does not
  quarantine it.
- Record actual installer delta, per-pack transfer size, installed cache size, first
  export duration, repeat export duration, and representative PDF size before rollout.

## Files Expected to Change

The exact split may adjust during implementation, but scope should remain within:

- `plans/typst-pdf-export-plan.md`
- `src-ui/app/editor-export-flow.js` and tests
- `src-ui/app/state.js`
- `src-ui/screens/editor-export-modal.js` and tests
- export event/action wiring modules already used by the modal
- `src-tauri/src/project_import.rs`
- `src-tauri/src/project_import/chapter_editor/mod.rs`
- `src-tauri/src/project_import/chapter_editor/chapter_export.rs` (shared-model/image
  extraction only)
- new backend PDF/font/Typst modules described above and their tests
- `src-tauri/src/lib.rs`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml` / lockfile only for narrowly required runtime/image support
- `scripts/prepare-typst-sidecar.mjs`
- `scripts/build-pdf-font-packs.mjs`
- `scripts/generate-third-party-notices.mjs`
- release/quality workflows and generated third-party notices

Do not modify glossary/QA resource flows, repo schemas, chapter storage schemas, or
project synchronization behavior for this feature.

## Release Gates

- [ ] Typst version and all artifact hashes are pinned and reproducible.
- [ ] External binary and font licenses appear in shipped notices.
- [ ] Font download is explicit, size-disclosed, checksum-verified, atomic, and cached
      under app data.
- [ ] Installed packs survive an application update and work offline.
- [ ] No system fonts or mutable remote assets affect production PDF output.
- [ ] PDF generation cannot read arbitrary local files or execute user-controlled Typst.
- [ ] All supported Gnosis language families render without tofu/missing glyphs.
- [ ] Images, captions, inline formatting, real footnotes, links, and custom-HTML policy
      match the agreed export behavior.
- [ ] Existing HTML/DOCX/XLSX/TXT/RTF/Markdown/clipboard/WordPress/team exports pass
      regression tests unchanged.
- [ ] macOS and Windows signed release artifacts pass the manual matrix.
- [ ] Actual download and installed-size measurements replace the planning estimates.

## Post-review remediation (implemented 2026-07-21)

The initial implementation review identified five release-blocking gaps. Complete these
before treating PDF export as production-ready:

1. [x] Gate documents that require scripts outside the initial Noto font catalog, then
   validate every printable character against the installed TTF cmap before invoking
   Typst. The initial supported set is Latin/Vietnamese, Greek, Cyrillic,
   Arabic/Persian, Japanese, Korean, and Simplified/Traditional Chinese.
2. [x] Convert valid, unescaped `[n]` references into native Typst footnotes at their exact
   positions, including references in the middle of paragraphs. Preserve unmatched and
   escaped markers literally.
3. [x] Add a local font-readiness command and show the exact missing download size before
   Save can start an export. Cached fonts must report that no download is required.
4. [x] Keep PDF Cancel available. Cancellation must reach preparation, downloads, and the
   compiler; Typst compilation must have a bounded two-minute timeout and terminate the
   child process on cancellation or timeout.
5. [x] Move image resolution and temporary-workspace writes to a blocking worker. Resolve
   at most four unique images concurrently and reuse duplicate image URLs/paths within
   one export job.

## Progress and cancellation follow-up (2026-07-21)

- [x] Report determinate byte progress while fonts download.
- [x] Report determinate item progress while unique images are resolved and prepared.
- [x] Report an explicitly indeterminate typesetting stage because the Typst CLI does
  not expose page-by-page compile progress.
- [x] Report final save progress and render all stages through one accessible progress
  component in the export modal.
- [x] Keep the PDF Cancel action enabled from the repo-queue wait through font/image
  preparation and Typst compilation, while preventing cancellation races before the
  backend job registers.

## Paper size and image-caption follow-up (2026-07-21)

- [x] Offer standard ISO and North American paper sizes in the PDF export pane,
  defaulting to US Letter.
- [x] Validate the selected identifier in both the frontend and Rust backend before
  inserting it into generated Typst source.
- [x] Render PDF image captions in italic type while preserving their inline markup.
- [x] Add request-wiring, modal, Typst-source, and paper-size validation tests.
