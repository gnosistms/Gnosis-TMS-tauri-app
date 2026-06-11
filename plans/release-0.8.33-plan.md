# Release 0.8.33

Feature + hardening release. Headline: the editor's new Export options modal
with six file formats and multi-flavor clipboard copy. Underneath it, the
code-review remediation batches (8–11b) and the first Sentry-triage fixes.

## Included since 0.8.32

- #127 — Editor Export options modal, phases 1–2: replaces preview Copy HTML;
  Save to file (HTML, XLSX, DOCX, TXT, RTF, MD) via `export_gtms_chapter_file`,
  Copy and paste (plain text, HTML with simultaneous `text/html` +
  `text/plain` flavors). XLSX mirrors the import column layout across all
  chapter languages and round-trips through the importer; the project-screen
  export modal gains XLSX/RTF/MD too. Also scopes the editor close guard to
  the translate screen.
- #126 — Window close fixes: `core:window:allow-destroy` capability so the
  close button works; blocked-close surfacing with a force-close escape hatch.
- #121 — Export image fetch hardening: SSRF/DNS-rebinding protection with
  pinned validated addresses, no redirects, 25 MB body cap.
- #114, #116–#120, #122–#123, #125 — Code-review findings batches 8–11b:
  commit rollbacks on failure (chapter deletes, lifecycle writes, comments,
  single-file imports), git stdin pipe-deadlock fix, percent-decoding panic
  fix, link-import download cap, SVG dropped from the import image pipeline,
  HTML alignment-marker indexing (quadratic matching), corrupt chapter.json
  tolerance, comment row-id validation, metadata maintenance capability gate.
- #128 — Telemetry: stop reporting expected operational failures (Sentry W2).
- #129 — Team-metadata sync: recover from partial clones and untracked
  residue; name the fields that block an unsupported metadata merge (W4).

## Release validation focus

First release containing the export modal. After the build publishes:
- Exercise Save to file for all six formats on macOS and Windows (native
  dialog behavior), open the XLSX in Excel/Google Sheets and re-import it,
  open the RTF in Word, view the MD on GitHub.
- Clipboard copy into Word / Google Docs / a plain editor.
- Confirm off-editor window close is instant and translate-screen close
  latency is acceptable in the release build (close guard is now scoped;
  follow-up from the 0.8.32-era close-latency investigation).

## Pre-tag verification

- npm test: 1395/1395
- cargo test: 293/293 (Quality Check also green on PR #127: clippy strict + fmt)
- npm run audit:unused: clean
- Broker: main committed+pushed, /health 200

## Steps

1. Bump version to 0.8.33 in package.json, src-tauri/Cargo.toml,
   src-tauri/tauri.conf.json; refresh package-lock.json + Cargo.lock.
2. Commit "Release 0.8.33" on main, tag v0.8.33, push main + tag.
3. release-tauri.yml publishes; watch all three publish-tauri matrix jobs
   (macOS aarch64, macOS x86_64, Windows) to completion.
