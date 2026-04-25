# Multi-File Project Upload Plan

## Summary
Add multi-file upload support on the Projects page for both drag/drop and the Select File button. A batch can include `.xlsx` and `.txt` files; `.txt` files in the batch will use one shared source language selected before importing. The app will import valid files sequentially, skip failures, and show a final `FILE UPLOAD ERROR` modal listing failed filenames if any files did not upload.

## Key Changes
- Update `openLocalFilePicker` to support `multiple: true` while keeping existing single-file callers unchanged.
- Update project import drag/drop handling to collect all dropped browser `File` objects and all native Tauri dropped paths instead of only the first.
- Add a batch import path in `project-import-flow.js`:
  - Treat one selected/dropped file as the existing single-file flow.
  - Treat two or more files/paths as a batch.
  - If the batch contains any `.txt` files, show the source-language picker once and apply that language to every `.txt` file in the batch.
  - Import files sequentially in original selection/drop order.
  - Continue after unsupported extensions, read failures, or backend import errors.
  - Refresh/reconcile the project once after all successful imports finish.
- Add batch failure modal state and renderer:
  - Eyebrow: `FILE UPLOAD ERROR`
  - Title: `Some files were not uploaded`
  - Message: `The following files did not upload successfully:`
  - Body: escaped filename list in original order
  - Button: `Ok`
- Add a project action for closing the failure modal.

## Interface / State Changes
- Extend `projectImport` state with batch fields:
  - `pendingFiles`: array of pending file-like objects or dropped-path descriptors.
  - `failedFileNames`: array of filenames for the upload-error modal.
  - `isBatch`: boolean used to distinguish existing single-file behavior from grouped upload behavior.
- Keep existing single-file behavior intact:
  - Single unsupported/failed file still shows the current inline import error.
  - Single `.txt` file still uses the existing source-language flow.
- Use the existing project import modal for picking source language, but adjust copy when multiple text files are pending so it says “these text files” instead of “this file.”

## Test Plan
- Unit tests for `openLocalFilePicker({ multiple: true })` returning all selected files and preserving single-file behavior by default.
- Project import flow tests:
  - Batch with valid `.xlsx` files imports all and refreshes once.
  - Batch with mixed valid and invalid extensions imports valid files and records invalid filenames.
  - Batch with an import failure continues to later files and records the failed filename.
  - Batch containing `.txt` files opens the source-language step once and sends the chosen language for all `.txt` imports.
  - Single-file imports still use existing behavior.
- Event tests:
  - Browser drop passes all `dataTransfer.files` to project batch import.
  - Native Tauri drop passes all dropped paths to project batch import.
- Modal render tests:
  - Error modal renders exact eyebrow/title/message/button.
  - Filenames are escaped and listed in order.

## Assumptions
- “Pass validation” includes supported extension, readable file contents, and successful backend import validation/parsing.
- The failure modal lists filenames only, not error reasons, matching the requested copy.
- Multi-file support applies to both drag/drop and Select File.
- Batch `.txt` imports use one shared source language selected by the user before the batch starts.
