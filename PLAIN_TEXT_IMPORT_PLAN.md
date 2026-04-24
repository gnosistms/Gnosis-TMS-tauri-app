# Plain Text Chapter Import

## Summary
Add `.txt` chapter import alongside `.xlsx`. TXT imports ask for the file's source language, then create a GTMS chapter where each non-blank line is one row, with exactly one source language and no target language. Opening a one-language chapter should automatically show Add / Remove Languages.

## Key Changes
- Accept `.xlsx`, XLSX MIME type, `.txt`, and `text/plain` in the project file picker and drop target.
- For TXT select/drop, store the pending file and show a source-language selection modal before importing.
- Add a Tauri TXT import command parallel to `import_xlsx_to_gtms`.
- Decode UTF-8, UTF-8 BOM, UTF-16LE BOM, and UTF-16BE BOM only; reject unsupported encodings without lossy replacement.
- Split decoded TXT into trimmed non-blank rows.
- Create GTMS TXT chapters with one source language, no target language, TXT source/origin metadata, and source word counts.
- Keep existing import completion behavior and avoid falling back to the source language as the target for TXT.
- On initial editor load, auto-open Add / Remove Languages for one-language files when the team can manage projects.

## Tests
- Frontend tests for type detection, accept string, modal copy/state, disabled Continue, cancel behavior, and no target fallback.
- Backend tests for TXT parsing, blank-line skipping, blank-only rejection, language validation, Unicode decoding, encoding rejection, and TXT metadata.
- Manual verification for picker/drop, source language prompt, one-language editor load, and unchanged XLSX import.
