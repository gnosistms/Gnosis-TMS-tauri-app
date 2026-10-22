# Research export destination and tooltip

Replace the research export's browser download with the existing native Save dialog pattern. Show a JSON filter and a readable suggested filename, then save the existing complete JSON export at the chosen path through Rust. Cancel must do no export read/write, repeated clicks must not open multiple dialogs, and exporting during running research must not clear the research busy state or change its retry/error pointers. Keep export failures separate from research-stage failures. Retain existing research data and export content.

Use the shared secondary-button tooltip option with the user's exact text: “export a summary of the data uncovered during the research process in a JSON format appropriate for sending it to an AI for further discussion.”

Steps:
1. Add a storage export operation that expands the saved JSON evidence and writes it atomically to the selected absolute file path. Reuse the existing JSON writer and storage command boundary; no frontend filesystem access.
2. Add the Save dialog and duplicate-click guard to the export action, with cancellation and success/error feedback; keep the owning study revision current. Apply the tooltip to every Export research button through the shared button helper.
3. Verify picker arguments, selected path, cancellation, concurrent research, error isolation, full JSON preservation and tooltip attributes with focused tests. Run lint/build and native checks where the existing disk-space guard permits them. No AI calls are needed.

## Verification

- 38 focused query/render tests and five browser checks pass. They cover the selected JSON path, native dialog arguments, exact shared tooltip, cancellation without export work, duplicate-click suppression, independent research/error state, timing exports and full evidence exports.
- ESLint, frontend production build, Rust formatting/syntax parsing and diff whitespace checks pass. No paid AI calls or changes to real research studies were used.
- Added a native regression that writes expanded piecewise JSON to a chosen file and verifies the source study remains unchanged. Native compilation/tests and packaging could not run: the existing cache guard reports 13.7 GiB free against the 30 GiB floor, with 16.5 GiB protected by running Rust binaries. The running bundled app will need the new native export operation through a rebuild; no browser-download fallback was retained.
